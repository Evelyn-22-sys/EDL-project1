#!/usr/bin/env python3
"""Folio 로컬 서버. .env의 GEMINI_API_KEY로 Gemini를 호출하고 정적 파일을 제공합니다."""

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"
DEFAULT_MODEL = "gemini-3.8-flash"
MODEL_RE = re.compile(r"^gemini-[A-Za-z0-9._-]{1,80}$")
MAX_BODY = 12 * 1024 * 1024
SYSTEM_INSTRUCTION = """당신은 전문 직독직해 번역기입니다.
1. 입력된 전체 영어 문장을 먼저 자연스러운 한국어 직독직해 문장으로 온전하게 통번역하십시오.
2. 그 후, 새롭게 분할된 영어 청크 배열(engChunks)의 개수와 구조에 정확히 1:1로 대응하도록 한국어 청크 배열(korChunks)을 나누어 반환하십시오.
3. it, of 같은 단어 조각만 보고 기계적으로 번역(그것, 의 등)하는 것을 절대 금지하며, 문장 전체 문맥에 맞는 의미 단위 직독직해 결과를 각 청크에 배치하십시오.
슬래시(/)가 들어 있는 문장 전체를 한 번에 읽고, 조각을 따로 번역하지 마십시오.
응답은 {"sentences":[{"engChunks":["..."],"korChunks":["..."]}]} JSON만 반환합니다. korChunks 길이는 engChunks 길이와 같고, 순서를 바꾸지 않습니다."""

