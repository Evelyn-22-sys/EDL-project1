#!/usr/bin/env python3
"""Folio 로컬 서버. .env의 GEMINI_API_KEY로 Gemini를 호출하고 정적 파일을 제공합니다."""

import json
import os
import re
import ssl
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
DEFAULT_MODEL = "gemini-3.8-flash"
MODEL_RE = re.compile(r"^gemini-[A-Za-z0-9._-]{1,80}$")
MAX_BODY = 12 * 1024 * 1024


def read_env_value(name):
    if not ENV_PATH.is_file():
        return ""
    try:
        lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for line in lines:
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        if key.strip() != name:
            continue
        return value.strip().strip('"').strip("'")
    return ""


def gemini_key():
    file_key = read_env_value("GEMINI_API_KEY")
    if file_key:
        return file_key
    return os.environ.get("GEMINI_API_KEY", "").strip()


def url_context():
    paths = []
    if os.environ.get("SSL_CERT_FILE"):
        paths.append(os.environ["SSL_CERT_FILE"])
    if os.uname().sysname == "Darwin":
        paths.append("/etc/ssl/cert.pem")
    default_file = ssl.get_default_verify_paths().openssl_cafile
    if default_file:
        paths.append(default_file)
    seen = []
    for path in paths:
        if not path or path in seen or not os.path.isfile(path) or os.path.getsize(path) <= 0:
            continue
        seen.append(path)
        try:
            return ssl.create_default_context(cafile=path)
        except ssl.SSLError:
            continue
    return ssl.create_default_context()


def public_error(text):
    raw = str(text or "")
    key = gemini_key()
    if key:
        raw = raw.replace(key, "")
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw[:300] or "Gemini 요청이 실패했습니다."


class FolioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _blocked(self):
        path = self.path.split("?", 1)[0]
        return path in ("/.env", "/.env.local") or path.endswith("/.env")

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        if self._blocked():
            self.send_error(404)
            return
        super().do_HEAD()

    def do_GET(self):
        if self._blocked():
            self.send_error(404)
            return
        if self.path.split("?", 1)[0] == "/api/gemini/status":
            key = gemini_key()
            self._json(200, {"configured": bool(key), "model": DEFAULT_MODEL})
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/gemini":
            self.send_error(404)
            return
        key = gemini_key()
        if not key:
            self._json(503, {"error": "GEMINI_API_KEY가 비어 있습니다."})
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length < 0 or length > MAX_BODY:
            self._json(413, {"error": "요청이 너무 큽니다."})
            return
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            self._json(400, {"error": "요청 JSON을 읽지 못했습니다."})
            return
        if not isinstance(payload, dict):
            self._json(400, {"error": "요청 JSON을 읽지 못했습니다."})
            return
        model = str(payload.get("model") or DEFAULT_MODEL).strip()
        if not MODEL_RE.match(model):
            model = DEFAULT_MODEL
        try:
            temperature = float(payload.get("temperature", 0.2))
        except (TypeError, ValueError):
            temperature = 0.2
        temperature = max(0.0, min(temperature, 1.0))
        parts = []
        image = payload.get("image") if isinstance(payload.get("image"), dict) else None
        if image and image.get("base64") and image.get("mime"):
            parts.append({
                "inline_data": {
                    "mime_type": str(image.get("mime")),
                    "data": str(image.get("base64"))
                }
            })
        parts.append({"text": str(payload.get("user") or "")})
        generation = {"temperature": temperature, "responseMimeType": "application/json"}
        schema = payload.get("schema")
        if isinstance(schema, dict):
            generation["responseSchema"] = schema
        body = {
            "systemInstruction": {"parts": [{"text": str(payload.get("system") or "")}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation
        }
        url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent"
        request = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
            method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=110, context=url_context()) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = public_error(error.read().decode("utf-8", "replace"))
            self._json(error.code, {"error": detail or ("API 오류 (" + str(error.code) + ")")})
            return
        except Exception:
            self._json(502, {"error": "Gemini 서버에 연결하지 못했습니다."})
            return
        parts_out = (
            data.get("candidates")
            and data["candidates"][0].get("content", {}).get("parts")
        ) or []
        text = "".join(part.get("text") or "" for part in parts_out if isinstance(part, dict))
        tokens = (data.get("usageMetadata") or {}).get("totalTokenCount") or 0
        if not text.strip():
            self._json(502, {"error": "모델 응답이 비어 있습니다."})
            return
        self._json(200, {"text": text, "tokens": tokens})


def main():
    port = int(os.environ.get("PORT", "8000"))
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("127.0.0.1", port), FolioHandler)
    print("Folio http://127.0.0.1:" + str(port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