SUMMARY_SYSTEM_INSTRUCTION = """당신은 영어 지문 전체를 한국어 한 문장으로 압축하는 핵심 요약 엔진입니다.
개별 문장을 순서대로 옮기거나 나열하지 마십시오. 지문 전체의 주제와 중심 주장만 내부적으로 파악한 뒤, 그 둘을 하나의 응축된 문장으로 추상화하십시오.
summary와 gist는 마침표(.)로 끝나는 단 하나의 완결된 한국어 문장이어야 합니다. 두 필드의 문장은 같아야 합니다.
두 번째 문장, 줄바꿈, 불릿, 번호 목록, 세미콜론으로 이어 붙인 문장열은 금지합니다.
JSON 객체만 반환하고, summary 값 안에는 마침표가 맨 끝에 하나만 있어야 합니다."""


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
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
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
        user_text = str(payload.get("user") or "")
        parts.append({"text": user_text})
        print("Gemini 문장 단위 요청 1회", len(user_text), flush=True)
        generation = {"temperature": temperature, "responseMimeType": "application/json"}
        schema = payload.get("schema")
        if isinstance(schema, dict):
            generation["responseSchema"] = schema
        system_text = str(payload.get("system") or "")
        summary_request = "핵심 요약" in user_text or "단일 문장" in user_text
        if summary_request:
            system_text = SUMMARY_SYSTEM_INSTRUCTION
        elif isinstance(schema, dict) or "직독직해" in user_text or "engChunks" in user_text:
            system_text = SYSTEM_INSTRUCTION
        body = {
            "systemInstruction": {"parts": [{"text": system_text}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation
        }
        url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent"
        kind = "summary" if summary_request else "translate" if (
            isinstance(schema, dict) or "직독직해" in user_text or "engChunks" in user_text
        ) else "other"

        def make_request():
            return urllib.request.Request(
                url,
                data=json.dumps(body).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": key,
                    "Cache-Control": "no-store"
                },
                method="POST"
            )

        outcome = gemini_with_retry(make_request, kind)
        if outcome.get("error"):
            self._json(outcome.get("status") or 502, {"error": outcome["error"]})
            return
        self._json(200, {"text": outcome["text"], "tokens": outcome["tokens"]})


RETRY_STATUSES = {408, 429, 500, 502, 503, 504}


def read_gemini_payload(data):
    parts_out = (
        data.get("candidates")
        and data["candidates"][0].get("content", {}).get("parts")
    ) or []
    text = "".join(part.get("text") or "" for part in parts_out if isinstance(part, dict))
    tokens = (data.get("usageMetadata") or {}).get("totalTokenCount") or 0
    if not str(text or "").strip():
        raise ValueError("empty")
    return text, tokens


def response_is_complete(text, kind):
    raw = str(text or "").strip()
    if not raw:
        return False
    if kind == "other":
        return True
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return False
    if not isinstance(payload, dict):
        return False
    if kind == "summary":
        sentence = str(payload.get("summary") or payload.get("gist") or "").strip()
        return bool(re.fullmatch(r"[^.!?\n。]+[.]", sentence))
    sentences = payload.get("sentences")
    if not isinstance(sentences, list) or not sentences:
        return False
    for item in sentences:
        if not isinstance(item, dict):
            return False
        eng = item.get("engChunks")
        kor = item.get("korChunks")
        if not isinstance(eng, list) or not isinstance(kor, list):
            return False
        if not eng or len(eng) != len(kor):
            return False
        if any(not str(part or "").strip() for part in eng):
            return False
        if any(not str(part or "").strip() for part in kor):
            return False
    return True


def prepare_model_text(text, kind):
    if kind == "summary":
        return force_single_summary(text)
    if kind == "translate":
        return validate_chunk_pairs(text)
    return text


def gemini_with_retry(make_request, kind):
    delay = 0.4
    last_status = 502
    last_error = "번역 응답 형식이 완전하지 않습니다."
    for attempt in range(4):
        try:
            with urllib.request.urlopen(make_request(), timeout=110, context=url_context()) as response:
                data = json.loads(response.read().decode("utf-8"))
            text, tokens = read_gemini_payload(data)
            text = prepare_model_text(text, kind)
            if response_is_complete(text, kind):
                if attempt:
                    print("Gemini 재시도 성공", attempt + 1, flush=True)
                return {"text": text, "tokens": tokens}
            print("Gemini 응답 무결성 실패", attempt + 1, flush=True)
            last_error = "번역 응답 형식이 완전하지 않습니다."
        except urllib.error.HTTPError as error:
            detail = public_error(error.read().decode("utf-8", "replace"))
            last_status = error.code
            last_error = detail or ("API 오류 (" + str(error.code) + ")")
            if error.code not in RETRY_STATUSES:
                return {"error": last_error, "status": error.code}
            print("Gemini 일시 오류", error.code, attempt + 1, flush=True)
        except Exception:
            last_status = 502
            last_error = "Gemini 서버에 연결하지 못했습니다."
            print("Gemini 연결 재시도", attempt + 1, flush=True)
        if attempt < 3:
            time.sleep(delay)
            delay *= 2
    return {"error": last_error, "status": last_status}


def to_single_sentence(text):
    raw = str(text or "")
    raw = re.sub(r"```+", " ", raw)
    lines = []
    for line in re.split(r"[\r\n]+", raw):
        cleaned = re.sub(r"^\s*(?:[-*•∙·]|[0-9]+[.)]|[①-⑩])\s*", "", line).strip()
        if cleaned:
            lines.append(cleaned)
    raw = lines[0] if lines else ""
    raw = re.sub(r"\s+", " ", raw).strip()
    if not raw:
        return ""
    match = re.match(r"^.*?[.!?。](?=\s|$)", raw)
    sentence = match.group(0).strip() if match else raw
    sentence = re.split(r"[.!?。]", sentence, maxsplit=1)[0].strip()
    sentence = re.sub(r"\s+", " ", sentence).strip(" \"'“”")
    if not sentence or not re.fullmatch(r"[^.!?。\n]+", sentence):
        return ""
    return sentence + "."


def force_single_summary(text):
    raw = str(text or "").strip()
    fenced = raw.startswith("```")
    if fenced:
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return text
    if not isinstance(payload, dict) or ("summary" not in payload and "gist" not in payload):
        return text
    sentence = to_single_sentence(payload.get("summary") or payload.get("gist") or "")
    if not sentence:
        sentence = to_single_sentence(payload.get("gist") or "")
    if sentence:
        payload["summary"] = sentence
        payload["gist"] = sentence
    if isinstance(payload.get("main_idea_en"), str):
        english = to_single_sentence(payload.get("main_idea_en"))
        if english:
            payload["main_idea_en"] = english
    return json.dumps(payload, ensure_ascii=False)


def string_list(value):
    if not isinstance(value, list):
        return []
    return [str(part or "").strip() for part in value]


def validate_chunk_pairs(text):
    raw = str(text or "").strip()
    fenced = raw.startswith("```")
    if fenced:
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return text
    if not isinstance(payload, dict):
        return text
    sentences = payload.get("sentences")
    if not isinstance(sentences, list):
        if isinstance(payload.get("engChunks"), list) or isinstance(payload.get("korChunks"), list):
            sentences = [payload]
        else:
            return text
    normalized = []
    for item in sentences:
        if not isinstance(item, dict):
            continue
        eng = string_list(item.get("engChunks"))
        if not eng:
            eng = string_list(item.get("chunks"))
        kor = string_list(item.get("korChunks"))
        if not kor:
            kor = string_list(item.get("literal_chunks"))
        if not eng:
            continue
        if len(kor) != len(eng):
            print("청크 길이 불일치", len(eng), len(kor), flush=True)
            if len(kor) > len(eng):
                kor = kor[:len(eng)]
            else:
                kor = kor + [""] * (len(eng) - len(kor))
        row = {"engChunks": eng, "korChunks": kor}
        original = str(item.get("original") or "").strip()
        if original:
            row["original"] = original
        normalized.append(row)
    if not normalized:
        return text
    body = {"sentences": normalized}
    transcript = payload.get("transcript")
    if isinstance(transcript, str):
        body["transcript"] = transcript
    return json.dumps(body, ensure_ascii=False)


def main():
    port = int(os.environ.get("PORT", "8000"))
    ThreadingHTTPServer.allow_reuse_address = True
    server = ThreadingHTTPServer(("127.0.0.1", port), FolioHandler)
    print("Folio http://127.0.0.1:" + str(port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
