    "use strict";

    /*
      Folio의 흐름
      1. 화면에서 키와 지문, 또는 사진을 모읍니다.
      2. 분석 종류를 고르고 제출하면 그 기능의 지시문과 지문을 API로 보냅니다.
      3. JSON으로 돌아온 결과를 오른쪽 칸에 그립니다.
      키는 소스코드에 적지 않습니다.
    */

    var STORAGE_KEY = "folio-settings-v1";
    var SESSION_KEY = "folio-session-v1";
    var USERS_KEY = "folio-users-v1";
    var DEFAULT_BASE = "https://api.openai.com/v1";
    var CIRCLED = ["①", "②", "③", "④", "⑤"];

    var SAMPLE_PASSAGE = [
      "Although literary critics often treat a novel's opening paragraph as a mere threshold, it frequently performs the more demanding work of training the reader in how to look. A single concrete image — a cracked window, a clock that has stopped, a letter left unopened — can establish not only the scene but the moral weather of the book. Readers who rush past these details in search of plot miss the writer's quiet instructions.",
      "This is why close reading begins before interpretation. To notice a repeated verb, a shift in tense, or an unexpected pronoun is already to enter the writer's design. What appears to be description is, in many cases, an argument about attention itself: the claim that meaning gathers slowly, and that patience is a form of understanding."
    ].join("\n\n");

    var PRESETS = {
      openai: [
        ["gpt-4.1-mini", "gpt-4.1-mini · 추천, 이미지 가능"],
        ["gpt-4o-mini", "gpt-4o-mini · 저렴"],
        ["gpt-4.1", "gpt-4.1 · 더 정교한 해설"],
        ["gpt-4o", "gpt-4o"],
        ["custom", "직접 입력"]
      ],
      gemini: [
        ["gemini-3.8-flash", "gemini-3.8-flash · 추천"],
        ["gemini-3.5-flash", "gemini-3.5-flash"],
        ["gemini-2.5-flash", "gemini-2.5-flash"],
        ["custom", "직접 입력"]
      ]
    };

    var TASKS = {
      translate: {
        kicker: "01  DIRECT READING",
        title: "직독직해",
        loading: "문장마다 직독직해를 나누고 있습니다.",
        instruction: [
          "영어 지문을 직독직해 JSON으로만 답하세요. 문장 전체를 한 번에 읽고, 슬래시 조각을 따로 번역 요청으로 나누지 않습니다.",
          "각 문장은 {\"engChunks\":[\"...\"],\"korChunks\":[\"...\"]} 입니다. korChunks 개수는 engChunks 개수와 같아야 합니다.",
          "규칙 1 문장 분할: 마침표, 물음표, 느낌표에서만 문장을 나눕니다. 큰따옴표 안의 온점은 문장을 나누지 않습니다. Mr. Mrs. Ms. Dr. Prof.와 U.S. 같은 약어의 온점도 문장을 나누지 않습니다. 인용문 뒤의 she said, I said 같은 화자 태그는 그 태그 끝의 온점까지 같은 문장으로 둡니다.",
          "규칙 2: engChunks는 입력 문장에 이미 들어 있는 슬래시 사이의 영어 원문입니다. 슬래시 위치를 바꾸지 않습니다.",
          "영어 철자를 한글 발음으로 옮기지 않습니다. 인용 속 인사와 호칭도 그 뜻으로 옮기고, AJ처럼 대문자만 있는 이니셜은 라틴 글자로 남깁니다.",
          "JSON 원소에는 슬래시와 // 를 넣지 않습니다.",
          "JSON 형식:",
          '{"sentences":[{"engChunks":["The economic benefit","of culturtainment","makes it attractive","to politicians","and policy makers alike."],"korChunks":["경제적 이득은","컬처테인먼트의","그것을 매력적으로 만들고","정치인들에게","그리고 정책 입안자들에게도 마찬가지다."]}]}'
        ].join("\n")
      },
      summary: {
        kicker: "02  SUMMARY",
        title: "핵심 요약",
        loading: "중심 생각과 근거를 추리고 있습니다.",
        instruction: [
          "영어 지문의 핵심만 요약하세요.",
          "JSON 형식:",
          '{"transcript":"","title":"짧은 한국어 제목","gist":"핵심을 한국어 한 문장으로","summary":"네 문장 이내의 한국어 요약","points":[{"en":"지문 속 짧은 영어 근거","ko":"그 근거의 의미"}],"main_idea_en":"중심 생각을 영어 한 문장으로 다시 쓴 패러프레이즈"}',
          "points는 3개로 합니다. main_idea_en은 원문 문장을 그대로 복사하지 않습니다."
        ].join("\n")
      },
      annotate: {
        kicker: "03  SYNTAX AND LEXIS",
        title: "구문 / 어휘 해설",
        loading: "독해에 걸리는 구문과 어휘를 고르고 있습니다.",
        instruction: [
          "영어영문학과 학생이 막히기 쉬운 구문과 어휘를 해설하세요.",
          "JSON 형식:",
          '{"transcript":"","structures":[{"excerpt":"지문에서 그대로 인용한 구문","label":"문법 용어","explanation":"이 구문이 문장에서 하는 일의 한국어 설명","paraphrase":"더 단순한 영어"}],"vocabulary":[{"word":"표제어","pos":"품사","meaning":"이 문맥의 한국어 뜻","context":"이 지문에서 중요한 이유"}]}',
          "structures는 4개 안팎, vocabulary는 6개 안팎입니다. the, a, is 같은 기능어는 제외합니다.",
          "문법 용어의 예: 양보의 부사절, 관계절, 분사구문, 동격의 that, 가주어-진주어, to부정사 주어, 병렬 구조."
        ].join("\n")
      },
      transform: {
        kicker: "04  ITEM WRITING",
        title: "변형 문제",
        loading: "빈칸과 순서 배열 문제를 만들고 있습니다.",
        instruction: [
          "지문 내용만으로 한국 대학 영어 시험 형식의 문제를 만드세요.",
          "JSON 형식:",
          '{"transcript":"","blanks":[{"instruction":"빈칸에 들어갈 말로 가장 적절한 것을 고르시오.","passage":"의미가 유지된 지문. 빈칸은 ________ 한 곳","options":["보기1","보기2","보기3","보기4","보기5"],"answer":3,"explanation":"정답 근거와 매력적인 오답 하나의 함정"}],"ordering":[{"instruction":"주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오.","intro":"첫 문장","sentences":[{"label":"A","text":"학생에게 보여줄 문장"},{"label":"B","text":"..."},{"label":"C","text":"..."}],"options":["(A)-(C)-(B)","(B)-(A)-(C)","(B)-(C)-(A)","(C)-(A)-(B)","(C)-(B)-(A)"],"answer":1,"explanation":"대명사와 접속사 단서를 짚은 한국어 해설"}]}',
          "빈칸 문제는 2개, 순서 배열은 1개입니다.",
          "answer는 1부터 5까지의 정수이고, 그 번호의 보기가 실제로 정답이어야 합니다.",
          "ordering.sentences는 정답 순서가 아니라 A-B-C 라벨로 보여줄 문장입니다. 정답 순서는 options와 answer로만 표현합니다.",
          "빈칸은 지문의 중심 내용을 묻게 만들고, 세부 연도나 고유명사 암기 문제는 피합니다."
        ].join("\n")
      }
    };

    var TRANSLATE_SCHEMA = {
      type: "object",
      properties: {
        sentences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              engChunks: { type: "array", items: { type: "string" } },
              korChunks: { type: "array", items: { type: "string" } }
            },
            required: ["engChunks", "korChunks"]
          }
        }
      },
      required: ["sentences"]
    };

    var TRANSLATE_SYSTEM_PROMPT = [
      "You are an expert English-to-Korean direct-reading (직독직해) translation engine.",
      "When translating, you MUST follow this internal multi-stage reasoning process sequentially before returning the final output:",
      "",
      "1. [Phase 1 - Global Context Analysis]: Read the entire passage provided to understand the overall context, topic, and flow. (Internal reasoning only, do not output to user)",
      "2. [Phase 2 - Sentence-level Comprehension]: Read each sentence completely, interpret its full grammatical structure and holistic meaning within the context.",
      "3. [Phase 3 - Chunk-level Direct Translation Mapping]: Match the holistic sentence meaning to the provided English chunk array (`engChunks`). Generate a Korean chunk array (`korChunks`) that has the EXACT same length as `engChunks`, ensuring 1:1 index alignment. Each Korean chunk must reflect natural direct-reading order while preserving the overall sentence context. Never translate chunks in isolation without sentence-level context.",
      "",
      "Output Format: Return strictly {\"sentences\":[{\"engChunks\":[\"...\"],\"korChunks\":[\"...\"]}]}. korChunks must have the exact same length and order as engChunks."
    ].join("\n");

    var SYSTEM_PROMPT = [
      "당신은 한국 대학교 영어영문학 수업의 독해 조교입니다.",
      "학생이 제공한 영어 지문만 근거로 답합니다. 지문에 없는 문장을 인용하지 않습니다.",
      "해설은 한국어로 쓰고, 인용문과 문제 보기는 영어로 둡니다.",
      "출력은 하나의 JSON 객체뿐입니다. 코드펜스나 서론을 붙이지 않습니다.",
      "이미지가 있고 입력 텍스트가 비어 있으면 이미지의 영어 지문을 먼저 읽어 transcript에 넣습니다.",
      "입력 텍스트가 있으면 그 텍스트만 분석하고 transcript는 빈 문자열로 둡니다.",
      "지문이 영어가 아니거나 너무 짧으면 내용 배열을 비우고 error 필드에 한국어로 이유를 적습니다.",
      "직독직해는 문장 전체의 직독직해 완성본을 먼저 만든 뒤, 그 문장을 영어 청크 개수에 맞게 나눕니다.",
      "단어별 기계적 직역은 금지합니다. 한국어 청크 배열의 길이는 영어 청크 배열과 같아야 합니다."
    ].join(" ");

    var els = {
      passage: document.getElementById("passage"),
      passageCount: document.getElementById("passage-count"),
      lengthWarn: document.getElementById("length-warn"),
      loadSample: document.getElementById("load-sample"),
      clearPassage: document.getElementById("clear-passage"),
      dropzone: document.getElementById("dropzone"),
      file: document.getElementById("file"),
      camera: document.getElementById("camera"),
      cameraFallback: document.getElementById("camera-fallback"),
      showFile: document.getElementById("show-file"),
      showLive: document.getElementById("show-live"),
      filePane: document.getElementById("file-pane"),
      livePane: document.getElementById("live-pane"),
      liveVideo: document.getElementById("live-video"),
      startCamera: document.getElementById("start-camera"),
      flipCamera: document.getElementById("flip-camera"),
      capturePhoto: document.getElementById("capture-photo"),
      stopCamera: document.getElementById("stop-camera"),
      captureCanvas: document.getElementById("capture-canvas"),
      submit: document.getElementById("submit-analysis"),
      dropEmpty: document.getElementById("drop-empty"),
      preview: document.getElementById("preview"),
      removeImage: document.getElementById("remove-image"),
      imageName: document.getElementById("image-name"),
      imageMessage: document.getElementById("image-message"),
      ocrStatus: document.getElementById("ocr-status"),
      ocrStatusText: document.getElementById("ocr-status-text"),
      ocrProgressTrack: document.getElementById("ocr-progress-track"),
      ocrProgressBar: document.getElementById("ocr-progress-bar"),
      vocabNotes: document.getElementById("vocab-notes"),
      sourceNote: document.getElementById("source-note"),
      taskGrid: document.getElementById("task-grid"),
      analysisTools: document.getElementById("analysis-tools"),
      resultPanel: document.getElementById("result-panel"),
      submitHint: document.getElementById("submit-hint"),
      inputMessage: document.getElementById("input-message"),
      resultKicker: document.getElementById("result-kicker"),
      resultTitle: document.getElementById("result-title"),
      resultBody: document.getElementById("result-body"),
      resultMeta: document.getElementById("result-meta"),
      copyResult: document.getElementById("copy-result"),
      clearResult: document.getElementById("clear-result"),
      savedKeyStatus: document.getElementById("saved-key-status"),
      dialog: document.getElementById("settings"),
      form: document.getElementById("settings-form"),
      closeSettings: document.getElementById("close-settings"),
      apiKey: document.getElementById("api-key"),
      toggleKey: document.getElementById("toggle-key"),
      keyHint: document.getElementById("key-hint"),
      keyLink: document.getElementById("key-link"),
      modelPreset: document.getElementById("model-preset"),
      customModelWrap: document.getElementById("custom-model-wrap"),
      customModel: document.getElementById("custom-model"),
      baseUrlWrap: document.getElementById("base-url-wrap"),
      baseUrl: document.getElementById("base-url"),
      formError: document.getElementById("form-error"),
      testStatus: document.getElementById("test-status"),
      testConnection: document.getElementById("test-connection"),
      clearKey: document.getElementById("clear-key"),
      emptyTemplate: document.getElementById("empty-template"),
      authScreen: document.getElementById("auth-screen"),
      appScreen: document.getElementById("app-screen"),
      authForm: document.getElementById("auth-form"),
      authEmail: document.getElementById("auth-email"),
      authPassword: document.getElementById("auth-password"),
      authMessage: document.getElementById("auth-message"),
      authSubmit: document.getElementById("auth-submit"),
      authLead: document.getElementById("auth-lead"),
      showLogin: document.getElementById("show-login"),
      showSignup: document.getElementById("show-signup"),
      sessionEmail: document.getElementById("session-email"),
      logout: document.getElementById("logout"),
      adminMark: document.getElementById("admin-mark")
    };

    var authMode = "login";
    var adminClicks = [];

    var selectedTask = "translate";
    var isSubmitted = false;
    var cameraStream = null;
    var facingMode = "environment";
    var imageFile = null;
    var ocrJob = 0;
    var ocrListen = 0;
    var ocrQueue = Promise.resolve();
    var ocrWorker = null;
    var ocrWorkerPromise = null;
    var ocrWorkerToken = 0;
    var ocrStatusFrame = 0;
    var ocrStatusQueued = null;
    var sourceNoteTimer = 0;
    var sentenceMemo = new Map();
    var slashMemo = new Map();
    var chunkMemo = new Map();
    var koreanMemo = new Map();
    var OCR_FAIL = "이미지에서 텍스트를 추출하지 못했습니다. 아래 텍스트에 직접 입력해주세요.";
    var abortController = null;
    var requestKind = null;
    var envGeminiReady = false;
    var envGeminiModel = "";

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function textBlock(value) {
      return esc(value).replace(/\n/g, "<br>");
    }

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function countWords(text) {
      var words = text.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g);
      return words ? words.length : 0;
    }

    function defaultModel(provider) {
      return provider === "gemini" ? "gemini-3.8-flash" : "gpt-4.1-mini";
    }

    function loadSettings() {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var legacy = sessionStorage.getItem(STORAGE_KEY);
        if (!legacy) return null;
        localStorage.setItem(STORAGE_KEY, legacy);
        sessionStorage.removeItem(STORAGE_KEY);
        raw = legacy;
      }
      try {
        var parsed = JSON.parse(raw);
        if (!parsed || !parsed.apiKey) return null;
        return parsed;
      } catch (error) {
        return null;
      }
    }

    function normalizeKey(value) {
      return String(value || "").trim().replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "");
    }

    function normalizeBaseUrl(value) {
      var raw = String(value || "").trim() || DEFAULT_BASE;
      var url;
      try {
        url = new URL(raw);
      } catch (error) {
        throw new Error("API 주소 형식이 올바르지 않습니다.");
      }
      var local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
      if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
        throw new Error("API 주소는 https만 사용할 수 있습니다.");
      }
      return url.toString().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
    }

    function selectedProvider() {
      var checked = document.querySelector('input[name="provider"]:checked');
      return checked ? checked.value : "openai";
    }

    function applyProviderUI(provider, model) {
      var presets = PRESETS[provider] || PRESETS.openai;
      var known = presets.some(function (item) { return item[0] === model; });
      els.modelPreset.innerHTML = presets.map(function (item) {
        return '<option value="' + esc(item[0]) + '">' + esc(item[1]) + "</option>";
      }).join("");
      els.modelPreset.value = known ? model : "custom";
      els.customModel.value = known ? "" : (model || "");
      els.customModelWrap.classList.toggle("hidden", els.modelPreset.value !== "custom");
      els.baseUrlWrap.classList.toggle("hidden", provider !== "openai");
      if (provider === "gemini") {
        els.keyHint.textContent = "Google AI Studio에서 발급한 키를 붙여 넣으세요. 브라우저에서 바로 호출하기 좋습니다.";
        els.keyLink.href = "https://aistudio.google.com/apikey";
        els.keyLink.textContent = "Google AI Studio에서 키 만들기";
      } else {
        els.keyHint.textContent = "OpenAI에서 발급한 키를 붙여 넣으세요. sk- 로 시작하는 경우가 많습니다.";
        els.keyLink.href = "https://platform.openai.com/api-keys";
        els.keyLink.textContent = "OpenAI에서 키 만들기";
      }
    }

    function fillSettingsForm() {
      var saved = loadSettings() || {};
      var provider = saved.provider === "gemini" ? "gemini" : "openai";
      document.querySelector('input[name="provider"][value="' + provider + '"]').checked = true;
      els.apiKey.value = saved.apiKey || "";
      els.baseUrl.value = saved.baseUrl || DEFAULT_BASE;
      applyProviderUI(provider, saved.model || defaultModel(provider));
    }

    function collectSettings() {
      var provider = selectedProvider();
      var model = (els.modelPreset.value === "custom" ? els.customModel.value : els.modelPreset.value).trim();
      model = model.replace(/^models\//, "");
      if (!model) throw new Error("모델 이름을 입력해 주세요.");
      var apiKey = normalizeKey(els.apiKey.value);
      if (!apiKey) throw new Error("API 키를 입력해 주세요.");
      return {
        provider: provider,
        apiKey: apiKey,
        model: model,
        baseUrl: provider === "openai" ? normalizeBaseUrl(els.baseUrl.value) : ""
      };
    }

    function updateKeyChip(settings) {
      if (!els.savedKeyStatus) return;
      if (envGeminiReady) {
        els.savedKeyStatus.textContent = "프로젝트의 Gemini 키가 연결되어 있습니다.";
        return;
      }
      if (!settings || !settings.apiKey) {
        els.savedKeyStatus.textContent = "이 브라우저에 저장된 키가 없습니다.";
        return;
      }
      var name = settings.provider === "gemini" ? "Gemini" : "OpenAI";
      els.savedKeyStatus.textContent = name + " 키가 이 브라우저에 저장되어 있습니다.";
    }

    function persistSettings(settings) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      sessionStorage.removeItem(STORAGE_KEY);
      updateKeyChip(settings);
    }

    function openSettings() {
      fillSettingsForm();
      els.formError.textContent = "";
      els.testStatus.textContent = "";
      if (!els.dialog.open) els.dialog.showModal();
      window.setTimeout(function () { els.apiKey.focus(); }, 0);
    }

    function setImageMessage(text) {
      els.imageMessage.textContent = text || "";
      els.imageMessage.classList.toggle("hidden", !text);
    }

    function updateSourceNote() {
      var text = els.passage.value.trim();
      var hasImage = Boolean(imageFile);
      els.sourceNote.classList.toggle("hidden", !(text.length >= 40 && hasImage));
      els.passageCount.textContent = text
        ? text.length.toLocaleString("ko-KR") + "자 · 영어 단어 약 " + countWords(text).toLocaleString("ko-KR") + "개"
        : "아직 지문이 없습니다";
      els.lengthWarn.classList.toggle("hidden", text.length < 8000);
      renderVocabNotes(els.passage.value);
    }

    function showImagePreview() {
      var hasImage = Boolean(imageFile);
      els.preview.classList.toggle("hidden", !hasImage);
      els.dropEmpty.classList.toggle("hidden", hasImage);
      els.removeImage.classList.toggle("hidden", !hasImage);
      els.imageName.classList.toggle("hidden", !hasImage);
      if (!hasImage) {
        els.preview.removeAttribute("src");
        els.imageName.textContent = "";
        return;
      }
      els.preview.src = imageFile.dataUrl;
      els.imageName.textContent = imageFile.name + " · 전송 전에 가로 1600px 이하로 줄였습니다.";
    }

    function clearImage() {
      ocrJob += 1;
      setOcrStatus("", false, false);
      imageFile = null;
      els.file.value = "";
      if (els.camera) els.camera.value = "";
      setImageMessage("");
      showImagePreview();
      updateSourceNote();
    }

    function setLiveControls(on) {
      els.capturePhoto.disabled = !on;
      els.stopCamera.classList.toggle("hidden", !on);
      els.flipCamera.classList.toggle("hidden", !on);
      els.startCamera.classList.toggle("hidden", on);
    }

    function showCameraFallback(message) {
      setImageMessage(message);
      if (els.cameraFallback) els.cameraFallback.classList.remove("hidden");
    }

    function cameraErrorMessage(error) {
      if (!window.isSecureContext) {
        return "실시간 카메라는 localhost 또는 https 에서만 열립니다. 파일을 더블클릭해 열었다면 로컬 서버로 접속해 주세요.";
      }
      var name = error && error.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return "카메라 권한이 거부되었습니다. 주소창의 카메라 허용을 확인하거나, 카메라 앱으로 찍어 주세요.";
      }
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        return "이 기기에서 카메라를 찾지 못했습니다. 파일을 올리거나 카메라 앱으로 찍어 주세요.";
      }
      if (name === "NotReadableError") {
        return "다른 앱이 카메라를 사용 중입니다. 그 앱을 닫고 다시 시도해 주세요.";
      }
      return "카메라를 켜지 못했습니다. 파일을 올리거나 카메라 앱으로 찍어 주세요.";
    }

    function stopCamera() {
      if (cameraStream) {
        cameraStream.getTracks().forEach(function (track) { track.stop(); });
        cameraStream = null;
      }
      if (!els.liveVideo) return;
      els.liveVideo.srcObject = null;
      els.liveVideo.dataset.on = "false";
      setLiveControls(false);
    }

    function openCameraStream(mode) {
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1600 },
          height: { ideal: 1200 }
        }
      });
    }

    async function startCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showCameraFallback("이 브라우저는 실시간 카메라를 지원하지 않습니다. 카메라 앱으로 찍거나 파일을 올려 주세요.");
        return;
      }
      if (!window.isSecureContext) {
        showCameraFallback("실시간 카메라는 localhost 또는 https 에서만 열립니다. 파일을 더블클릭해 열었다면 로컬 서버로 접속해 주세요.");
        return;
      }
      stopCamera();
      setImageMessage("");
      els.startCamera.disabled = true;
      try {
        try {
          cameraStream = await openCameraStream(facingMode);
        } catch (firstError) {
          var nextMode = facingMode === "environment" ? "user" : "environment";
          try {
            cameraStream = await openCameraStream(nextMode);
            facingMode = nextMode;
          } catch (secondError) {
            throw firstError;
          }
        }
        els.liveVideo.srcObject = cameraStream;
        els.liveVideo.dataset.on = "true";
        await els.liveVideo.play();
        if (els.cameraFallback) els.cameraFallback.classList.add("hidden");
        setLiveControls(true);
      } catch (error) {
        stopCamera();
        showCameraFallback(cameraErrorMessage(error));
      } finally {
        els.startCamera.disabled = false;
      }
    }

    function setSourceMode(mode) {
      var live = mode === "live";
      els.filePane.classList.toggle("hidden", live);
      els.livePane.classList.toggle("hidden", !live);
      els.showFile.dataset.active = live ? "false" : "true";
      els.showLive.dataset.active = live ? "true" : "false";
      els.showFile.setAttribute("aria-selected", live ? "false" : "true");
      els.showLive.setAttribute("aria-selected", live ? "true" : "false");
      if (!live) stopCamera();
    }

    function capturePhoto() {
      var video = els.liveVideo;
      if (!video || !video.videoWidth) {
        setImageMessage("카메라 영상이 준비된 뒤에 촬영해 주세요.");
        return;
      }
      var maxEdge = 1600;
      var scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
      var canvas = els.captureCanvas;
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      var finish = function (blob) {
        if (!blob) {
          setImageMessage("사진을 저장하지 못했습니다. 다시 촬영해 주세요.");
          return;
        }
        var file = new File([blob], "camera-capture.jpg", { type: "image/jpeg", lastModified: Date.now() });
        acceptImage(file).then(function () {
          if (!imageFile) return;
          setSourceMode("file");
        });
      };
      if (canvas.toBlob) {
        canvas.toBlob(finish, "image/jpeg", 0.92);
        return;
      }
      var dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      fetch(dataUrl).then(function (response) { return response.blob(); }).then(finish);
    }

    function compressImage(file) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          var maxEdge = 1600;
          var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve({
            dataUrl: canvas.toDataURL("image/jpeg", 0.86),
            mime: "image/jpeg",
            name: file.name || "passage.jpg"
          });
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("이 브라우저는 해당 사진을 열지 못합니다. JPG 또는 PNG로 저장해 다시 올려 주세요."));
        };
        img.src = url;
      });
    }

    async function acceptImage(file) {
      if (!file) return;
      if (!file.type || file.type.indexOf("image/") !== 0) {
        setImageMessage("이미지 파일만 올릴 수 있습니다.");
        return;
      }
      if (file.size > 12 * 1024 * 1024) {
        setImageMessage("사진이 12MB보다 큽니다. 용량을 줄여 다시 올려 주세요.");
        return;
      }
      setImageMessage("");
      try {
        imageFile = await compressImage(file);
        showImagePreview();
        updateSourceNote();
        readImageText(imageFile);
      } catch (error) {
        imageFile = null;
        showImagePreview();
        setImageMessage(error.message || "사진을 열지 못했습니다.");
      }
    }

    function paintOcrStatus() {
      var next = ocrStatusQueued;
      if (!next || !els.ocrStatus) return;
      if (els.ocrStatusText) els.ocrStatusText.textContent = next.text || "";
      else els.ocrStatus.textContent = next.text || "";
      els.ocrStatus.classList.toggle("hidden", !next.text);
      els.ocrStatus.classList.toggle("is-busy", Boolean(next.busy));
      els.ocrStatus.classList.toggle("is-warn", Boolean(next.warn));
      var ratio = typeof next.progress === "number" ? Math.max(0, Math.min(1, next.progress)) : -1;
      var showBar = Boolean(next.busy) && ratio >= 0;
      if (els.ocrProgressTrack) els.ocrProgressTrack.classList.toggle("hidden", !showBar);
      if (els.ocrProgressBar && showBar) els.ocrProgressBar.style.width = Math.round(ratio * 100) + "%";
    }

    function setOcrStatus(text, busy, warn, progress) {
      ocrStatusQueued = { text: text, busy: busy, warn: warn, progress: progress };
      if (!busy) {
        if (ocrStatusFrame) window.cancelAnimationFrame(ocrStatusFrame);
        ocrStatusFrame = 0;
        paintOcrStatus();
        return;
      }
      if (ocrStatusFrame) return;
      ocrStatusFrame = window.requestAnimationFrame(function () {
        ocrStatusFrame = 0;
        paintOcrStatus();
      });
    }

    function yieldToUi() {
      return new Promise(function (resolve) {
        window.requestAnimationFrame(function () {
          window.setTimeout(resolve, 0);
        });
      });
    }

    function remember(cache, key, value) {
      if (cache.has(key)) cache.delete(key);
      cache.set(key, value);
      if (cache.size > 80) cache.delete(cache.keys().next().value);
      return value;
    }

    function scheduleSourceNote() {
      window.clearTimeout(sourceNoteTimer);
      sourceNoteTimer = window.setTimeout(updateSourceNote, 140);
    }

    function writePassage(text) {
      els.passage.value = text;
      updateSourceNote();
      els.passage.focus();
    }

    function normalizeOcrPunctuation(raw) {
      var text = String(raw || "")
        .replace(/[．。]/g, ".")
        .replace(/！/g, "!")
        .replace(/？/g, "?")
        .replace(/[…⋯]/g, "...")
        .replace(/[·•∙⋅‧▪◦]/g, " ");
      text = text.replace(/(?:\.\s*){2,}/g, ".");
      text = text.replace(/(?:[!?]\s*){2,}/g, function (run) {
        return run.indexOf("?") === -1 ? "!" : "?";
      });
      text = text.replace(/[.!?]{2,}/g, function (run) {
        if (run.indexOf("?") !== -1) return "?";
        if (run.indexOf("!") !== -1) return "!";
        return ".";
      });
      text = text.replace(/,+/g, ",").replace(/;+/g, ";");
      text = text.replace(/\.[,;]+/g, ".").replace(/[,;]+\./g, ",");
      var chars = text.split("");
      var out = [];
      var i;
      for (i = 0; i < chars.length; i += 1) {
        var ch = chars[i];
        if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "," && ch !== ";") {
          out.push(ch);
          continue;
        }
        var prev = i > 0 ? chars[i - 1] : "";
        var next = i + 1 < chars.length ? chars[i + 1] : "";
        var prevLetter = /[A-Za-z]/.test(prev);
        var nextLetter = /[A-Za-z]/.test(next);
        var decimal = ch === "." && /\d/.test(prev) && /\d/.test(next);
        var abbrev = ch === "." && isAbbreviationPeriod(text, i);
        if (decimal || abbrev) {
          out.push(ch);
          var continuesInitial = /[A-Z]/.test(next) && chars[i + 2] === ".";
          if (/[A-Z]/.test(next) && !continuesInitial) out.push(" ");
          continue;
        }
        if (prevLetter && nextLetter) {
          if ((ch === "." || ch === "!" || ch === "?") && /[A-Z]/.test(next)) {
            out.push(ch);
            out.push(" ");
            continue;
          }
          if (ch === "," || ch === ";") {
            out.push(ch);
            out.push(" ");
            continue;
          }
          out.push(" ");
          continue;
        }
        if (!prev || /\s/.test(prev)) {
          var look = i + 1;
          while (look < chars.length && /\s/.test(chars[look])) look += 1;
          var follower = chars[look] || "";
          var keepEnd = ch === "!" || ch === "?" || /[A-Z]/.test(follower);
          if (!follower) continue;
          if (ch === "." && /[a-z]/.test(follower)) continue;
          if (keepEnd || ch === "," || ch === ";") {
            var tail = out.length - 1;
            while (tail >= 0 && /\s/.test(out[tail])) tail -= 1;
            if (tail >= 0 && /[A-Za-z0-9"”'’]/.test(out[tail])) {
              while (out.length - 1 > tail) out.pop();
              out.push(ch);
              out.push(" ");
              while (i + 1 < chars.length && /\s/.test(chars[i + 1])) i += 1;
            }
          }
          continue;
        }
        if (prevLetter || /["“”'’)\]]/.test(prev) || /["“”'’)\]]/.test(next)) {
          out.push(ch);
          continue;
        }
        if (/\s/.test(next)) {
          if (ch === "." && /\d/.test(prev)) out.push(ch);
          continue;
        }
        out.push(ch);
      }
      return out.join("")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]+([,.;:!?])/g, "$1")
        .replace(/^[ \t]*[.!?,;:]+[ \t]*/g, "")
        .trim();
    }

    function cleanOcrText(raw) {
      var text = String(raw || "")
        .replace(/\r/g, "")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n");
      return normalizeOcrPunctuation(normalizeVocabAnnotation(text)).trim();
    }

    function vocabStars(mark) {
      var count = String(mark || "").match(/[*＊∗✱✲✳✶★☆※†‡+＋•·∙]/g);
      var size = count ? count.length : 1;
      if (size < 1) size = 1;
      if (size > 3) size = 3;
      return new Array(size + 1).join("*");
    }

    function parseVocabEntries(line) {
      var source = String(line || "").trim();
      var mark = "[*＊∗✱✲✳✶★☆※†‡+＋•·∙]";
      var run = mark + "(?:\\s*" + mark + "){0,2}";
      if (!source || !new RegExp("^" + run + "\\s*[A-Za-z]").test(source)) return [];
      var pattern = new RegExp("(" + run + ")\\s*([A-Za-z][A-Za-z'’-]*)\\s*[:：]\\s*([\\s\\S]*?)(?=\\s+" + run + "\\s*[A-Za-z]|$)", "g");
      var entries = [];
      var match;
      while ((match = pattern.exec(source))) {
        var meaning = match[3].replace(/\s+/g, " ").trim();
        if (!/[가-힣]/.test(meaning)) return [];
        entries.push({ mark: match[1], word: match[2], meaning: meaning });
      }
      if (entries.length) return entries;
      var loose = source.match(new RegExp("^(" + run + ")\\s*([A-Za-z][A-Za-z'’-]*)\\s+([가-힣].+)$"));
      if (!loose || /[:：]/.test(source)) return [];
      return [{ mark: loose[1], word: loose[2], meaning: loose[3].replace(/\s+/g, " ").trim() }];
    }

    function formatVocabEntry(entry) {
      var meaning = String(entry.meaning || "").replace(/\s+/g, " ").trim();
      meaning = meaning.replace(/^(?:[+＋*＊∗✱]+\s*)+/, "").replace(/(?:\s*[+＋*＊∗✱]+)+$/, "").trim();
      return vocabStars(entry.mark) + " " + String(entry.word || "").trim() + ": " + meaning;
    }

    function normalizeVocabAnnotation(text) {
      return String(text || "").split("\n").map(function (line) {
        var entries = parseVocabEntries(line);
        if (!entries.length) return line;
        return entries.map(formatVocabEntry).join("\n");
      }).join("\n");
    }

    function vocabAnnotationHtml(text) {
      var entries = [];
      String(text || "").split("\n").forEach(function (line) {
        parseVocabEntries(line).forEach(function (entry) { entries.push(entry); });
      });
      return entries.map(function (entry) {
        var line = formatVocabEntry(entry);
        var parts = line.match(/^(\*+)\s+([^:]+):\s*(.*)$/);
        return '<p class="vocab-note"><span class="vocab-mark">' + textBlock(parts[1])
          + '</span> <span class="vocab-word">' + textBlock(parts[2])
          + "</span>: <span class=\"vocab-meaning\">" + textBlock(parts[3]) + "</span></p>";
      }).join("");
    }

    function renderVocabNotes(text) {
      if (!els.vocabNotes) return;
      var html = vocabAnnotationHtml(text);
      els.vocabNotes.innerHTML = html;
      els.vocabNotes.classList.toggle("hidden", !html);
    }

    function sanitizeOcrGlyphs(text) {
      return String(text || "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD\uFFFE\uFFFF]/g, "")
        .replace(/[\uE000-\uF8FF]/g, "")
        .replace(/[®©™℠℗ⓇⓒⒸ]/g, " ")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .trim();
    }

    function cleanChoiceBody(text) {
      return sanitizeOcrGlyphs(stripChoicePrefix(text)).replace(/^[®©™℠℗ⓇⓒⒸ@#*•·∙]+\s*/, "").trim();
    }

    function normalizeOptionMarks(text) {
      var marks = {
        "①": "1.", "②": "2.", "③": "3.", "④": "4.", "⑤": "5.",
        "⑥": "6.", "⑦": "7.", "⑧": "8.", "⑨": "9.", "⑩": "10.",
        "⑴": "1.", "⑵": "2.", "⑶": "3.", "⑷": "4.", "⑸": "5.",
        "❶": "1.", "❷": "2.", "❸": "3.", "❹": "4.", "❺": "5.",
        "➀": "1.", "➁": "2.", "➂": "3.", "➃": "4.", "➄": "5.",
        "㊀": "1.", "㊁": "2.", "㊂": "3.", "㊃": "4.", "㊄": "5."
      };
      return String(text || "").replace(/[①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸❶❷❸❹❺➀➁➂➃➄㊀㊁㊂㊃㊄]/g, function (ch) {
        return marks[ch] + " ";
      }).replace(/(^|\n)\s*[©Ⓒⓒ]\s*/g, function (_, lead) {
        return lead + "1. ";
      }).replace(/(^|\n)\s*@\s*(?=[A-Z가-힣])/g, function (_, lead) {
        return lead + "2. ";
      }).replace(/(^|\n)\s*(?:\(([1-5])\)|([1-5])\))\s*/g, function (_, lead, wrapped, plain) {
        return lead + (wrapped || plain) + ". ";
      }).replace(/(^|\n)\s*([1-5])\s*[.．](?!\d)\s*/g, function (_, lead, number) {
        return lead + number + ". ";
      }).replace(/[ \t]{2,}/g, " ");
    }

    function stripChoicePrefix(text) {
      return String(text || "").replace(/^\s*(?:[0-9]{1,2}\s*[.．)]\s*|[©Ⓒⓒ@®]\s*|[①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸❶❷❸❹❺➀➁➂➃➄]\s*|[（(]\s*[0-9]{1,2}\s*[)）]\s*)/, "").trim();
    }

    function stampChoiceNumber(text, number) {
      var body = cleanChoiceBody(text);
      if (!body) body = sanitizeOcrGlyphs(String(text || "").replace(/^\s*[^\s]+\s*/, ""));
      return number + ". " + body.trim();
    }

    function looksLikeBrokenMark(text) {
      return /^\s*(?:[©Ⓒⓒ@®]|[①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸❶❷❸❹❺➀➁➂➃➄]|[（(]\s*[0-9]{1,2}\s*[)）]|[0-9]{1,2}\s*[).．])/.test(String(text || ""));
    }

    function choiceZoneLines(lines) {
      var bottom = 0;
      lines.forEach(function (line) {
        if (line.y1 > bottom) bottom = line.y1;
      });
      if (!bottom) return [];
      var lower = lines.filter(function (line) { return line.y0 >= bottom * 0.48; });
      var marked = lower.filter(function (line) {
        var normalized = normalizeOptionMarks(line.text);
        return looksLikeBrokenMark(line.text) || /^[1-5]\.\s+\S/.test(normalized);
      });
      if (marked.length >= 2) return marked;
      var shortLines = lower.filter(function (line) {
        var role = classifyOcrLine(normalizeVocabAnnotation(normalizeOptionMarks(line.text)));
        return role !== "vocab" && role !== "question" && String(line.text || "").length < 140;
      });
      if (shortLines.length >= 2 && shortLines.length <= 5) return shortLines;
      return [];
    }

    function writeLineText(data, line, text) {
      function paint(list) {
        (list || []).forEach(function (item) {
          var box = item && item.bbox || {};
          if (Math.abs((Number(box.y0) || 0) - line.y0) < 0.5 && Math.abs((Number(box.x0) || 0) - line.x0) < 0.5) {
            item.text = text;
          }
        });
      }
      paint(data && data.lines);
      (data && data.blocks || []).forEach(function (block) {
        (block.paragraphs || []).forEach(function (paragraph) {
          paint(paragraph.lines);
        });
      });
    }

    function assignSequentialChoiceNumbers(lines) {
      var ordered = orderOcrLines(lines);
      var zone = choiceZoneLines(ordered);
      zone.forEach(function (line, index) {
        line.sequence = index + 1;
      });
      return zone;
    }

    async function refineChoiceDigits(worker, image, data) {
      var zone = assignSequentialChoiceNumbers(ocrLineRecords(data));
      zone.forEach(function (line) {
        writeLineText(data, line, stampChoiceNumber(line.text, line.sequence));
      });
      return data;
    }

    function ocrLineRecords(data) {
      var source = data && data.lines;
      if ((!source || !source.length) && data && data.blocks) {
        source = [];
        data.blocks.forEach(function (block) {
          (block.paragraphs || []).forEach(function (paragraph) {
            (paragraph.lines || []).forEach(function (line) { source.push(line); });
          });
        });
      }
      return (source || []).map(function (line) {
        var box = line && line.bbox || {};
        var text = line && line.text;
        if (!text && line && line.words) {
          text = line.words.map(function (word) { return word && word.text || ""; }).join(" ");
        }
        return {
          text: String(text || "").replace(/\s+/g, " ").trim(),
          x0: Number(box.x0) || 0,
          y0: Number(box.y0) || 0,
          y1: Number(box.y1) || 0
        };
      }).filter(function (line) { return line.text; });
    }

    function orderOcrLines(lines) {
      return lines.slice().sort(function (a, b) {
        var ay = Number(a.y0) || 0;
        var by = Number(b.y0) || 0;
        var height = Math.max(8, (((Number(a.y1) || ay) - ay) + ((Number(b.y1) || by) - by)) / 4);
        if (Math.abs(ay - by) > height) return ay - by;
        return (Number(a.x0) || 0) - (Number(b.x0) || 0);
      });
    }

    function isChoiceLine(text) {
      var clean = String(text || "").trim();
      if (!clean) return false;
      if (looksLikeBrokenMark(clean)) return true;
      return /^[1-5]\.\s+\S/.test(normalizeOptionMarks(clean));
    }

    function classifyOcrLine(text) {
      var clean = String(text || "").trim();
      if (!clean) return "empty";
      var hangul = (clean.match(/[가-힣]/g) || []).length;
      var latin = (clean.match(/[A-Za-z]/g) || []).length;
      if (/^[1-5]\.\s+\S/.test(clean)) return "choice";
      if (/다음|밑줄|빈칸|주어진|글의|내용과|고르|적절|일치|불일치|요지|주제|제목/.test(clean) && hangul >= 2) return "question";
      if (parseVocabEntries(clean).length || /[*＊]/.test(clean) || /[A-Za-z]{3,}\s*[:：]\s*[가-힣]/.test(clean)) return "vocab";
      if (hangul >= 2 && latin >= 3 && hangul >= latin && clean.length < 180 && !/[?]/.test(clean)) return "vocab";
      if (hangul > latin && hangul >= 4) return "question";
      return "passage";
    }

    function stripScoreMarks(text) {
      return String(text || "")
        .replace(/[\[【［(（]\s*\d{1,2}(?:\s*[.．]\s*\d+)?\s*점\s*[\]】］)）]/g, " ")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    }

    function isExamStem(text) {
      var value = String(text || "").trim();
      if (!value || parseVocabEntries(value).length) return false;
      var hangul = (value.match(/[가-힣]/g) || []).length;
      if (hangul < 4) return false;
      return /다음\s*글|밑줄\s*친|빈칸에|주어진\s*글|가장\s*적절한|고르시오|골라|내용과\s*일치|일치하지|불일치|요지|주제|제목|흐름으로|순서에|삽입하|요약하|지칭|어법|어휘의\s*쓰임|배점|들어가기에/.test(value);
    }

    function salvageEnglish(text) {
      var parts = String(text || "").split(/(?<=[?？.])\s+(?=[A-Z])/);
      if (parts.length < 2) return "";
      var tail = parts.slice(1).join(" ").trim();
      var latin = (tail.match(/[A-Za-z]/g) || []).length;
      var hangul = (tail.match(/[가-힣]/g) || []).length;
      if (latin >= 20 && latin > hangul) return tail;
      return "";
    }

    function extractExamBody(text) {
      var kept = [];
      String(text || "").split(/\n/).forEach(function (rawLine) {
        var line = stripScoreMarks(String(rawLine || "").replace(/[ \t]+/g, " ").trim());
        if (!line) return;
        var vocab = normalizeVocabAnnotation(line);
        if (parseVocabEntries(line).length || parseVocabEntries(vocab).length) {
          kept.push(vocab);
          return;
        }
        var head = line.match(/^\s*(?:[\[【［(（]\s*(\d{1,2})\s*[\]】］)）]|(\d{1,2})\s*[.．)](?!\d))\s*([\s\S]*)$/);
        if (head) {
          var number = Number(head[1] || head[2]);
          var rest = stripScoreMarks(head[3] || "");
          if (!rest || isExamStem(rest) || isExamStem(line)) {
            var saved = salvageEnglish(rest);
            if (saved) kept.push(saved);
            return;
          }
          if (number >= 1 && number <= 5) return;
          line = rest;
        }
        if (/^\s*[\[【［(（]?\s*\d{1,2}\s*점\s*[\]】］)）]?\s*$/.test(line)) return;
        if (isExamStem(line)) {
          var savedStem = salvageEnglish(line);
          if (savedStem) kept.push(savedStem);
          return;
        }
        if (isChoiceLine(line)) return;
        var hangul = (line.match(/[가-힣]/g) || []).length;
        var latin = (line.match(/[A-Za-z]/g) || []).length;
        if (hangul >= 6 && latin < 8) return;
        kept.push(line);
      });
      return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }

    function analysisPassage(text) {
      return extractExamBody(text).split("\n").map(function (line) {
        var value = line.trim();
        if (!value) return "";
        if (parseVocabEntries(value).length && !/[.!?…]$/.test(value)) return value + ".";
        return value;
      }).filter(Boolean).join("\n");
    }

    function structureOcrText(data) {
      var rows = orderOcrLines(ocrLineRecords(data)).map(function (line) {
        var text = sanitizeOcrGlyphs(normalizeOptionMarks(normalizeOcrPunctuation(normalizeVocabAnnotation(line.text))));
        var role = isChoiceLine(line.text) || isChoiceLine(text) ? "choice" : classifyOcrLine(text);
        return { text: text, role: role, y0: line.y0, x0: line.x0 };
      }).filter(function (row) { return row.text && row.role !== "empty"; });
      if (!rows.length) return sanitizeOcrGlyphs(normalizeOptionMarks(cleanOcrText(data && data.text)));
      var cluster = [];
      var index = rows.length - 1;
      while (index >= 0 && (rows[index].role === "choice" || isChoiceLine(rows[index].text))) {
        cluster.push(index);
        index -= 1;
      }
      cluster.reverse().forEach(function (rowIndex, order) {
        rows[rowIndex].role = "choice";
        rows[rowIndex].text = stampChoiceNumber(rows[rowIndex].text, order + 1);
      });
      var blocks = [];
      rows.forEach(function (row) {
        var last = blocks[blocks.length - 1];
        if (!last || last.role !== row.role) blocks.push({ role: row.role, lines: [row.text] });
        else last.lines.push(row.text);
      });
      return blocks.map(function (block) {
        return block.lines.join(block.role === "passage" ? " " : "\n");
      }).filter(Boolean).join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    }

    function applyOcrFallback() {
      writePassage(SAMPLE_PASSAGE);
      setOcrStatus(OCR_FAIL, false, true);
    }

    function resetOcrWorker() {
      var worker = ocrWorker;
      ocrWorker = null;
      ocrWorkerPromise = null;
      ocrWorkerToken += 1;
      if (worker && worker.terminate) worker.terminate();
    }

    function loadOcrWorker() {
      if (ocrWorker) return Promise.resolve(ocrWorker);
      if (ocrWorkerPromise) return ocrWorkerPromise;
      if (!window.Tesseract || typeof Tesseract.createWorker !== "function") {
        return Promise.reject(new Error("ocr-library"));
      }
      var token = ++ocrWorkerToken;
      ocrWorkerPromise = Tesseract.createWorker("kor+eng", 1, {
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
        langPath: "https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0_fast",
        cacheMethod: "write",
        gzip: true,
        logger: function (message) {
          if (ocrListen !== ocrJob || !message) return;
          var status = String(message.status || "");
          var label = "글자 인식을 준비하고 있습니다";
          if (status === "recognizing text") label = "사진에서 한글과 영어를 읽고 있습니다";
          else if (status.indexOf("language") >= 0) label = "한국어와 영어 인식 데이터를 받는 중입니다. 처음 한 번은 조금 걸립니다";
          else if (status.indexOf("core") >= 0 || status.indexOf("initializing") >= 0) label = "글자 인식 엔진을 준비하고 있습니다";
          var progress = typeof message.progress === "number" ? message.progress : null;
          var pct = progress == null ? "…" : "… " + Math.round(progress * 100) + "%";
          setOcrStatus(label + pct, true, false, progress);
        }
      }).then(function (worker) {
        if (token !== ocrWorkerToken) {
          if (worker && worker.terminate) worker.terminate();
          throw new Error("ocr-reset");
        }
        ocrWorker = worker;
        ocrWorkerPromise = null;
        return worker;
      }).catch(function (error) {
        if (token === ocrWorkerToken) {
          ocrWorker = null;
          ocrWorkerPromise = null;
        }
        throw error;
      });
      return ocrWorkerPromise;
    }

    function warmOcrWorker() {
      loadOcrWorker().catch(function () {});
    }

    function stopOcrListen(job) {
      if (ocrListen === job) ocrListen = 0;
    }

    async function runOcr(job, dataUrl) {
      if (job !== ocrJob) return;
      var timedOut = false;
      var timer = window.setTimeout(function () {
        timedOut = true;
        if (job !== ocrJob) return;
        stopOcrListen(job);
        resetOcrWorker();
        applyOcrFallback();
      }, 120000);
      try {
        var worker = await loadOcrWorker();
        if (timedOut || job !== ocrJob) return;
        var result = await worker.recognize(dataUrl);
        if (timedOut || job !== ocrJob) return;
        setOcrStatus("읽어 낸 글을 정리하고 있습니다…", true, false, 1);
        await yieldToUi();
        var data = await refineChoiceDigits(worker, dataUrl, result && result.data || {});
        if (timedOut || job !== ocrJob) return;
        window.clearTimeout(timer);
        stopOcrListen(job);
        var text = structureOcrText(data);
        var latin = (text.match(/[A-Za-z]/g) || []).length;
        var hangul = (text.match(/[가-힣]/g) || []).length;
        var confidence = typeof data.confidence === "number" ? data.confidence : 0;
        var weak = (hangul < 8 && latin < 40) || (confidence > 0 && confidence < 30 && hangul + latin < 40);
        if (weak) {
          applyOcrFallback();
          return;
        }
        var body = extractExamBody(text);
        var bodyLatin = (body.match(/[A-Za-z]/g) || []).length;
        writePassage(bodyLatin >= 20 ? body : text);
        setOcrStatus("사진에서 한글 " + hangul.toLocaleString("ko-KR") + "자와 영어 " + latin.toLocaleString("ko-KR") + "자를 읽었습니다. 아래 칸에서 맞는지 확인하고, 틀린 곳은 직접 고치세요.", false, false);
      } catch (error) {
        window.clearTimeout(timer);
        if (timedOut || job !== ocrJob) return;
        stopOcrListen(job);
        resetOcrWorker();
        applyOcrFallback();
      }
    }

    function readImageText(image) {
      if (!image || !image.dataUrl) return;
      var job = ++ocrJob;
      ocrListen = job;
      var dataUrl = image.dataUrl;
      setOcrStatus("사진에서 글자를 읽고 있습니다…", true, false);
      ocrQueue = ocrQueue.then(function () {
        return runOcr(job, dataUrl);
      }).catch(function () {});
    }

    function ApiError(message, status) {
      this.name = "ApiError";
      this.message = message;
      this.status = status || 0;
    }
    ApiError.prototype = Object.create(Error.prototype);

    function messageText(content) {
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map(function (part) {
          return part && (part.text || part.content) || "";
        }).join("");
      }
      return "";
    }

    async function readError(response) {
      var detail = response.status + " " + response.statusText;
      try {
        var body = await response.json();
        if (body.error && (body.error.message || body.error.status)) {
          detail = body.error.message || body.error.status;
        }
      } catch (error) {
        /* 본문이 JSON이 아니면 상태 코드만 보여 줍니다. */
      }
      if (response.status === 401 || response.status === 403) {
        return "키가 거부되었습니다. 키와 선택한 서비스가 같은지 확인해 주세요. (" + detail + ")";
      }
      if (response.status === 429) {
        return "요청이 많거나 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요. (" + detail + ")";
      }
      return "API 오류 (" + response.status + "): " + detail;
    }

    function networkMessage() {
      if (location.protocol === "file:") {
        return "파일을 더블클릭해서 열면 브라우저가 API 응답을 막을 수 있습니다. 이 폴더에서 python3 server.py 를 실행한 뒤 http://localhost:8000 으로 여세요.";
      }
      return "API 서버에 연결하지 못했습니다. 인터넷을 확인하고, OpenAI가 계속 막히면 설정에서 Gemini로 바꿔 보세요.";
    }

    async function askOpenAI(settings, system, userText, image, temperature, signal) {
      var attempts = [
        { json: true, temperature: true },
        { json: false, temperature: false }
      ];
      var lastError = null;
      for (var i = 0; i < attempts.length; i += 1) {
        try {
          return await openAIOnce(settings, system, userText, image, temperature, signal, attempts[i]);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          lastError = error;
          var retry = error instanceof ApiError && (error.status === 400 || /response_format|temperature|json_object|unsupported|image/i.test(error.message));
          if (!retry) throw error;
        }
      }
      throw lastError;
    }

    function visionImage(image) {
      if (!image || !image.dataUrl) return null;
      var dataUrl = String(image.dataUrl).replace(/\s/g, "");
      var match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || match[2].length < 32) return null;
      return { dataUrl: "data:" + match[1] + ";base64," + match[2], mime: match[1], base64: match[2] };
    }

    function openAIEndpoint(settings) {
      var base = String(settings && settings.baseUrl || DEFAULT_BASE).trim();
      var allowed = /^https:\/\//i.test(base) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(base);
      if (!allowed) base = DEFAULT_BASE;
      return base.replace(/\/+$/, "").replace(/\/chat\/completions$/, "") + "/chat/completions";
    }

    function isConnectionError(error) {
      var message = String(error && error.message || "");
      return /연결하지 못했습니다|더블클릭|Failed to fetch|NetworkError|network|Load failed|인터넷|ECONN|타임아웃|CORS|cross-origin/i.test(message);
    }

    function canSimulate(error) {
      var message = String(error && error.message || "");
      return !/사진을 읽지|JPG 또는 PNG/.test(message);
    }

    function simulationReason(error, timedOut) {
      if (timedOut) return "응답 시간이 넘어 예시로 표시";
      var status = error && error.status;
      if (status === 401 || status === 403) return "키가 거부되어 예시로 표시";
      if (status === 429) return "사용 한도로 예시로 표시";
      if (status >= 500) return "서버 오류로 예시로 표시";
      if (isConnectionError(error)) return "API에 연결하지 못해 예시로 표시";
      return "API 응답 오류로 예시로 표시";
    }

    async function openAIOnce(settings, system, userText, image, temperature, signal, attempt) {
      var packed = visionImage(image);
      if (image && !packed) throw new ApiError("사진 데이터를 읽지 못했습니다. JPG 또는 PNG로 다시 올려 주세요.");
      var userContent = userText;
      if (packed) {
        userContent = [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: packed.dataUrl, detail: "high" } }
        ];
      }
      var body = {
        model: settings.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent }
        ]
      };
      if (attempt.temperature) body.temperature = temperature;
      if (attempt.json) body.response_format = { type: "json_object" };
      if (/^(gpt-5|gpt-6|o\d)/.test(settings.model)) body.max_completion_tokens = 5000;
      else body.max_tokens = 4000;

      var response;
      try {
        response = await fetch(openAIEndpoint(settings), {
          method: "POST",
          signal: signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + settings.apiKey
          },
          body: JSON.stringify(body)
        });
      } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new ApiError(networkMessage());
      }
      if (!response.ok) throw new ApiError(await readError(response), response.status);
      var data = await response.json();
      var refusal = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.refusal;
      if (refusal) throw new ApiError(String(refusal));
      var text = messageText(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
      if (!text.trim()) throw new ApiError("모델 응답이 비어 있습니다. 다른 모델로 다시 시험해 주세요.");
      return { text: text, tokens: data.usage && data.usage.total_tokens || 0 };
    }

    async function askGemini(settings, system, userText, image, temperature, signal, schema) {
      try {
        return await geminiOnce(settings, system, userText, image, temperature, signal, true, schema);
      } catch (error) {
        if (error.name === "AbortError") throw error;
        var schemaProblem = schema && error instanceof ApiError && error.status === 400 && /schema|responseSchema|unknown name/i.test(error.message);
        var mimeProblem = error instanceof ApiError && /responseMimeType|response_mime|mime type|unknown name|responseSchema|schema/i.test(error.message);
        if (!schemaProblem && !mimeProblem) throw error;
        return geminiOnce(settings, system, userText, image, temperature, signal, !mimeProblem, null);
      }
    }

    async function geminiOnce(settings, system, userText, image, temperature, signal, forceJson, schema) {
      var packed = visionImage(image);
      if (image && !packed) throw new ApiError("사진 데이터를 읽지 못했습니다. JPG 또는 PNG로 다시 올려 주세요.");
      var parts = [];
      if (packed) {
        parts.push({
          inline_data: {
            mime_type: packed.mime,
            data: packed.base64
          }
        });
      }
      parts.push({ text: userText });
      var modelName = String(settings.model || defaultModel("gemini")).trim() || defaultModel("gemini");
      var endpoint = "https://generativelanguage.googleapis.com/v1beta/models/"
        + encodeURIComponent(modelName) + ":generateContent";
      var generationConfig = { temperature: temperature };
      if (forceJson) generationConfig.responseMimeType = "application/json";
      if (schema) generationConfig.responseSchema = schema;
      var response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          signal: signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": settings.apiKey
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system || "" }] },
            contents: [{ role: "user", parts: parts }],
            generationConfig: generationConfig
          })
        });
      } catch (error) {
        if (error.name === "AbortError") throw error;
        throw new ApiError(networkMessage());
      }
      if (!response.ok) throw new ApiError(await readError(response), response.status);
      var data = await response.json();
      var block = data.promptFeedback && data.promptFeedback.blockReason;
      if (block) throw new ApiError("요청이 안전 정책으로 차단되었습니다. (" + block + ")");
      var partsOut = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [];
      var text = partsOut.map(function (part) { return part.text || ""; }).join("");
      if (!text.trim()) throw new ApiError("모델 응답이 비어 있습니다. 모델 이름을 확인해 주세요.");
      var tokens = data.usageMetadata && data.usageMetadata.totalTokenCount || 0;
      return { text: text, tokens: tokens };
    }

    function askModel(settings, system, userText, image, temperature, signal) {
      if (settings.provider === "gemini") {
        return askGemini(settings, system, userText, image, temperature, signal);
      }
      return askOpenAI(settings, system, userText, image, temperature, signal);
    }

    async function refreshEnvGemini() {
      envGeminiReady = false;
      try {
        var response = await fetch("/api/gemini/status", { cache: "no-store" });
        if (!response.ok) return;
        var data = await response.json();
        envGeminiReady = Boolean(data && data.configured);
        envGeminiModel = data && data.model ? String(data.model) : defaultModel("gemini");
      } catch (error) {
        envGeminiReady = false;
      }
    }

    async function resolveGeminiSettings(task) {
      await refreshEnvGemini();
      if (envGeminiReady) {
        return {
          provider: "gemini",
          fromEnv: true,
          model: envGeminiModel || defaultModel("gemini"),
          apiKey: "env"
        };
      }
      var saved = loadSettings();
      if (task === "translate" && !(saved && saved.provider === "gemini")) return null;
      return saved;
    }

    async function askGeminiFromEnv(system, userText, image, temperature, signal, schema) {
      var packed = image ? visionImage(image) : null;
      if (image && !packed) throw new ApiError("사진 데이터를 읽지 못했습니다. JPG 또는 PNG로 다시 올려 주세요.");
      async function post(activeSchema) {
        var response;
        try {
          response = await fetch("/api/gemini", {
            method: "POST",
            signal: signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: envGeminiModel || defaultModel("gemini"),
              system: system,
              user: userText,
              temperature: temperature,
              schema: activeSchema || null,
              image: packed ? { mime: packed.mime, base64: packed.base64 } : null
            })
          });
        } catch (error) {
          if (error.name === "AbortError") throw error;
          throw new ApiError(networkMessage());
        }
        var body = {};
        try {
          body = await response.json();
        } catch (error) {
          body = {};
        }
        if (!response.ok) throw new ApiError(body.error || ("API 오류 (" + response.status + ")"), response.status);
        if (!String(body.text || "").trim()) throw new ApiError("모델 응답이 비어 있습니다. 모델 이름을 확인해 주세요.");
        return { text: body.text, tokens: body.tokens || 0 };
      }
      try {
        return await post(schema);
      } catch (error) {
        if (error.name === "AbortError" || !schema) throw error;
        if (!(error instanceof ApiError) || error.status !== 400) throw error;
        if (!/schema|responseMime|mime type|unknown name/i.test(error.message)) throw error;
        return post(null);
      }
    }

    function parseModelJson(text) {
      var trimmed = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      var start = trimmed.indexOf("{");
      var end = trimmed.lastIndexOf("}");
      if (start < 0 || end < start) throw new Error("JSON 아님");
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    function buildUserPrompt(instruction, passage, hasImage) {
      var source = passage || "(텍스트 없음. 첨부 이미지를 읽어 영어 지문을 복원하세요.)";
      var extra = hasImage
        ? "\n\n이미지가 첨부되어 있습니다. 텍스트가 비어 있을 때만 이미지를 읽고, 텍스트가 있으면 텍스트를 기준으로 하세요."
        : "";
      var plan = "";
      if (passage && instruction.indexOf("직독직해") >= 0) plan = "\n\n" + chunkPlanText(passage);
      return instruction + extra + plan + "\n\n지문:\n\"\"\"\n" + source + "\n\"\"\"";
    }

    function chunkPlanText(passage) {
      var sentences = segmentSentences(passage);
      var lines = [
        "아래 각 줄은 슬래시(/)가 포함된 영어 문장 전체입니다. 이 문장을 통째로 번역하십시오.",
        "조각을 개별 요청으로 나누지 마십시오. engChunks는 슬래시 사이의 원문이고, korChunks 길이는 engChunks 길이와 같아야 합니다."
      ];
      sentences.forEach(function (sentence, index) {
        lines.push((index + 1) + ". " + slashSentence(sentence));
      });
      return lines.join("\n");
    }

    function setHeading(task) {
      var info = TASKS[task];
      if (!info) {
        els.resultKicker.textContent = "READY";
        els.resultTitle.textContent = "분석 결과";
        return;
      }
      els.resultKicker.textContent = info.kicker;
      els.resultTitle.textContent = info.title;
    }

    function markSelected() {
      document.querySelectorAll(".task-btn").forEach(function (button) {
        var on = button.dataset.task === selectedTask;
        button.dataset.active = on ? "true" : "false";
        button.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function syncSubmitLabel(busy) {
      if (!els.submit) return;
      els.submit.disabled = Boolean(busy);
      els.submit.textContent = busy ? "분석 중…" : (isSubmitted ? "분석 제출" : "제출");
      if (!els.submitHint) return;
      els.submitHint.textContent = isSubmitted
        ? "분석을 고른 뒤 제출하면 결과가 오른쪽 칸에 나타납니다."
        : "지문을 넣은 뒤 제출하면 해석, 요약, 해설, 변형 문제가 열립니다.";
    }

    function setInputMessage(text) {
      if (!els.inputMessage) return;
      els.inputMessage.textContent = text || "";
      els.inputMessage.classList.toggle("hidden", !text);
    }

    function applyWorkspace(animate) {
      els.appScreen.dataset.ready = isSubmitted ? "true" : "false";
      [els.analysisTools, els.resultPanel].forEach(function (node) {
        if (!node) return;
        node.classList.toggle("is-concealed", !isSubmitted);
        node.setAttribute("aria-hidden", isSubmitted ? "false" : "true");
        if (!isSubmitted) node.classList.remove("is-revealed");
        if (isSubmitted && animate) {
          node.classList.remove("is-revealed");
          void node.offsetWidth;
          node.classList.add("is-revealed");
        }
      });
      syncSubmitLabel(false);
    }

    function revealWorkspace() {
      var passage = els.passage.value.trim();
      if (passage.length < 40 && !imageFile) {
        setInputMessage(passage
          ? "지문이 너무 짧습니다. 해석할 문장이 있는 한 문단을 넣어 주세요."
          : "영어 지문을 입력하거나, 지문이 보이는 사진을 올린 뒤 제출해 주세요.");
        return;
      }
      setInputMessage("");
      isSubmitted = true;
      applyWorkspace(true);
      if (window.matchMedia("(max-width: 1023px)").matches && els.analysisTools) {
        els.analysisTools.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function resetWorkspace() {
      isSubmitted = false;
      setInputMessage("");
      applyWorkspace(false);
    }

    function setBusy(task, busy) {
      document.querySelectorAll(".task-btn").forEach(function (button) {
        button.disabled = busy;
      });
      syncSubmitLabel(busy);
      markSelected();
    }

    function showResultActions(visible) {
      els.copyResult.classList.toggle("hidden", !visible);
      els.clearResult.classList.toggle("hidden", !visible);
    }

    function renderEmpty() {
      setHeading(null);
      els.resultBody.dataset.state = "empty";
      els.resultBody.innerHTML = "";
      els.resultBody.appendChild(els.emptyTemplate.content.cloneNode(true));
      els.resultMeta.textContent = "아직 실행하지 않았습니다.";
      showResultActions(false);
      document.querySelectorAll(".task-btn").forEach(function (button) {
        button.disabled = false;
      });
      syncSubmitLabel(false);
      markSelected();
    }

    function renderLoading(task) {
      var info = TASKS[task];
      setHeading(task);
      els.resultBody.dataset.state = "loading";
      var extra = imageFile && !els.passage.value.trim() ? " 사진 속 글자를 함께 읽고 있습니다." : "";
      els.resultBody.innerHTML = ''
        + '<div class="wait-row">'
        + '<span class="spinner"></span>'
        + "<span>" + esc(info.loading + extra) + "</span></div>"
        + '<div class="progress-track" aria-hidden="true"><div id="task-progress-bar" class="progress-bar"></div></div>'
        + '<div class="skeleton" aria-hidden="true">'
        + '<div class="skel skel-lg"></div>'
        + '<div class="skel"></div>'
        + '<div class="skel skel-sm"></div></div>'
        + '<button type="button" id="cancel-run" class="btn-ghost mt-6 px-0">취소</button>';
      els.resultMeta.textContent = "응답을 기다리는 중입니다. 긴 지문이나 사진은 1분 안팎이 걸릴 수 있습니다.";
      showResultActions(false);
      document.getElementById("cancel-run").addEventListener("click", function () {
        if (abortController) abortController.abort();
      });
      if (window.matchMedia("(max-width: 1023px)").matches) {
        els.resultTitle.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function renderError(message, extraHtml) {
      els.resultBody.dataset.state = "error";
      els.resultBody.innerHTML = ''
        + (extraHtml || "")
        + '<div class="error-box">'
        + textBlock(message) + "</div>";
      els.resultMeta.textContent = "";
      showResultActions(true);
    }

    function transcriptHtml(data) {
      var transcript = data && typeof data.transcript === "string" ? data.transcript.trim() : "";
      if (!transcript) return "";
      return ''
        + '<details class="transcript" open>'
        + '<summary>사진에서 읽은 지문</summary>'
        + '<p class="passage-face mt-3 text-[15px] leading-7 break-words">' + textBlock(transcript) + "</p></details>";
    }

    function answerNumber(value, optionCount) {
      if (typeof value === "number" && value >= 1 && value <= optionCount) return value;
      var text = String(value == null ? "" : value).trim();
      var circled = CIRCLED.indexOf(text);
      if (circled >= 0 && circled < optionCount) return circled + 1;
      var match = text.match(/[1-9]/);
      if (!match) return null;
      var number = Number(match[0]);
      return number >= 1 && number <= optionCount ? number : null;
    }

    function renderBlankPassage(passage) {
      return textBlock(passage).replace(/_{3,}|\[blank\]/gi, '<span class="blank-slot">________</span>');
    }

    function questionCard(item) {
      var options = asArray(item.options);
      var answer = answerNumber(item.answer, options.length);
      var optionHtml = options.map(function (option, index) {
        var body = cleanChoiceBody(String(option || ""));
        return '<li class="choice" data-option="' + (index + 1) + '">'
          + '<span class="choice-no">' + (index + 1) + ".</span> " + textBlock(body) + "</li>";
      }).join("");
      var answerLabel = answer ? answer + "." : "번호 확인 필요";
      return ''
        + '<article class="q-card" data-question>'
        + '<p class="q-kicker">문제 ' + item.index + "</p>"
        + '<p class="mt-1 text-sm font-semibold">' + textBlock(item.instruction) + "</p>"
        + '<div class="mt-4">' + item.body + "</div>"
        + '<ol class="option-list">' + optionHtml + "</ol>"
        + '<button type="button" class="reveal" data-reveal>정답과 해설 보기</button>'
        + '<div class="answer-panel hidden" data-answer="' + (answer || "") + '">'
        + '<p class="navy text-sm font-semibold">정답 ' + esc(answerLabel) + "</p>"
        + '<p class="mt-2 text-sm leading-6">' + textBlock(item.explanation) + "</p></div></article>";
    }

    var PHRASAL_VERBS = {
      "look after": 1, "look for": 1, "look into": 1, "look over": 1,
      "give in": 1, "take after": 1, "take in": 1, "take on": 1, "take over": 1, "take to": 1,
      "come across": 1, "come in": 1, "come on": 1, "come over": 1, "come by": 1, "come from": 1, "come to": 1,
      "go on": 1, "go through": 1, "go over": 1, "go after": 1, "go for": 1, "go by": 1,
      "get on": 1, "get in": 1, "get over": 1, "get through": 1, "get by": 1, "get at": 1,
      "run into": 1, "run over": 1, "run by": 1, "run after": 1, "run through": 1,
      "turn in": 1, "turn on": 1, "turn over": 1, "turn to": 1,
      "put on": 1, "put in": 1, "put through": 1,
      "call on": 1, "call for": 1, "call in": 1,
      "ask for": 1, "care for": 1, "wait for": 1, "listen to": 1, "belong to": 1,
      "lead to": 1, "refer to": 1, "speak to": 1, "talk to": 1, "talk about": 1,
      "depend on": 1, "rely on": 1, "deal with": 1, "agree with": 1, "consist of": 1,
      "think of": 1, "think about": 1, "hear of": 1, "hear about": 1, "hear from": 1,
      "dream of": 1, "dream about": 1, "result in": 1, "result from": 1,
      "believe in": 1, "arrive at": 1, "arrive in": 1, "pay for": 1,
      "account for": 1, "apply for": 1, "approve of": 1, "break into": 1, "break through": 1,
      "work on": 1, "live on": 1, "live with": 1, "stand for": 1, "stand by": 1, "stick to": 1,
      "worry about": 1, "write about": 1, "settle for": 1, "settle in": 1
    };

    function phrasalBases(word) {
      var low = String(word || "").toLowerCase();
      var forms = [low];
      if (/ing$/.test(low) && low.length > 5) forms.push(low.slice(0, -3), low.slice(0, -3) + "e");
      if (/ied$/.test(low)) forms.push(low.slice(0, -3) + "y");
      else if (/ed$/.test(low) && low.length > 4) forms.push(low.slice(0, -2), low.slice(0, -1));
      else if (/s$/.test(low) && !/ss$/.test(low) && low.length > 3) forms.push(low.slice(0, -1));
      return forms;
    }

    function isPhrasalParticle(verb, particle) {
      var bases = phrasalBases(verb);
      var tail = String(particle || "").toLowerCase();
      for (var i = 0; i < bases.length; i += 1) {
        if (PHRASAL_VERBS[bases[i] + " " + tail]) return true;
      }
      return false;
    }

    function slashSentenceCompute(sentence) {
      var tokens = [];
      var re = /[A-Za-z]+(?:['’][A-Za-z]+)?|\d+|[—–]|[^\s]/g;
      var text = String(sentence || "").replace(/\s*\/\/+\s*/g, " ").replace(/\s+\/\s+/g, " ").replace(/\s+/g, " ").trim();
      var match;
      while ((match = re.exec(text))) tokens.push(match[0]);
      var wordIndexes = [];
      tokens.forEach(function (token, index) {
        if (/^[A-Za-z0-9]/.test(token)) wordIndexes.push(index);
      });
      var words = wordIndexes.map(function (index) { return tokens[index]; });
      if (words.length < 4) return text;
      var breakAt = {};
      var infinitiveBreak = {};
      var last = 0;
      function mark(wordPos, loose) {
        var gap = wordPos - last;
        if (loose ? gap < 1 : gap < 3) return;
        if (words.length - wordPos < 2) return;
        breakAt[wordIndexes[wordPos]] = true;
        last = wordPos;
      }
      function gapBefore(wordPos) {
        var start = wordPos === 0 ? 0 : wordIndexes[wordPos - 1] + 1;
        return tokens.slice(start, wordIndexes[wordPos]).join("");
      }
      function openDash(wordPos) {
        var count = 0;
        for (var index = 0; index < wordIndexes[wordPos]; index += 1) {
          if (tokens[index] === "—" || tokens[index] === "–") count += 1;
        }
        return count % 2 === 1;
      }
      var subord = /^(when|if|although|though|because|while|whereas|unless|until|since|whether)$/i;
      var subject = /^(i|you|we|they|he|she|it|this|there|readers|people|one)$/i;
      var verbish = /^(can|could|will|would|may|might|must|should|is|are|was|were|am|be|have|has|had|do|does|did|read|learn|improve|make|get|take|see|know|think|want|need|use|find|give|tell|become|seem|keep|let|begin|treat|perform|performs|establish|miss|notice|enter|appear|appears|gather|gathers|tell|tells|rush)$/i;
      function looksVerb(word) {
        return verbish.test(word) || (word.length > 4 && /(?:ed|ing|s)$/i.test(word));
      }
      var coordinator = /^(and|but|or|nor|yet|so)$/i;
      var relative = /^(who|whom|whose|which)$/i;
      var prep = /^(in|on|at|to|with|from|by|for|of|about|through|over|under|between|after|before|into|onto|upon|without|within|during|against|among|across|around|behind|beyond|toward|towards|until|till|since|despite|except|near|above|below|beside|besides|inside|outside|along|via|as)$/i;
      var idiomPrep = {
        "spite of": 1, "front of": 1, "terms of": 1, "case of": 1, "because of": 1,
        "instead of": 1, "out of": 1, "lot of": 1, "lots of": 1, "kind of": 1, "sort of": 1,
        "means of": 1, "behalf of": 1, "top of": 1, "course of": 1, "order to": 1,
        "addition to": 1, "relation to": 1, "response to": 1, "according to": 1,
        "due to": 1, "next to": 1, "prior to": 1, "thanks to": 1, "owing to": 1,
        "such as": 1, "well as": 1, "soon as": 1, "long as": 1, "search of": 1
      };
      function idiomHoldsPrep(wordPos) {
        var word = words[wordPos].toLowerCase();
        var prev1 = (words[wordPos - 1] || "").toLowerCase();
        var prev2 = (words[wordPos - 2] || "").toLowerCase();
        return !!(idiomPrep[prev1 + " " + word] || idiomPrep[prev2 + " " + prev1 + " " + word]);
      }
      function isInfinitiveTo(wordPos) {
        if (!/^to$/i.test(words[wordPos])) return false;
        var next = words[wordPos + 1] || "";
        if (!/^[A-Za-z]/.test(next)) return false;
        if (/^(the|a|an|this|that|these|those|my|your|his|her|our|their|its|some|any|every|each|no|him|them|us|me|whom|which|whose|what|who|where|when|why|how)$/i.test(next)) return false;
        if (/^[A-Z]/.test(next)) return false;
        if (prep.test(next) || coordinator.test(next) || relative.test(next)) return false;
        return true;
      }
      function isContentVerb(word) {
        var low = String(word || "");
        if (/^(am|is|are|was|were|be|been|being|do|does|did|can|could|will|would|may|might|must|should|shall|not|never|literary|opening|demanding|cracked|repeated|unexpected|unopened|interesting|following|according|nothing|something|everything|during|reading|meaning)$/i.test(low)) return false;
        if (/^(have|has|had)$/i.test(low)) return true;
        if (looksVerb(low)) return true;
        return /^(go|went|come|came|eat|ate|make|made|see|saw|know|knew|get|got|take|took|want|need|give|gave|tell|told|think|thought|say|said|treat|leave|left|walk|walked|figure|figured|find|found|wait|learn|learned|improve|perform|performs|establish|notice|enter|appear|appears|gather|gathers|rush|miss|stop|stopped|arrive|arrived|stay|stayed|nod|nodded)$/i.test(low);
      }
      function isBareObject(wordPos) {
        if (wordPos < 2 || words.length - wordPos < 2) return false;
        if (!/^(the|a|an|this|that|these|those|some|any|every|each|no|my|your|his|her|our|their|its|another)$/i.test(words[wordPos])) return false;
        var prev = words[wordPos - 1];
        if (prep.test(prev) || coordinator.test(prev) || relative.test(prev)) return false;
        if (!isContentVerb(prev)) return false;
        if (wordPos - last < 3) return false;
        for (var k = wordPos + 1; k < words.length && k < wordPos + 3; k += 1) {
          if (k === clauseSubject || coordinator.test(words[k])) return false;
          if (prep.test(words[k]) && !isInfinitiveTo(k) && !idiomHoldsPrep(k)) return false;
        }
        return true;
      }
      function markPrep(wordPos) {
        if (wordPos < 1 || words.length - wordPos < 2) return;
        if (/^at$/i.test(words[wordPos]) && /^least$/i.test(words[wordPos + 1] || "")) return;
        if (wordPos - last < 2) return;
        if (isInfinitiveTo(wordPos) || idiomHoldsPrep(wordPos)) return;
        if (isPhrasalParticle(words[wordPos - 1], words[wordPos])) return;
        breakAt[wordIndexes[wordPos]] = true;
        last = wordPos;
      }
      function isFiniteVerb(word, afterHead) {
        var low = String(word || "");
        if (/^(am|is|are|was|were|be|been|being|do|does|did|can|could|will|would|may|might|must|should|shall|have|has|had)$/i.test(low)) return true;
        if (/^(make|makes|made|help|helps|helped|allow|allows|allowed|offer|offers|offered|provide|provides|provided|create|creates|created|show|shows|showed|bring|brings|brought|lead|leads|led|cause|causes|caused|require|requires|required|include|includes|included|involve|involves|involved|suggest|suggests|suggested|mean|means|meant|seem|seems|seemed|appear|appears|appeared|remain|remains|remained|become|becomes|became|enable|enables|enabled|give|gives|gave|take|takes|took|say|says|said|go|goes|went|come|comes|came|see|sees|saw|know|knows|knew|get|gets|got|want|wants|need|needs|tell|tells|told|think|thinks|thought|find|finds|found|keep|keeps|kept|let|lets|begin|begins|began|leave|leaves|left|use|uses|call|calls|called|work|works|worked|play|plays|played|try|tries|tried|start|starts|started|stop|stops|stopped|turn|turns|turned|run|runs|ran|put|puts|set|sets|ask|asks|asked|figure|figures|figured|read|reads|eat|eats|ate|treat|treats|treated|perform|performs|establish|establishes|notice|notices|enter|enters|gather|gathers|rush|rushes|miss|misses)$/i.test(low)) return true;
        if (afterHead && /ed$/i.test(low) && low.length > 4 && !/^(unexpected|unopened|repeated|interested|supposed|alleged|complicated|limited|related|dedicated|sophisticated|cultivated)$/i.test(low)) return true;
        return false;
      }
      function isPrepModifier(word) {
        return /^(the|a|an|this|that|these|those|my|your|his|her|our|their|its|some|any|every|each|no|another|both|few|many|much|several|such|own|very|really|more|most|quite|rather|too|so|not|only|just|other|same|first|second|next|last|new|old|good|bad|great|little|small|large|high|low|long|short|early|late|young|main|public|social|political|cultural|economic|local|global|human|real|true|possible|important|different|various|certain|similar|special|general|common|major|modern|recent|current|natural|national|international|personal|private|official|original|final|single|simple|clear|full|free|open|whole|entire|best|better|worst|big|huge|key|mere|concrete|quiet|close|good|attractive)$/i.test(word);
      }
      function idiomObjectStart(prepPos) {
        var a = (words[prepPos] || "").toLowerCase();
        var b = (words[prepPos + 1] || "").toLowerCase();
        var c = (words[prepPos + 2] || "").toLowerCase();
        if ((a === "in" || a === "on" || a === "at" || a === "by" || a === "for") && idiomPrep[b + " " + c]) return prepPos + 3;
        if (idiomPrep[a + " " + b]) return prepPos + 2;
        return prepPos + 1;
      }
      function markAfterPrepObject(prepPos) {
        if (isInfinitiveTo(prepPos)) return;
        if (/^at$/i.test(words[prepPos]) && /^least$/i.test(words[prepPos + 1] || "")) return;
        if (prepPos > 0 && isPhrasalParticle(words[prepPos - 1], words[prepPos])) return;
        var i = idiomObjectStart(prepPos);
        var sawHead = false;
        while (i < words.length) {
          var word = words[i];
          if (isFiniteVerb(word, sawHead)) break;
          if (sawHead && /^(i|you|we|they|he|she)$/i.test(word)) break;
          if (sawHead && /^(the|a|an|this|that|these|those)$/i.test(word)) break;
          if (sawHead && coordinator.test(word) && /^(and|or)$/i.test(word)) {
            var k = i + 1;
            var found = false;
            while (k < words.length && !isFiniteVerb(words[k], true)) {
              if (prep.test(words[k]) && !idiomHoldsPrep(k) && !isInfinitiveTo(k)) break;
              if (coordinator.test(words[k]) || relative.test(words[k]) || subord.test(words[k])) break;
              if (!isPrepModifier(words[k])) found = true;
              k += 1;
              if (found) break;
            }
            if (!found) break;
            sawHead = true;
            i = k;
            continue;
          }
          if (sawHead && prep.test(word) && !isInfinitiveTo(i) && !idiomHoldsPrep(i)) break;
          if (sawHead && (relative.test(word) || subord.test(word))) break;
          if (isPrepModifier(word)) {
            i += 1;
            continue;
          }
          if (!/^[A-Za-z0-9]/.test(word) || coordinator.test(word) || relative.test(word) || subord.test(word) || prep.test(word)) break;
          sawHead = true;
          i += 1;
        }
        if (!sawHead || i >= words.length) return;
        var boundary = isFiniteVerb(words[i], true) || /^(the|a|an|this|that|these|those)$/i.test(words[i]);
        if (!boundary) return;
        if (i - last < 1) return;
        breakAt[wordIndexes[i]] = true;
        last = i;
      }
      function markAfterInfinitive(toPos) {
        var verb = words[toPos + 1] || "";
        var nextPos = toPos + 2;
        if (!verb || nextPos >= words.length || words.length - nextPos < 2) return;
        if (/^(be|been|being|am|is|are|was|were)$/i.test(verb)) return;
        if (nextPos - last < 2) return;
        infinitiveBreak[wordIndexes[nextPos]] = true;
        breakAt[wordIndexes[nextPos]] = true;
        last = nextPos;
      }
      if (isInfinitiveTo(0)) markAfterInfinitive(0);
      else if (prep.test(words[0])) markAfterPrepObject(0);
      var clauseSubject = -1;
      if (subord.test(words[0])) {
        for (var i = 3; i < words.length - 1; i += 1) {
          if (subject.test(words[i]) && (looksVerb(words[i + 1]) || (words[i + 2] && looksVerb(words[i + 2])))) {
            clauseSubject = i;
            break;
          }
        }
      }
      for (var j = 1; j < words.length; j += 1) {
        var gap = gapBefore(j);
        if (/[—–]/.test(gap)) {
          mark(j);
          continue;
        }
        if (openDash(j)) continue;
        if (j === clauseSubject) {
          mark(j);
          continue;
        }
        var word = words[j];
        if (relative.test(word)) mark(j, true);
        else if (coordinator.test(word)) mark(j);
        else if (/^that$/i.test(word)) {
          var prev = words[j - 1];
          if (!/^(so|of|after|before|in|on|at|for|with|from|by|to|a|an|the|this)$/i.test(prev)) mark(j);
        } else if (isInfinitiveTo(j)) {
          if (!idiomHoldsPrep(j)) mark(j);
          markAfterInfinitive(j);
        } else if (isBareObject(j)) mark(j);
        else if (prep.test(word)) {
          markPrep(j);
          markAfterPrepObject(j);
        }
      }
      var hasBreak = false;
      for (var key in breakAt) {
        if (breakAt[key]) hasBreak = true;
      }
      if (!hasBreak) return text;
      var out = "";
      tokens.forEach(function (token, index) {
        if (token === "—" || token === "–") {
          var nextWord = -1;
          for (var n = index + 1; n < tokens.length; n += 1) {
            if (/^[A-Za-z0-9]/.test(tokens[n])) {
              nextWord = n;
              break;
            }
          }
          if (nextWord >= 0 && breakAt[nextWord]) return;
        }
        if (token === ",") {
          var ahead = index + 1;
          while (ahead < tokens.length && !/^[A-Za-z0-9]/.test(tokens[ahead])) ahead += 1;
          if (ahead < tokens.length && infinitiveBreak[ahead]) return;
        }
        var isWord = /^[A-Za-z0-9]/.test(token);
        if (breakAt[index]) out += " / ";
        else if (out && !/\/ $/.test(out) && (isWord || !/^[,.!?;:)]$/.test(token))) out += " ";
        out += token;
      });
      return out.replace(/\s+\/\s+/g, " / ").replace(/\s+([,.!?;:])/g, "$1").replace(/[ ]{2,}/g, " ").trim();
    }

    function slashSentence(sentence) {
      var key = String(sentence || "").trim();
      if (slashMemo.has(key)) return slashMemo.get(key);
      return remember(slashMemo, key, slashSentenceCompute(key));
    }

    function chunkPartsCompute(sentence) {
      var text = String(sentence || "").trim();
      if (!text) return [];
      var parts = slashSentence(text).split(/\s+\/\s+/).map(function (part) {
        return part.trim();
      }).filter(Boolean);
      return parts.length ? parts : [text];
    }

    function chunkParts(sentence) {
      var key = String(sentence || "").trim();
      if (chunkMemo.has(key)) return chunkMemo.get(key);
      return remember(chunkMemo, key, chunkPartsCompute(key));
    }

    function slashChunks(text) {
      var raw = String(text || "").trim();
      if (!raw) return "";
      return segmentSentences(raw).map(function (sentence) {
        return chunkParts(sentence).join(" / ");
      }).filter(Boolean).join(" ");
    }

    function slashMarkup(textOrParts, withStop) {
      var pieces = Array.isArray(textOrParts) ? textOrParts.slice() : String(textOrParts || "").split(/\s+\/\s+/);
      pieces = pieces.map(function (piece) { return String(piece || "").trim(); }).filter(Boolean);
      if (!pieces.length) return "";
      var html = pieces.map(function (piece) {
        return textBlock(piece);
      }).join(' <span class="slash-mark">/</span> ');
      if (withStop) html += ' <span class="stop-mark">//</span>';
      return html;
    }

    function chunkWordCount(text) {
      var words = String(text || "").match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g);
      return words && words.length ? words.length : 1;
    }

    function splitByWeights(text, weights) {
      var raw = String(text || "").replace(/\s+/g, " ").trim();
      var count = weights.length;
      if (!raw || !count) return [];
      if (count === 1) return [raw];
      var tokens = raw.split(" ").filter(Boolean);
      var byWord = tokens.length >= count;
      var units = byWord ? tokens : raw.split("");
      var total = weights.reduce(function (sum, weight) { return sum + (weight || 1); }, 0) || count;
      var chunks = [];
      var cursor = 0;
      weights.forEach(function (weight, index) {
        var remain = count - index - 1;
        if (index === count - 1) {
          chunks.push(units.slice(cursor).join(byWord ? " " : ""));
          return;
        }
        var take = Math.round(units.length * ((weight || 1) / total));
        if (take < 1) take = 1;
        var maxTake = units.length - cursor - remain;
        if (take > maxTake) take = maxTake;
        if (take < 1) take = 1;
        chunks.push(units.slice(cursor, cursor + take).join(byWord ? " " : ""));
        cursor += take;
      });
      return chunks;
    }

    function sentenceMappedChunks(sentence, engChunks) {
      var whole = sanitizeKoreanChunk(koreanChunk(sentence));
      if (!/[가-힣]/.test(whole)) return engChunks.map(function () { return ""; });
      var mapped = splitByWeights(whole, engChunks.map(chunkWordCount));
      while (mapped.length < engChunks.length) mapped.push("");
      return mapped.slice(0, engChunks.length).map(function (part) {
        return sanitizeKoreanChunk(part);
      });
    }

    function modelKoreanList(item) {
      var provided = asArray(item && item.literal_chunks);
      if (!provided.length) provided = asArray(item && item.literalChunks);
      if (!provided.length) provided = asArray(item && item.korChunks);
      if (!provided.length && Array.isArray(item && item.literal)) provided = item.literal;
      return provided;
    }

    function chunkKey(text) {
      return String(text || "").replace(/\s+/g, " ").trim();
    }

    function sameChunkText(left, right) {
      if (!left || !right || left.length !== right.length) return false;
      for (var i = 0; i < left.length; i += 1) {
        if (chunkKey(left[i]) !== chunkKey(right[i])) return false;
      }
      return true;
    }

    function chunkIsAlignedKorean(text) {
      var value = String(text || "").trim();
      if (!/[가-힣]/.test(value)) return false;
      var words = value.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) || [];
      return words.every(keepLatinToken);
    }

    function validateChunkPair(engChunks, korChunks) {
      var engLength = engChunks.length;
      var korLength = korChunks.length;
      var matched = engLength === korLength;
      if (!matched) {
        console.warn("청크 길이 불일치", "engChunks", engLength, "korChunks", korLength);
      }
      console.log("Eng Chunks:", engChunks, "Kor Chunks:", korChunks);
      return matched;
    }

    function alignLiteralChunks(english, literals, sentence) {
      var engChunks = asArray(english).map(chunkKey).filter(Boolean);
      var korChunks = asArray(literals).map(function (part) { return String(part || "").trim(); });
      validateChunkPair(engChunks, korChunks);
      var fitted = korChunks.slice(0, engChunks.length);
      while (fitted.length < engChunks.length) fitted.push("");
      if (fitted.length !== korChunks.length) {
        console.warn("청크 길이 보정", korChunks.length, "->", fitted.length);
      }
      fitted = fitted.map(function (part) {
        var candidate = sanitizeKoreanChunk(part);
        return /[가-힣]/.test(candidate) ? candidate : "";
      });
      if (engChunks.length && !fitted.some(function (part) { return /[가-힣]/.test(part); })) {
        console.warn("문장 단위 보정", sentence || engChunks.join(" "));
        fitted = sentenceMappedChunks(sentence || engChunks.join(" "), engChunks);
      }
      console.log("청크 매칭", engChunks.length + "개", fitted.map(function (part, index) {
        return (index + 1) + ". " + engChunks[index] + " => " + part;
      }));
      return fitted;
    }

    function realignKorChunks(canonical, modelEng, modelKor) {
      var eng = asArray(canonical).map(chunkKey).filter(Boolean);
      var sourceEng = asArray(modelEng).map(chunkKey).filter(Boolean);
      var sourceKor = asArray(modelKor).map(function (part) { return String(part || "").trim(); });
      if (!eng.length) return [];
      if (!sourceKor.length) return eng.map(function () { return ""; });
      if (sourceEng.length && sameChunkText(eng, sourceEng)) {
        var matched = sourceKor.slice(0, eng.length);
        while (matched.length < eng.length) matched.push("");
        return matched;
      }
      if (!sourceEng.length) {
        if (sourceKor.length === 1 && eng.length > 1) {
          return splitByWeights(sourceKor[0], eng.map(chunkWordCount));
        }
        var only = sourceKor.slice(0, eng.length);
        while (only.length < eng.length) only.push("");
        return only;
      }
      var owners = [];
      sourceEng.forEach(function (chunk, index) {
        var count = chunkWordCount(chunk);
        for (var n = 0; n < count; n += 1) owners.push(index);
      });
      var groups = {};
      var order = [];
      var cursor = 0;
      eng.forEach(function (chunk, index) {
        var weight = chunkWordCount(chunk);
        var owner = owners[Math.min(cursor, Math.max(owners.length - 1, 0))] || 0;
        if (!groups[owner]) {
          groups[owner] = [];
          order.push(owner);
        }
        groups[owner].push({ index: index, weight: weight });
        cursor += weight;
      });
      var out = eng.map(function () { return ""; });
      order.forEach(function (owner) {
        var members = groups[owner];
        var korean = sourceKor[owner] || "";
        if (members.length === 1) {
          out[members[0].index] = korean;
          return;
        }
        var pieces = splitByWeights(korean, members.map(function (member) { return member.weight; }));
        members.forEach(function (member, index) {
          out[member.index] = pieces[index] || "";
        });
      });
      return out;
    }

    function bilingualChunks(item) {
      var modelEng = asArray(item && item.engChunks).map(chunkKey).filter(Boolean);
      if (!modelEng.length) modelEng = asArray(item && item.chunks).map(chunkKey).filter(Boolean);
      var modelKor = asArray(item && item.korChunks).map(function (part) { return String(part || "").trim(); });
      if (!modelKor.length) modelKor = asArray(item && item.literal_chunks).map(function (part) { return String(part || "").trim(); });
      var sourceText = String(item && item.original || "").replace(/\s*\/\/+\s*/g, " ").replace(/\s+\/\s+/g, " ").replace(/\s+/g, " ").trim();
      if (!sourceText) sourceText = modelEng.join(" ");
      var engChunks = sourceText ? chunkParts(sourceText) : modelEng.slice();
      if (!engChunks.length) engChunks = modelEng.slice();
      var korChunks = realignKorChunks(engChunks, modelEng, modelKor);
      if (korChunks.length !== engChunks.length) {
        console.warn("청크 길이 불일치", "engChunks", engChunks.length, "korChunks", korChunks.length);
        korChunks = korChunks.slice(0, engChunks.length);
        while (korChunks.length < engChunks.length) korChunks.push("");
      }
      console.log("API engChunks", modelEng);
      console.log("API korChunks", modelKor);
      console.log("동기화 engChunks", engChunks);
      console.log("동기화 korChunks", korChunks);
      return { en: engChunks, ko: korChunks };
    }

    function literalViewHtml(item) {
      var pair = bilingualChunks(item);
      var html = '<p class="slash-line">' + slashMarkup(pair.en, true) + "</p>";
      if (pair.ko.some(function (part) { return String(part || "").trim(); })) {
        html += '<p class="slash-ko">' + slashMarkup(pair.ko, true) + "</p>";
      }
      return html;
    }

    function quoteCharKind(ch) {
      if (ch === "\"" || ch === "＂") return "either";
      if (ch === "“" || ch === "„" || ch === "«" || ch === "〝") return "open";
      if (ch === "”" || ch === "»" || ch === "〞") return "close";
      return "";
    }

    function pairedQuoteSpans(text) {
      var spans = [];
      var start = -1;
      var mode = "";
      for (var i = 0; i < text.length; i += 1) {
        var kind = quoteCharKind(text.charAt(i));
        if (!kind) continue;
        if (start < 0) {
          if (kind === "close") continue;
          start = i;
          mode = kind;
          continue;
        }
        if (mode === "open" && kind === "open") continue;
        if (kind === "close" || kind === "either") {
          spans.push([start, i]);
          start = -1;
          mode = "";
        }
      }
      return spans;
    }

    var ABBREVIATIONS = {
      mr: 1, mrs: 1, ms: 1, miss: 1, dr: 1, prof: 1, sr: 1, jr: 1,
      st: 1, rev: 1, gen: 1, col: 1, capt: 1, lt: 1, sgt: 1,
      hon: 1, esq: 1, fr: 1, br: 1, mx: 1, messrs: 1, mt: 1,
      gov: 1, pres: 1, sen: 1, rep: 1,
      etc: 1, eg: 1, ie: 1, vs: 1, viz: 1, cf: 1, al: 1,
      vol: 1, ch: 1, fig: 1, pp: 1, inc: 1, ltd: 1, co: 1,
      dept: 1, univ: 1, approx: 1, est: 1,
      phd: 1, md: 1, ba: 1, ma: 1, msc: 1, bsc: 1, llb: 1, ed: 1, dds: 1, rn: 1,
      jan: 1, feb: 1, mar: 1, apr: 1, jun: 1, jul: 1, aug: 1,
      sept: 1, sep: 1, oct: 1, nov: 1, dec: 1,
      am: 1, pm: 1
    };

    function isAbbreviationPeriod(raw, index) {
      var ch = raw.charAt(index);
      if (ch !== "." && ch !== "．" && ch !== "。") return false;
      var start = index;
      while (start > 0 && /[A-Za-z.]/.test(raw.charAt(start - 1))) start -= 1;
      var token = raw.slice(start, index);
      var folded = token.replace(/\./g, "").toLowerCase();
      if (!folded) return false;
      if (folded === "no") return /^\s*\d/.test(raw.slice(index + 1));
      if (ABBREVIATIONS[folded]) return true;
      var ahead = raw.slice(index + 1).match(/^[A-Za-z]+/);
      if (ahead && ABBREVIATIONS[(folded + ahead[0]).toLowerCase()]) return true;
      var letterStart = index;
      while (letterStart > 0 && /[A-Za-z]/.test(raw.charAt(letterStart - 1))) letterStart -= 1;
      var letter = raw.slice(letterStart, index);
      if (/^[A-Za-z]$/.test(letter)) {
        if (/^\s*[A-Za-z]\./.test(raw.slice(index + 1))) return true;
        if (/[A-Za-z]\.\s*$/.test(raw.slice(0, letterStart))) return true;
      }
      return false;
    }

    var SPEECH_VERBS = {
      say: 1, says: 1, said: 1, ask: 1, asks: 1, asked: 1,
      reply: 1, replies: 1, replied: 1, answer: 1, answers: 1, answered: 1,
      whisper: 1, whispers: 1, whispered: 1, shout: 1, shouts: 1, shouted: 1,
      cry: 1, cries: 1, cried: 1, mutter: 1, mutters: 1, muttered: 1,
      exclaim: 1, exclaims: 1, exclaimed: 1, murmur: 1, murmurs: 1, murmured: 1,
      yell: 1, yells: 1, yelled: 1, call: 1, calls: 1, called: 1,
      tell: 1, tells: 1, told: 1, add: 1, adds: 1, added: 1,
      continue: 1, continues: 1, continued: 1, begin: 1, begins: 1, began: 1,
      demand: 1, demands: 1, demanded: 1, explain: 1, explains: 1, explained: 1,
      announce: 1, announces: 1, announced: 1, repeat: 1, repeats: 1, repeated: 1,
      insist: 1, insists: 1, insisted: 1, plead: 1, pleads: 1, pleaded: 1,
      beg: 1, begs: 1, begged: 1, snap: 1, snaps: 1, snapped: 1,
      sigh: 1, sighs: 1, sighed: 1, gasp: 1, gasps: 1, gasped: 1,
      remark: 1, remarks: 1, remarked: 1, declare: 1, declares: 1, declared: 1,
      admit: 1, admits: 1, admitted: 1, suggest: 1, suggests: 1, suggested: 1,
      think: 1, thinks: 1, thought: 1, wonder: 1, wonders: 1, wondered: 1,
      warn: 1, warns: 1, warned: 1, offer: 1, offers: 1, offered: 1,
      inquire: 1, inquires: 1, inquired: 1, retort: 1, retorts: 1, retorted: 1,
      interrupt: 1, interrupts: 1, interrupted: 1, conclude: 1, concludes: 1, concluded: 1,
      scream: 1, screams: 1, screamed: 1, sob: 1, sobs: 1, sobbed: 1,
      laugh: 1, laughs: 1, laughed: 1, chuckle: 1, chuckles: 1, chuckled: 1
    };

    function isSpeechVerb(word) {
      return !!SPEECH_VERBS[String(word || "").toLowerCase()];
    }

    function isSpeaker(word) {
      var token = String(word || "").replace(/\.$/, "");
      if (/^(i|you|he|she|we|they|it)$/i.test(token)) return true;
      if (/^(mr|mrs|ms|miss|dr|prof|sir|lady|lord)$/i.test(token)) return true;
      return /^[A-Z][A-Za-z'’]+$/.test(word) && !isSpeechVerb(word);
    }

    function wordsAfter(raw, index, limit) {
      var words = [];
      var i = index;
      while (i < raw.length && words.length < limit) {
        while (i < raw.length && /[\s,;:]/.test(raw.charAt(i))) i += 1;
        if (i >= raw.length || !/[A-Za-z]/.test(raw.charAt(i))) break;
        var start = i;
        while (i < raw.length && /[A-Za-z'’]/.test(raw.charAt(i))) i += 1;
        var word = raw.slice(start, i);
        if ((raw.charAt(i) === "." || raw.charAt(i) === "．") && isAbbreviationPeriod(raw, i)) {
          word += ".";
          i += 1;
        }
        words.push(word);
      }
      return words;
    }

    function isDialogueAttribution(raw, index) {
      var words = wordsAfter(raw, index, 4);
      if (!words.length) return false;
      var first = words[0];
      var second = words[1];
      var third = words[2];
      if (isSpeechVerb(first) && isSpeaker(second)) return true;
      if (isSpeaker(first) && isSpeechVerb(second)) return true;
      if (isSpeaker(first) && second && !isSpeechVerb(second) && /^[a-z]+$/.test(second) && isSpeechVerb(third)) return true;
      if (/^(mr|mrs|ms|miss|dr|prof)\.?$/i.test(first) && isSpeaker(second) && isSpeechVerb(third)) return true;
      return false;
    }

    function isEndMark(ch) {
      return ch === "." || ch === "．" || ch === "。" || ch === "!" || ch === "?" || ch === "！" || ch === "？" || ch === "…";
    }

    function segmentSentencesCompute(text) {
      var raw = String(text || "").replace(/\s+/g, " ").trim();
      if (!raw) return [];
      var spans = pairedQuoteSpans(raw);
      var sentences = [];
      var current = "";
      function insideQuote(index) {
        for (var s = 0; s < spans.length; s += 1) {
          if (index > spans[s][0] && index < spans[s][1]) return true;
        }
        return false;
      }
      function isBoundary(index) {
        var ch = raw.charAt(index);
        if (!isEndMark(ch) || insideQuote(index)) return false;
        if ((ch === "." || ch === "．" || ch === "。") && (raw.charAt(index + 1) === "." || raw.charAt(index + 1) === "．" || raw.charAt(index + 1) === "…")) return false;
        if ((ch === "." || ch === "．") && /\d/.test(raw.charAt(index - 1)) && /\d/.test(raw.charAt(index + 1))) return false;
        if (isAbbreviationPeriod(raw, index)) return false;
        var next = index + 1;
        while (next < raw.length && /["”»〞＂')\]]/.test(raw.charAt(next))) next += 1;
        if (next >= raw.length) return true;
        var follower = raw.charAt(next);
        return /\s/.test(follower) || /[A-Z]/.test(follower);
      }
      function quoteEdgeBoundary(index) {
        var isCloser = false;
        for (var s = 0; s < spans.length; s += 1) {
          if (spans[s][1] === index) isCloser = true;
        }
        if (!isCloser) return false;
        var next = index + 1;
        while (next < raw.length && /[\s—–-]/.test(raw.charAt(next))) next += 1;
        if (next >= raw.length) return false;
        var kind = quoteCharKind(raw.charAt(next));
        if (kind === "open" || kind === "either") return true;
        if (!/[A-Za-z]/.test(raw.charAt(next))) return false;
        return !isDialogueAttribution(raw, next);
      }
      for (var i = 0; i < raw.length; i += 1) {
        current += raw.charAt(i);
        if (!isBoundary(i) && !quoteEdgeBoundary(i)) continue;
        var sentence = current.trim();
        if (sentence) sentences.push(sentence);
        current = "";
      }
      var tail = current.trim();
      if (tail) {
        if (!/[.!?…．。！？]["”»〞＂')\]]*$/.test(tail) && !/["”»〞＂]$/.test(tail)) tail += ".";
        sentences.push(tail);
      }
      return sentences;
    }

    function segmentSentences(text) {
      var key = String(text || "");
      if (sentenceMemo.has(key)) return sentenceMemo.get(key);
      return remember(sentenceMemo, key, segmentSentencesCompute(key));
    }

    function translateRows(data) {
      var source = asArray(data && data.sentences);
      if (!source.length && data && (data.engChunks || data.korChunks)) source = [data];
      if (!source.length) source = asArray(data && data.paragraphs);
      var rows = [];
      source.forEach(function (item) {
        if (!item || typeof item !== "object") return;
        var engChunks = asArray(item.engChunks);
        if (!engChunks.length) engChunks = asArray(item.chunks);
        var korChunks = asArray(item.korChunks);
        if (!korChunks.length) korChunks = asArray(item.literal_chunks);
        if (engChunks.length) {
          rows.push({
            original: String(item.original || engChunks.join(" ")),
            engChunks: engChunks,
            korChunks: korChunks,
            chunks: engChunks,
            literal_chunks: korChunks
          });
          return;
        }
        var originals = segmentSentences(item.original);
        if (!originals.length) {
          var fallback = String(item.original || "").replace(/\s+/g, " ").trim();
          if (fallback) originals = [fallback];
        }
        originals.forEach(function (sentence) {
          rows.push({ original: sentence, engChunks: [], korChunks: [], chunks: [], literal_chunks: [] });
        });
      });
      return rows;
    }

    function renderTranslate(data) {
      var sentences = translateRows(data);
      if (!sentences.length) return '<p class="empty-note">나눌 문장이 없습니다. 온점으로 끝나는 문장을 넣어 주세요.</p>';
      return '<div class="sentence-list">' + sentences.map(function (item, index) {
        return ''
          + '<article class="sentence-card">'
          + '<p class="sheet-no serif">' + String(index + 1).padStart(2, "0") + "</p>"
          + literalViewHtml(item)
          + "</article>";
      }).join("") + "</div>";
    }

    function renderSummary(data) {
      var points = asArray(data.points);
      var pointsHtml = points.map(function (point, index) {
        return ''
          + '<li class="point">'
          + '<span class="sheet-no serif">' + String(index + 1).padStart(2, "0") + "</span>"
          + "<div><p class=\"passage-face text-[15px] leading-7\">" + textBlock(point.en) + "</p>"
          + '<p class="note">' + textBlock(point.ko) + "</p></div></li>";
      }).join("");
      return ''
        + '<p class="serif gist">' + textBlock(data.gist || data.title || "요약") + "</p>"
        + '<p class="mt-4 text-[15px] leading-7 break-words">' + textBlock(data.summary) + "</p>"
        + (pointsHtml ? '<ol class="mt-6 space-y-4">' + pointsHtml + "</ol>" : "")
        + (data.main_idea_en
          ? '<blockquote class="pull passage-face">' + textBlock(data.main_idea_en) + "</blockquote>"
          : "");
    }

    function renderAnnotate(data) {
      var structures = asArray(data.structures).map(function (item) {
        return ''
          + '<article class="note-card">'
          + '<p class="q-kicker">' + textBlock(item.label) + "</p>"
          + '<p class="passage-face mt-2 text-[16px] leading-7 break-words">“' + textBlock(item.excerpt) + "”</p>"
          + '<p class="mt-3 text-sm leading-6 break-words">' + textBlock(item.explanation) + "</p>"
          + (item.paraphrase
            ? '<p class="note"><span class="navy font-semibold">쉽게 쓰면 </span>' + textBlock(item.paraphrase) + "</p>"
            : "")
          + "</article>";
      }).join("");
      var vocabulary = asArray(data.vocabulary).map(function (item) {
        return ''
          + '<div class="vocab-row">'
          + "<div><p class=\"serif text-base\">" + textBlock(item.word) + "</p>"
          + '<p class="gold text-xs">' + textBlock(item.pos) + "</p></div>"
          + "<div><p class=\"text-sm font-semibold\">" + textBlock(item.meaning) + "</p>"
          + '<p class="note">' + textBlock(item.context) + "</p></div></div>";
      }).join("");
      return ''
        + '<h3 class="section-title">구문</h3>'
        + '<div class="mt-3 space-y-3">' + (structures || '<p class="empty-note">표시할 구문이 없습니다.</p>') + "</div>"
        + '<h3 class="section-title spaced">어휘</h3>'
        + '<div class="vocab">'
        + (vocabulary || '<p class="empty-note py-3">표시할 어휘가 없습니다.</p>') + "</div>";
    }

    function renderTransform(data) {
      var blanks = asArray(data.blanks);
      var ordering = asArray(data.ordering);
      var blankHtml = blanks.map(function (item, index) {
        return questionCard({
          index: index + 1,
          instruction: item.instruction || "빈칸에 들어갈 말로 가장 적절한 것을 고르시오.",
          body: '<p class="passage-face text-[16px] leading-8 break-words">' + renderBlankPassage(item.passage) + "</p>",
          options: item.options,
          answer: item.answer,
          explanation: item.explanation
        });
      }).join("");
      var orderHtml = ordering.map(function (item, index) {
        var sentences = asArray(item.sentences).map(function (sentence, sentenceIndex) {
          var label = sentence && sentence.label ? sentence.label : String.fromCharCode(65 + sentenceIndex);
          var text = typeof sentence === "string" ? sentence : (sentence && sentence.text) || "";
          return '<p class="text-sm leading-6"><span class="navy font-semibold">(' + esc(label) + ")</span> " + textBlock(text) + "</p>";
        }).join("");
        return questionCard({
          index: blanks.length + index + 1,
          instruction: item.instruction || "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오.",
          body: ''
            + '<div class="intro-block passage-face">' + textBlock(item.intro) + "</div>"
            + '<div class="sentence-list">' + sentences + "</div>",
          options: item.options,
          answer: item.answer,
          explanation: item.explanation
        });
      }).join("");
      if (!blankHtml && !orderHtml) {
        return '<p class="empty-note">문제를 만들지 못했습니다. 제출 버튼으로 한 번 더 실행해 주세요.</p>';
      }
      return ''
        + '<h3 class="section-title">빈칸</h3>'
        + '<div class="mt-3 space-y-4">' + (blankHtml || '<p class="empty-note">빈칸 문제가 없습니다.</p>') + "</div>"
        + '<h3 class="section-title spaced">순서 배열</h3>'
        + '<div class="mt-3 space-y-4">' + (orderHtml || '<p class="empty-note">순서 배열 문제가 없습니다.</p>') + "</div>";
    }

    var RENDERERS = {
      translate: renderTranslate,
      summary: renderSummary,
      annotate: renderAnnotate,
      transform: renderTransform
    };

    var DEMO_PASSAGE = "A close reading begins with the words on the page. The opening image often tells the reader how to look. Meaning gathers only after that attention is paid.";

    var LEX = {};
    var NAMES = {
      smith: "스미스", kim: "김", hart: "하트", lee: "이", park: "박", cho: "조", jones: "존스",
      john: "존", mary: "메리", jane: "제인", brown: "브라운", miller: "밀러", tom: "톰",
      james: "제임스", david: "데이비드", michael: "마이클", elizabeth: "엘리자베스",
      william: "윌리엄", george: "조지", henry: "헨리", emma: "에마", oliver: "올리버",
      alice: "앨리스", peter: "피터", anna: "안나", sarah: "사라", grace: "그레이스"
    };
    var TITLES = { mr: "씨", mrs: "부인", ms: "양", miss: "양", dr: "박사", prof: "교수", sir: "경" };
    var SPEECH = {};
    "say says said tell told talk talked speak spoke ask asked reply replied answer answered whisper whispered shout shouted mutter muttered add added explain explained cry cried yell yelled remark remarked note noted wonder wondered exclaim exclaimed continue continued insist insisted admit admitted agree agreed promise promised warn warned announce announced think thought figure figured".split(/\s+/).forEach(function (key) {
      SPEECH[key] = 1;
    });

    function copyEntry(entry) {
      var out = {};
      var key;
      for (key in entry) if (Object.prototype.hasOwnProperty.call(entry, key)) out[key] = entry[key];
      return out;
    }

    function addJong(syllable, jongName) {
      var jongId = { "ㄴ": 4, "ㄹ": 8 };
      var source = String(syllable || "");
      var code = source.charCodeAt(source.length - 1);
      if (code < 0xac00 || code > 0xd7a3 || !jongId[jongName]) return source;
      var base = code - 0xac00;
      if (base % 28 !== 0) return source;
      return source.slice(0, -1) + String.fromCharCode(0xac00 + base + jongId[jongName]);
    }

    function hasBatchim(text) {
      var core = String(text || "").replace(/[^가-힣]/g, "");
      if (!core) return false;
      var last = core.charCodeAt(core.length - 1);
      if (last < 0xac00 || last > 0xd7a3) return false;
      return (last - 0xac00) % 28 !== 0;
    }

    function attachParticle(body, particle) {
      var noun = body || "그것";
      if (!particle) return noun;
      if (particle === "로") return noun + (hasBatchim(noun) ? "으로" : "로");
      if (particle === "로서") return noun + (hasBatchim(noun) ? "으로서" : "로서");
      if (particle === "위해") return noun + (hasBatchim(noun) ? "을 위해" : "를 위해");
      if (particle === "와 함께") return noun + (hasBatchim(noun) ? "과 함께" : "와 함께");
      if (particle === "로부터") return noun + (hasBatchim(noun) ? "으로부터" : "로부터");
      if (particle === "에 대해" || particle === "에 의해" || particle === "에 따르면" || particle === "에도 불구하고") return noun + particle;
      if (/^(안으로|위로|통해|사이에|후에|전에|가운데|가로질러|주위에|뒤에|너머|향해|이후로|가까이에|위에|아래에|옆에|따라|앞에|때문에|대신에|밖으로|측면에서|없이|동안|안에|밖에|까지)$/.test(particle)) {
        return noun + " " + particle;
      }
      return noun + particle;
    }

    function objectParticle(phrase) {
      var core = String(phrase || "").replace(/[.,\s]+$/g, "");
      if (!core) return "";
      return core + (hasBatchim(core) ? "을" : "를");
    }

    function topicParticle(phrase) {
      if (!phrase) return "";
      return phrase + (hasBatchim(phrase) ? "은" : "는");
    }

    function subjectParticle(phrase) {
      if (!phrase) return "";
      return phrase + (hasBatchim(phrase) ? "이" : "가");
    }

    function addPos(pos, map) {
      Object.keys(map).forEach(function (key) {
        LEX[key] = { pos: pos, key: key, ko: map[key] };
      });
    }

    function addAdj(key, base, attr) {
      LEX[key] = { pos: "adj", key: key, base: base, attr: attr || "", ko: attr || base };
    }

    function addVerb(key, base, extra) {
      extra = extra || {};
      LEX[key] = {
        pos: "v",
        key: key,
        base: base,
        past: extra.p || "",
        present: extra.n || "",
        mod: extra.m || "",
        imp: extra.i || "",
        quot: extra.q || "",
        form: extra.f || "",
        alt: extra.a || "",
        ko: ""
      };
    }

    function addPron(key, topic, ga, obj, poss) {
      LEX[key] = { pos: "pron", key: key, topic: topic, ga: ga, obj: obj, poss: poss || "", ko: topic || obj || "" };
    }

    addPos("det", {
      a: "", an: "", the: "", this: "이", these: "이러한", those: "저러한",
      some: "어떤", any: "어떤", every: "모든", each: "각각의", no: "없는", another: "또 다른"
    });
    addPos("disc", {
      maybe: "아마도", perhaps: "아마도", please: "제발", then: "그때"
    });
    addPos("adv", {
      often: "자주", frequently: "자주", usually: "대개", always: "항상", never: "결코",
      slowly: "천천히", quietly: "조용히", early: "일찍", really: "정말", already: "이미",
      only: "오직", also: "또한", just: "바로", even: "심지어", still: "여전히", almost: "거의",
      enough: "충분히", now: "이제", here: "여기", there: "거기에", how: "어떻게", why: "왜",
      well: "잘", too: "너무", very: "매우", so: "아주", quite: "꽤", more: "더", most: "가장",
      soon: "곧", again: "다시", once: "한 번", today: "오늘", tomorrow: "내일", yesterday: "어제",
      sometimes: "때때로", especially: "특히", finally: "마침내", suddenly: "갑자기",
      quickly: "빠르게", easily: "쉽게", together: "함께", away: "떨어져", past: "지나쳐",
      not: "", rather: "오히려", else: "그 밖에", ago: "전에", later: "나중에", hard: "열심히"
    });
    addPos("sub", {
      when: "때", if: "만약", although: "비록", though: "비록", because: "왜냐하면",
      while: "동안", whereas: "반면에", unless: "아니라면", whether: "인지"
    });
    addPos("conj", { and: "그리고", or: "또는", but: "그러나", nor: "그리고 않다", yet: "그러나" });
    "in on at to into onto with from of as by for about through over under between after before without within during against among across around behind beyond toward towards until till since despite near above below beside along via upon inside outside".split(/\s+/).forEach(function (key) {
      LEX[key] = { pos: "prep", key: key, ko: "" };
    });
    ["can", "could", "will", "would", "may", "might", "must", "should", "shall"].forEach(function (key) {
      LEX[key] = { pos: "modal", key: key, ko: "" };
    });
    ["be", "am", "is", "are"].forEach(function (key) {
      LEX[key] = { pos: "be", key: key, base: "이다", past: "이었다", present: "이다", form: "" };
    });
    ["was", "were", "been"].forEach(function (key) {
      LEX[key] = { pos: "be", key: key, base: "이다", past: "이었다", present: "이다", form: "past" };
    });
    LEX.being = { pos: "be", key: "being", base: "이다", form: "ing", ko: "" };

    addPron("i", "나는", "내가", "나를", "나의");
    addPron("you", "당신은", "당신이", "당신을", "당신의");
    addPron("he", "그는", "그가", "그를", "그의");
    addPron("she", "그녀는", "그녀가", "그녀를", "그녀의");
    addPron("we", "우리는", "우리가", "우리를", "우리의");
    addPron("they", "그들은", "그들이", "그들을", "그들의");
    addPron("it", "그것은", "그것이", "그것을", "그것의");
    addPron("me", "나는", "내가", "나를", "나의");
    addPron("him", "그는", "그가", "그를", "그의");
    addPron("her", "그녀는", "그녀가", "그녀를", "그녀의");
    addPron("us", "우리는", "우리가", "우리를", "우리의");
    addPron("them", "그들은", "그들이", "그들을", "그들의");
    addPron("my", "나는", "내가", "나를", "나의");
    addPron("your", "당신은", "당신이", "당신을", "당신의");
    addPron("his", "그는", "그가", "그를", "그의");
    addPron("our", "우리는", "우리가", "우리를", "우리의");
    addPron("their", "그들은", "그들이", "그들을", "그들의");
    addPron("its", "그것은", "그것이", "그것을", "그것의");
    addPron("who", "누구는", "누가", "누구를", "누구의");
    addPron("what", "무엇은", "무엇이", "무엇을", "무엇의");
    addPron("which", "어느 것은", "어느 것이", "어느 것을", "");

    addAdj("good", "좋다", "좋은");
    addAdj("smart", "똑똑하다", "똑똑한");
    addAdj("new", "새롭다", "새로운");
    addAdj("old", "오래되다", "오래된");
    addAdj("mere", "단순하다", "단순한");
    addAdj("demanding", "힘들다", "힘든");
    addAdj("quiet", "조용하다", "조용한");
    addAdj("single", "하나이다", "하나의");
    addAdj("concrete", "구체적이다", "구체적인");
    addAdj("literary", "문학이다", "문학");
    addAdj("moral", "도덕적이다", "도덕적인");
    addAdj("unexpected", "뜻밖이다", "뜻밖의");
    addAdj("repeated", "반복되다", "반복된");
    addAdj("cracked", "금이 가다", "금이 간");
    addAdj("unopened", "열리지 않다", "열리지 않은");
    addAdj("close", "정밀하다", "정밀한");
    addAdj("important", "중요하다", "중요한");
    addAdj("small", "작다", "작은");
    addAdj("big", "크다", "큰");
    addAdj("large", "크다", "큰");
    addAdj("great", "훌륭하다", "훌륭한");
    addAdj("young", "젊다", "젊은");
    addAdj("long", "길다", "긴");
    addAdj("high", "높다", "높은");
    addAdj("different", "다르다", "다른");
    addAdj("same", "동일하다", "동일한");
    addAdj("few", "적다", "적은");
    addAdj("much", "많다", "많은");
    addAdj("many", "많다", "많은");
    addAdj("such", "그러하다", "그러한");
    addAdj("real", "실제이다", "실제의");
    addAdj("true", "참이다", "참된");
    addAdj("possible", "가능하다", "가능한");
    addAdj("simple", "단순하다", "단순한");
    addAdj("difficult", "어렵다", "어려운");
    addAdj("easy", "쉽다", "쉬운");
    addAdj("strong", "강하다", "강한");
    addAdj("clear", "분명하다", "분명한");
    addAdj("happy", "행복하다", "행복한");
    addAdj("sure", "확실하다", "확실한");
    addAdj("whole", "전체이다", "전체의");
    addAdj("common", "흔하다", "흔한");
    addAdj("main", "주되다", "주된");
    addAdj("special", "특별하다", "특별한");
    addAdj("final", "마지막이다", "마지막");
    addAdj("following", "뒤따르다", "다음의");
    addAdj("human", "인간이다", "인간의");
    addAdj("social", "사회적이다", "사회적인");
    addAdj("original", "원래이다", "원래의");
    addAdj("modern", "현대적이다", "현대의");
    addAdj("certain", "특정하다", "특정한");
    addAdj("own", "자신이다", "자신의");
    addAdj("next", "다음이다", "다음");
    addAdj("first", "첫이다", "첫");
    addAdj("last", "마지막이다", "마지막");
    addAdj("little", "작다", "작은");
    addAdj("bad", "나쁘다", "나쁜");
    addAdj("best", "가장 좋다", "가장 좋은");
    addAdj("better", "더 좋다", "더 좋은");
    addAdj("able", "할 수 있다", "할 수 있는");
    addAdj("full", "가득하다", "가득한");
    addAdj("empty", "비다", "빈");
    addAdj("dark", "어둡다", "어두운");
    addAdj("ready", "준비되다", "준비된");
    addAdj("short", "짧다", "짧은");
    addAdj("beautiful", "아름답다", "아름다운");
    addAdj("careful", "신중하다", "신중한");
    addAdj("useful", "유용하다", "유용한");
    addAdj("serious", "심각하다", "심각한");
    addAdj("various", "다양하다", "다양한");
    addAdj("recent", "최근이다", "최근의");
    addAdj("public", "공공이다", "공공의");
    addAdj("private", "사적이다", "사적인");
    addAdj("local", "지역적이다", "지역의");
    addAdj("available", "이용 가능하다", "이용 가능한");
    addAdj("likely", "가능성이 있다", "~할 것 같은");
    addAdj("opening", "도입이다", "도입");

    addPos("n", {
      garden: "정원", kitchen: "부엌", dog: "개", food: "음식", junk: "잡동사니",
      library: "도서관", train: "기차", noon: "정오", rain: "비", book: "책", books: "책",
      word: "단어", words: "단어들", skill: "능력", skills: "능력", reader: "독자", readers: "독자들",
      critic: "비평가", critics: "비평가들", novel: "소설", paragraph: "문단", threshold: "문턱",
      window: "창문", clock: "시계", letter: "편지", scene: "장면", weather: "날씨", plot: "플롯",
      writer: "작가", instruction: "지시", instructions: "지시", detail: "세부 사항", details: "세부 사항",
      interpretation: "해석", verb: "동사", shift: "변화", tense: "시제", pronoun: "대명사",
      design: "설계", description: "묘사", argument: "주장", attention: "주의", claim: "주장",
      meaning: "의미", patience: "인내", form: "형태", understanding: "이해", image: "이미지",
      page: "지면", pages: "지면", passage: "지문", work: "일", reading: "읽기", case: "경우", cases: "경우",
      student: "학생", students: "학생", class: "수업", key: "열쇠", people: "사람들", person: "사람",
      time: "시간", way: "방식", day: "날", year: "해", world: "세계", life: "삶", hand: "손",
      part: "부분", place: "장소", week: "주", home: "집", water: "물", room: "방", story: "이야기",
      fact: "사실", house: "집", friend: "친구", idea: "생각", city: "도시", name: "이름",
      door: "문", art: "예술", history: "역사", result: "결과", reason: "이유", moment: "순간",
      teacher: "교사", education: "교육", morning: "아침", night: "밤", question: "질문",
      answer: "답", problem: "문제", example: "예", sentence: "문장", language: "언어",
      english: "영어", school: "학교", child: "아이", children: "아이들", man: "남자", woman: "여자",
      family: "가족", country: "나라", money: "돈", job: "일자리", group: "집단", number: "수",
      system: "체계", program: "과정", information: "정보", research: "연구", change: "변화",
      end: "끝", side: "쪽", kind: "종류", head: "머리", line: "줄", point: "요점", area: "영역",
      level: "수준", body: "몸", face: "얼굴", eye: "눈", hand: "손", voice: "목소리",
      paper: "종이", table: "탁자", street: "거리", road: "길", car: "자동차", hour: "시간",
      thing: "것", things: "것들", something: "무언가", anything: "무엇이든", nothing: "아무것도",
      everything: "모든 것", someone: "누군가", anyone: "누구든", everyone: "모두",
      lot: "많음", lots: "많음", sort: "종류", type: "유형", sense: "의미", order: "순서",
      power: "힘", law: "법", war: "전쟁", peace: "평화", love: "사랑", death: "죽음",
      mind: "마음", heart: "마음", soul: "영혼", god: "신", nature: "자연", society: "사회",
      culture: "문화", experience: "경험", knowledge: "지식", truth: "진실", value: "가치",
      choice: "선택", decision: "결정", effort: "노력", success: "성공", failure: "실패",
      goal: "목표", plan: "계획", future: "미래", past: "과거", present: "현재",
      beginning: "시작", process: "과정", effect: "효과", cause: "원인", evidence: "증거",
      opinion: "의견", view: "견해", role: "역할", relationship: "관계", difference: "차이",
      community: "공동체", company: "회사", government: "정부", president: "대통령",
      parent: "부모", mother: "어머니", father: "아버지", brother: "형제", sister: "자매",
      boy: "소년", girl: "소녀", doctor: "의사", patient: "환자", hospital: "병원",
      movie: "영화", music: "음악", song: "노래", game: "경기", team: "팀", player: "선수",
      food: "음식", water: "물", coffee: "커피", bread: "빵", house: "집", room: "방",
      window: "창문", door: "문", light: "빛", sound: "소리", color: "색", picture: "그림",
      letter: "편지", message: "메시지", phone: "전화", computer: "컴퓨터", data: "자료",
      text: "글", author: "저자", character: "인물", chapter: "장", theme: "주제",
      symbol: "상징", pattern: "패턴", context: "맥락", structure: "구조", style: "문체",
      tone: "어조", mood: "분위기", narrator: "화자", audience: "독자층", purpose: "목적",
      introduction: "도입", conclusion: "결론", summary: "요약", example: "예시",
      paragraph: "문단", sentence: "문장", phrase: "구", clause: "절", subject: "주어",
      object: "목적어", adjective: "형용사", adverb: "부사", noun: "명사",
      opening: "도입", threshold: "문턱", scene: "장면", weather: "날씨"
    });

    addVerb("go", "가다", { p: "갔다", n: "간다", m: "갈", i: "가" });
    addVerb("went", "가다", { p: "갔다", n: "간다", m: "갈", f: "past" });
    addVerb("goes", "가다", { p: "갔다", n: "간다", m: "갈", f: "present" });
    addVerb("come", "오다", { p: "왔다", n: "온다", m: "올", i: "와" });
    addVerb("came", "오다", { p: "왔다", f: "past" });
    addVerb("eat", "먹다", { p: "먹었다", n: "먹는다", m: "먹을", i: "먹어", q: "먹으라고" });
    addVerb("have", "가지다", { p: "가졌다", n: "가진다", m: "가질" });
    addVerb("has", "가지다", { p: "가졌다", n: "가진다", m: "가질", f: "present" });
    addVerb("had", "가지다", { p: "가졌다", n: "가진다", m: "가질", f: "past" });
    addVerb("do", "하다", { p: "했다", n: "한다", m: "할" });
    addVerb("does", "하다", { p: "했다", n: "한다", m: "할", f: "present" });
    addVerb("did", "하다", { p: "했다", n: "한다", m: "할", f: "past" });
    addVerb("walk", "걷다", { p: "걸었다", n: "걷는다", m: "걸을", i: "걸어" });
    addVerb("walked", "걷다", { p: "걸었다", f: "past" });
    addVerb("read", "읽다", { p: "읽었다", n: "읽는다", m: "읽을", i: "읽어" });
    addVerb("learn", "배우다", { p: "배웠다", n: "배운다", m: "배울" });
    addVerb("learned", "배우다", { p: "배웠다", f: "past" });
    addVerb("improve", "향상시키다", { p: "향상시켰다", n: "향상시킨다", m: "향상시킬" });
    addVerb("treat", "다루다", { p: "다뤘다", n: "다룬다", m: "다룰" });
    addVerb("perform", "수행하다", { p: "수행했다", n: "수행한다", m: "수행할" });
    addVerb("performs", "수행하다", { p: "수행했다", n: "수행한다", m: "수행할", f: "present" });
    addVerb("train", "훈련시키다", { p: "훈련시켰다", n: "훈련시킨다", m: "훈련시킬" });
    addVerb("training", "훈련시키다", { p: "훈련시켰다", n: "훈련시킨다", m: "훈련시킬", f: "ing" });
    addVerb("look", "보다", { p: "보았다", n: "본다", m: "볼", i: "봐" });
    addVerb("see", "보다", { p: "보았다", n: "본다", m: "볼", i: "봐" });
    addVerb("saw", "보다", { p: "보았다", f: "past" });
    addVerb("say", "말하다", { p: "말했다", n: "말한다", m: "말할" });
    addVerb("says", "말하다", { p: "말했다", n: "말한다", m: "말할", f: "present" });
    addVerb("said", "말하다", { p: "말했다", f: "past" });
    addVerb("tell", "말하다", { p: "말했다", n: "말한다", m: "말할" });
    addVerb("tells", "말하다", { p: "말했다", n: "말한다", f: "present" });
    addVerb("told", "말하다", { p: "말했다", f: "past" });
    addVerb("figure", "생각하다", { p: "생각했다", n: "생각한다", m: "생각할" });
    addVerb("figured", "생각하다", { p: "생각했다", f: "past" });
    addVerb("think", "생각하다", { p: "생각했다", n: "생각한다", m: "생각할" });
    addVerb("thought", "생각하다", { p: "생각했다", f: "past" });
    addVerb("ask", "묻다", { p: "물었다", n: "묻는다", m: "물을", i: "물어" });
    addVerb("asked", "묻다", { p: "물었다", f: "past" });
    addVerb("wait", "기다리다", { p: "기다렸다", n: "기다린다", m: "기다릴", i: "기다려", q: "기다리라고" });
    addVerb("waited", "기다리다", { p: "기다렸다", f: "past" });
    addVerb("nod", "끄덕이다", { p: "끄덕였다", n: "끄덕인다", m: "끄덕일" });
    addVerb("nodded", "끄덕이다", { p: "끄덕였다", f: "past" });
    addVerb("smile", "미소 짓다", { p: "미소 지었다", n: "미소 짓는다", m: "미소 지을" });
    addVerb("arrive", "도착하다", { p: "도착했다", n: "도착한다", m: "도착할" });
    addVerb("arrived", "도착하다", { p: "도착했다", f: "past" });
    addVerb("stay", "머물다", { p: "머물렀다", n: "머문다", m: "머물" });
    addVerb("stayed", "머물다", { p: "머물렀다", f: "past" });
    addVerb("leave", "떠나다", { p: "떠났다", n: "떠난다", m: "떠날", i: "떠나" });
    addVerb("left", "떠나다", { p: "떠났다", n: "떠난다", m: "떠날", f: "past", a: "남겨진" });
    addVerb("stop", "멈추다", { p: "멈췄다", n: "멈춘다", m: "멈출", i: "멈춰" });
    addVerb("stopped", "멈추다", { p: "멈췄다", f: "past" });
    addVerb("establish", "확립하다", { p: "확립했다", n: "확립한다", m: "확립할" });
    addVerb("notice", "알아차리다", { p: "알아차렸다", n: "알아차린다", m: "알아차릴" });
    addVerb("enter", "들어가다", { p: "들어갔다", n: "들어간다", m: "들어갈" });
    addVerb("appear", "보이다", { p: "보였다", n: "보인다", m: "보일" });
    addVerb("appears", "보이다", { p: "보였다", n: "보인다", f: "present" });
    addVerb("gather", "모이다", { p: "모였다", n: "모인다", m: "모일" });
    addVerb("gathers", "모이다", { p: "모였다", n: "모인다", f: "present" });
    addVerb("begin", "시작하다", { p: "시작했다", n: "시작한다", m: "시작할" });
    addVerb("begins", "시작하다", { p: "시작했다", n: "시작한다", f: "present" });
    addVerb("rush", "서두르다", { p: "서둘렀다", n: "서두른다", m: "서두를" });
    addVerb("miss", "놓치다", { p: "놓쳤다", n: "놓친다", m: "놓칠" });
    addVerb("open", "열다", { p: "열었다", n: "연다", m: "열", i: "열어" });
    addVerb("want", "원하다", { p: "원했다", n: "원한다", m: "원할" });
    addVerb("need", "필요하다", { p: "필요했다", n: "필요하다", m: "필요할" });
    addVerb("use", "사용하다", { p: "사용했다", n: "사용한다", m: "사용할" });
    addVerb("find", "찾다", { p: "찾았다", n: "찾는다", m: "찾을" });
    addVerb("found", "찾다", { p: "찾았다", f: "past" });
    addVerb("give", "주다", { p: "주었다", n: "준다", m: "줄", i: "줘" });
    addVerb("gave", "주다", { p: "주었다", f: "past" });
    addVerb("take", "가져가다", { p: "가져갔다", n: "가져간다", m: "가져갈" });
    addVerb("took", "가져가다", { p: "가져갔다", f: "past" });
    addVerb("get", "얻다", { p: "얻었다", n: "얻는다", m: "얻을" });
    addVerb("got", "얻다", { p: "얻었다", f: "past" });
    addVerb("make", "만들다", { p: "만들었다", n: "만든다", m: "만들" });
    addVerb("made", "만들다", { p: "만들었다", f: "past" });
    addVerb("know", "알다", { p: "알았다", n: "안다", m: "알" });
    addVerb("knew", "알다", { p: "알았다", f: "past" });
    addVerb("feel", "느끼다", { p: "느꼈다", n: "느낀다", m: "느낄" });
    addVerb("felt", "느끼다", { p: "느꼈다", f: "past" });
    addVerb("seem", "보이다", { p: "보였다", n: "보인다", m: "보일" });
    addVerb("seems", "보이다", { p: "보였다", n: "보인다", f: "present" });
    addVerb("become", "되다", { p: "되었다", n: "된다", m: "될" });
    addVerb("keep", "유지하다", { p: "유지했다", n: "유지한다", m: "유지할" });
    addVerb("let", "허락하다", { p: "허락했다", n: "허락한다", m: "허락할" });
    addVerb("help", "돕다", { p: "도왔다", n: "돕는다", m: "도울" });
    addVerb("try", "시도하다", { p: "시도했다", n: "시도한다", m: "시도할" });
    addVerb("call", "부르다", { p: "불렀다", n: "부른다", m: "부를" });
    addVerb("live", "살다", { p: "살았다", n: "산다", m: "살" });
    addVerb("write", "쓰다", { p: "썼다", n: "쓴다", m: "쓸" });
    addVerb("speak", "말하다", { p: "말했다", n: "말한다", m: "말할" });
    addVerb("hear", "듣다", { p: "들었다", n: "듣는다", m: "들을" });
    addVerb("pay", "지불하다", { p: "지불했다", n: "지불한다", m: "지불할" });
    addVerb("meet", "만나다", { p: "만났다", n: "만난다", m: "만날" });
    addVerb("sit", "앉다", { p: "앉았다", n: "앉는다", m: "앉을" });
    addVerb("stand", "서다", { p: "섰다", n: "선다", m: "설" });
    addVerb("play", "놀다", { p: "놀았다", n: "논다", m: "놀" });
    addVerb("run", "달리다", { p: "달렸다", n: "달린다", m: "달릴" });
    addVerb("move", "움직이다", { p: "움직였다", n: "움직인다", m: "움직일" });
    addVerb("turn", "돌다", { p: "돌았다", n: "돈다", m: "돌" });
    addVerb("turned", "돌다", { p: "돌아섰다", f: "past" });
    addVerb("follow", "따르다", { p: "따랐다", n: "따른다", m: "따를" });
    addVerb("remember", "기억하다", { p: "기억했다", n: "기억한다", m: "기억할" });
    addVerb("forget", "잊다", { p: "잊었다", n: "잊는다", m: "잊을" });
    addVerb("decide", "결정하다", { p: "결정했다", n: "결정한다", m: "결정할" });
    addVerb("choose", "고르다", { p: "골랐다", n: "고른다", m: "고를" });
    addVerb("watch", "지켜보다", { p: "지켜보았다", n: "지켜본다", m: "지켜볼" });
    addVerb("study", "공부하다", { p: "공부했다", n: "공부한다", m: "공부할" });
    addVerb("understand", "이해하다", { p: "이해했다", n: "이해한다", m: "이해할" });
    addVerb("love", "사랑하다", { p: "사랑했다", n: "사랑한다", m: "사랑할" });
    addVerb("like", "좋아하다", { p: "좋아했다", n: "좋아한다", m: "좋아할" });
    addVerb("start", "시작하다", { p: "시작했다", n: "시작한다", m: "시작할" });
    addVerb("bring", "가져오다", { p: "가져왔다", n: "가져온다", m: "가져올" });
    addVerb("buy", "사다", { p: "샀다", n: "산다", m: "살" });
    addVerb("hold", "잡다", { p: "잡았다", n: "잡는다", m: "잡을" });
    addVerb("mean", "의미하다", { p: "의미했다", n: "의미한다", m: "의미할" });
    addVerb("include", "포함하다", { p: "포함했다", n: "포함한다", m: "포함할" });
    addVerb("provide", "제공하다", { p: "제공했다", n: "제공한다", m: "제공할" });
    addVerb("consider", "고려하다", { p: "고려했다", n: "고려한다", m: "고려할" });
    addVerb("suggest", "제안하다", { p: "제안했다", n: "제안한다", m: "제안할" });
    addVerb("believe", "믿다", { p: "믿었다", n: "믿는다", m: "믿을" });
    addVerb("happen", "일어나다", { p: "일어났다", n: "일어난다", m: "일어날" });
    addVerb("show", "보여 주다", { p: "보여 주었다", n: "보여 준다", m: "보여 줄" });
    addVerb("search", "찾다", { p: "찾았다", n: "찾는다", m: "찾을" });
    addVerb("reply", "대답하다", { p: "대답했다", n: "대답한다", m: "대답할" });
    addVerb("answer", "대답하다", { p: "대답했다", n: "대답한다", m: "대답할" });
    addVerb("explain", "설명하다", { p: "설명했다", n: "설명한다", m: "설명할" });
    addVerb("whisper", "속삭이다", { p: "속삭였다", n: "속삭인다", m: "속삭일" });
    addVerb("hope", "바라다", { p: "바랐다", n: "바란다", m: "바랄" });
    addVerb("wish", "바라다", { p: "바랐다", n: "바란다", m: "바랄" });
    addVerb("put", "놓다", { p: "놓았다", n: "놓는다", m: "놓을" });
    addVerb("pay", "내다", { p: "냈다", n: "낸다", m: "낼" });

    LEX.train = { pos: "n", key: "train", ko: "기차" };
    LEX.training = { pos: "v", key: "training", base: "훈련시키다", past: "훈련시켰다", present: "훈련시킨다", mod: "훈련시킬", form: "ing", ko: "" };
    LEX.work = { pos: "n", key: "work", ko: "일" };
    LEX.reading = { pos: "n", key: "reading", ko: "읽기" };
    LEX.opening = { pos: "adj", key: "opening", base: "도입이다", attr: "도입", ko: "도입" };
    LEX.change = { pos: "n", key: "change", ko: "변화" };
    LEX.answer = { pos: "n", key: "answer", ko: "답" };
    LEX.left = { pos: "v", key: "left", base: "떠나다", past: "떠났다", present: "떠난다", mod: "떠날", form: "past", alt: "남겨진", ko: "" };
    LEX.past = { pos: "adv", key: "past", ko: "지나쳐" };
    LEX.itself = { pos: "n", key: "itself", ko: "그 자체" };
    LEX.that = { pos: "det", key: "that", ko: "그" };
    if (LEX.stopped) LEX.stopped.pp = "멈춘";

    var PHRASES = [
      { w: ["in", "spite", "of"], pos: "prep", particle: "에도 불구하고" },
      { w: ["in", "front", "of"], pos: "prep", particle: "앞에" },
      { w: ["in", "search", "of"], pos: "prep", particle: "찾아" },
      { w: ["on", "top", "of"], pos: "prep", particle: "위에" },
      { w: ["a", "lot", "of"], pos: "adj", attr: "많은", base: "많다", ko: "많은" },
      { w: ["lots", "of"], pos: "adj", attr: "많은", base: "많다", ko: "많은" },
      { w: ["because", "of"], pos: "prep", particle: "때문에" },
      { w: ["instead", "of"], pos: "prep", particle: "대신에" },
      { w: ["out", "of"], pos: "prep", particle: "밖으로" },
      { w: ["according", "to"], pos: "prep", particle: "에 따르면" },
      { w: ["due", "to"], pos: "prep", particle: "때문에" },
      { w: ["next", "to"], pos: "prep", particle: "옆에" },
      { w: ["not", "only"], pos: "adv", ko: "뿐만 아니라" },
      { w: ["at", "least"], pos: "disc", ko: "적어도" },
      { w: ["of", "course"], pos: "disc", ko: "물론" },
      { w: ["junk", "food"], pos: "n", ko: "정크푸드" }
    ];

    var CONTRACTIONS = {
      "i'm": ["i", "am"], "i'd": ["i", "would"], "i'll": ["i", "will"], "i've": ["i", "have"],
      "you'd": ["you", "would"], "you'll": ["you", "will"], "you've": ["you", "have"], "you're": ["you", "are"],
      "he'd": ["he", "would"], "he'll": ["he", "will"], "he's": ["he", "is"],
      "she'd": ["she", "would"], "she'll": ["she", "will"], "she's": ["she", "is"],
      "we'd": ["we", "would"], "we'll": ["we", "will"], "we've": ["we", "have"], "we're": ["we", "are"],
      "they'd": ["they", "would"], "they'll": ["they", "will"], "they've": ["they", "have"], "they're": ["they", "are"],
      "that's": ["that", "is"], "there's": ["there", "is"], "what's": ["what", "is"], "who's": ["who", "is"],
      "let's": ["let", "us"], "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
      "can't": ["cannot"], "cannot": ["can", "not"], "won't": ["will", "not"], "wouldn't": ["would", "not"],
      "couldn't": ["could", "not"], "shouldn't": ["should", "not"], "isn't": ["is", "not"], "aren't": ["are", "not"],
      "wasn't": ["was", "not"], "weren't": ["were", "not"], "haven't": ["have", "not"], "hasn't": ["has", "not"],
      "hadn't": ["had", "not"], "it's": ["it", "is"]
    };
    LEX.cannot = { pos: "modal", key: "cannot", ko: "" };
    LEX.not = { pos: "adv", key: "not", ko: "" };

    function morphology(key) {
      var rules = [];
      if (key.length > 4 && /ies$/.test(key)) rules.push([key.slice(0, -3) + "y", ""]);
      if (key.length > 5 && /ing$/.test(key)) {
        rules.push([key.slice(0, -3), "ing"]);
        rules.push([key.slice(0, -3) + "e", "ing"]);
      }
      if (key.length > 4 && /ied$/.test(key)) rules.push([key.slice(0, -3) + "y", "past"]);
      if (key.length > 4 && /ed$/.test(key)) {
        rules.push([key.slice(0, -2), "past"]);
        rules.push([key.slice(0, -1), "past"]);
        if (/([bcdfghjklmnpqrstvwxyz])\1ed$/.test(key)) rules.push([key.slice(0, -3), "past"]);
      }
      if (key.length > 3 && /es$/.test(key)) rules.push([key.slice(0, -2), "present"]);
      if (key.length > 3 && /s$/.test(key) && !/ss$/.test(key)) rules.push([key.slice(0, -1), "present"]);
      if (key.length > 4 && /ly$/.test(key)) rules.push([key.slice(0, -2), "ly"]);
      var index;
      for (index = 0; index < rules.length; index += 1) {
        var stem = rules[index][0];
        var form = rules[index][1];
        if (!LEX[stem] || LEX[stem].pos === "x") continue;
        var base = copyEntry(LEX[stem]);
        if (form === "ly") {
          var pred = base.base || base.ko || "";
          var adv = /하다$/.test(pred) ? pred.slice(0, -2) + "하게" : (base.attr || pred);
          if (!adv) continue;
          return { pos: "adv", key: key, ko: adv };
        }
        if (base.pos === "v" && form) base.form = form === "present" ? "present" : form;
        return base;
      }
      return null;
    }

    function resolveRaw(tok) {
      if (!tok || tok.punct) return tok;
      var key = String(tok.key || "").replace(/[’‘]/g, "'");
      var possessive = /'s$/.test(key);
      if (possessive) key = key.replace(/'s$/, "");
      if (/^\d+$/.test(key)) return { key: key, raw: tok.raw, pos: "n", ko: key, punct: false, possessive: false };
      var found = LEX[key] ? copyEntry(LEX[key]) : (NAMES[key] ? { pos: "name", ko: NAMES[key] } : morphology(key));
      if (!found) found = { pos: "x", ko: "" };
      found.key = key;
      found.raw = tok.raw;
      found.punct = false;
      found.possessive = possessive;
      return found;
    }

    function glossWord(word) {
      var key = String(word || "").toLowerCase().replace(/[’‘]/g, "'").replace(/'s$/, "");
      var hit = LEX[key] || (NAMES[key] ? { ko: NAMES[key] } : morphology(key));
      if (!hit) return word;
      if (hit.pos === "v") return hit.form === "past" ? (hit.past || hit.base || word) : (hit.base || hit.ko || word);
      return hit.ko || hit.attr || hit.base || hit.topic || word;
    }

    function stemBase(entry) {
      return (entry && (entry.base || entry.ko)) || "";
    }

    function modifierOf(entry) {
      if (!entry) return "";
      if (entry.mod) return entry.mod;
      var base = stemBase(entry);
      if (!/다$/.test(base)) return "";
      if (/하다$/.test(base)) return base.slice(0, -2) + "할";
      var stem = base.slice(0, -1);
      if (hasBatchim(stem)) return stem + "을";
      return addJong(stem, "ㄹ");
    }

    function presentOf(entry) {
      if (!entry) return "";
      if (entry.present) return entry.present;
      var base = stemBase(entry);
      if (!/다$/.test(base)) return entry.ko || "";
      if (/하다$/.test(base)) return base.slice(0, -2) + "한다";
      var stem = base.slice(0, -1);
      if (hasBatchim(stem)) return stem + "는다";
      return addJong(stem, "ㄴ") + "다";
    }

    function pastOf(entry) {
      if (!entry) return "";
      if (entry.past) return entry.past;
      var base = stemBase(entry);
      if (/하다$/.test(base)) return base.slice(0, -2) + "했다";
      return presentOf(entry);
    }

    function ingOf(entry) {
      if (!entry) return "";
      var base = stemBase(entry);
      if (!/다$/.test(base)) return entry.ko || "";
      return base.slice(0, -1) + "는";
    }

    function quotative(entry) {
      if (!entry) return "";
      if (entry.quot) return entry.quot;
      var base = stemBase(entry);
      if (/하다$/.test(base)) return base.slice(0, -2) + "하라고";
      var stem = base.slice(0, -1);
      if (!stem) return "";
      if (hasBatchim(stem)) return stem + "으라고";
      return stem + "라고";
    }

    function imperativeOf(entry) {
      if (!entry) return "";
      if (entry.imp) return entry.imp;
      var base = stemBase(entry);
      if (/시키다$/.test(base)) return base.slice(0, -3) + "시켜";
      if (/하다$/.test(base)) return base.slice(0, -2) + "해";
      var stem = base.slice(0, -1);
      if (hasBatchim(stem)) return stem + "어";
      return /아$/.test(stem) ? stem : stem + "어";
    }

    function finiteOf(entry, modal) {
      if (modal === "would" || modal === "will" || modal === "shall") return modifierOf(entry) + " 것이다";
      if (modal === "can" || modal === "may") return modifierOf(entry) + " 수 있다";
      if (modal === "could" || modal === "might") return modifierOf(entry) + " 수 있었다";
      if (modal === "must") return "반드시 " + presentOf(entry);
      if (modal === "should") return presentOf(entry) + "야 한다";
      if (entry && entry.form === "past") return pastOf(entry);
      return presentOf(entry);
    }

    function attrOf(tok) {
      if (!tok) return "";
      if (tok.attr) return tok.attr;
      var base = tok.base || "";
      if (/하다$/.test(base)) return base.slice(0, -2) + "한";
      if (/다$/.test(base)) {
        var stem = base.slice(0, -1);
        return hasBatchim(stem) ? stem + "은" : addJong(stem, "ㄴ");
      }
      return tok.ko || "";
    }

    function predicateOf(tok, past) {
      var base = (tok && (tok.base || tok.ko)) || "";
      if (/하다$/.test(base)) return past ? base.slice(0, -2) + "했다" : base;
      if (past && tok && tok.past) return tok.past;
      return base;
    }

    function particleFor(key, np) {
      if (key === "in") return /경우|방식|사실|세계|상황|아침|의미/.test(np) ? "에" : "에서";
      var map = {
        on: "위에", at: "에", into: "안으로", onto: "위로", with: "와 함께", from: "로부터",
        of: "의", as: "로서", by: "에 의해", for: "위해", about: "에 대해", to: "로",
        through: "통해", over: "위로", under: "아래에", between: "사이에", after: "후에",
        before: "전에", without: "없이", within: "안에", during: "동안", against: "거슬러",
        among: "가운데", across: "가로질러", around: "주위에", behind: "뒤에", beyond: "너머",
        toward: "향해", towards: "향해", until: "까지", till: "까지", since: "이후로",
        despite: "에도 불구하고", near: "가까이에", above: "위에", below: "아래에",
        beside: "옆에", along: "따라", via: "을 거쳐", upon: "위에", inside: "안에", outside: "밖에"
      };
      return map[key] || "";
    }

    function tokenize(text) {
      var re = /[A-Za-z]+(?:['’][A-Za-z]+)?|\d+|[.,!?;:]/g;
      var out = [];
      var match;
      while ((match = re.exec(String(text || "")))) {
        var raw = match[0].replace(/[’‘]/g, "'");
        if (/^[.,!?;:]$/.test(raw)) out.push({ key: raw, raw: raw, punct: true, pos: "punct" });
        else out.push({ key: raw.toLowerCase(), raw: raw, punct: false });
      }
      return out;
    }

    function mergePhrases(rawTokens) {
      var out = [];
      var i;
      for (i = 0; i < rawTokens.length; i += 1) {
        if (rawTokens[i].punct) {
          out.push(rawTokens[i]);
          continue;
        }
        var matched = null;
        var consume = 1;
        var p;
        for (p = 0; p < PHRASES.length; p += 1) {
          var words = PHRASES[p].w;
          if (i + words.length > rawTokens.length) continue;
          var ok = true;
          var k;
          for (k = 0; k < words.length; k += 1) {
            if (rawTokens[i + k].punct || rawTokens[i + k].key !== words[k]) ok = false;
          }
          if (!ok) continue;
          if (!matched || words.length > matched.w.length) {
            matched = PHRASES[p];
            consume = words.length;
          }
        }
        if (matched) {
          out.push({
            key: matched.w.join(" "),
            raw: matched.w.join(" "),
            pos: matched.pos,
            ko: matched.ko || "",
            attr: matched.attr || "",
            base: matched.base || "",
            particle: matched.particle || "",
            punct: false,
            possessive: false
          });
          i += consume - 1;
          continue;
        }
        var parts = CONTRACTIONS[rawTokens[i].key];
        if (parts) {
          parts.forEach(function (part) {
            out.push(resolveRaw({ key: part, raw: part, punct: false }));
          });
          continue;
        }
        out.push(resolveRaw(rawTokens[i]));
      }
      return out;
    }

    function analyze(text) {
      return mergePhrases(tokenize(text));
    }

    function contentTokens(tokens) {
      return (tokens || []).filter(function (tok) { return tok && !tok.punct; });
    }

    function readTitles(tokens, index) {
      var titles = [];
      var i = index;
      var name = "";
      while (i < tokens.length) {
        var tok = tokens[i];
        if (!tok || tok.punct) { i += 1; continue; }
        if (TITLES[tok.key]) { titles.push(TITLES[tok.key]); i += 1; continue; }
        if (tok.key === "and" || tok.key === "or") { i += 1; continue; }
        if (tok.pos === "name" || (tok.raw && /^[A-Z]/.test(tok.raw) && tok.pos !== "pron" && tok.pos !== "det")) {
          name = tok.ko || "";
          i += 1;
          break;
        }
        break;
      }
      if (!titles.length) return { text: "", next: index + 1 };
      if (!name) return { text: titles[0], next: i };
      return {
        text: titles.map(function (title) { return name + " " + title; }).join("와 "),
        next: i
      };
    }

    function renderNP(tokens) {
      var out = [];
      var i;
      for (i = 0; i < tokens.length; i += 1) {
        var tok = tokens[i];
        if (!tok || tok.punct) continue;
        if (TITLES[tok.key]) {
          var got = readTitles(tokens, i);
          if (got.text) out.push(got.text);
          i = got.next - 1;
          continue;
        }
        if (tok.key === "and") { out.push("&"); continue; }
        if (tok.key === "or") { out.push("또는"); continue; }
        if (tok.key === "but") { out.push("그러나"); continue; }
        if (tok.pos === "det") { if (tok.ko) out.push(tok.ko); continue; }
        if (tok.pos === "pron" && tok.poss) {
          var nxt = tokens[i + 1];
          while (nxt && nxt.punct) nxt = tokens[i + 2];
          if (nxt && nxt.pos !== "v" && nxt.pos !== "be" && nxt.pos !== "prep" && nxt.pos !== "conj" && nxt.pos !== "modal") {
            out.push(tok.poss);
            continue;
          }
          out.push(tok.obj || tok.topic || "");
          continue;
        }
        if (tok.possessive && (tok.ko || tok.base)) { out.push((tok.ko || attrOf(tok) || tok.base) + "의"); continue; }
        if (tok.pos === "adj") { out.push(attrOf(tok)); continue; }
        if (tok.pos === "adv" || tok.pos === "disc") { if (tok.ko) out.push(tok.ko); continue; }
        if (tok.key === "left" && tok.alt) { out.push(tok.alt); continue; }
        if (tok.pos === "prep" && tokens[i + 1]) {
          var rest = [];
          var n = i + 1;
          while (n < tokens.length && tokens[n] && !tokens[n].punct && tokens[n].pos !== "conj" && tokens[n].pos !== "v" && tokens[n].pos !== "be") {
            rest.push(tokens[n]);
            n += 1;
          }
          var inner = renderNP(rest);
          if (tok.particle === "찾아" && inner) out.push(objectParticle(inner) + " 찾아");
          else if (inner) out.push(attachParticle(inner, tok.particle || particleFor(tok.key, inner)));
          if (rest.length) i = n - 1;
          continue;
        }
        if (tok.pos === "v" && (tok.form === "ing" || /ing$/.test(tok.key))) { out.push(ingOf(tok)); continue; }
        if (tok.ko) { out.push(tok.ko); continue; }
        if (tok.pos === "name" && tok.ko) { out.push(tok.ko); continue; }
      }
      return out.join(" ").replace(/(\S) & /g, function (all, prev) {
        return prev + (hasBatchim(prev) ? "과 " : "와 ");
      }).replace(/\s+/g, " ").trim();
    }

    function renderSubject(list, ga) {
      if (!list.length) return "";
      if (list[0] && list[0].key === "to" && list[1] && list[1].pos === "v") {
        var obj = renderNP(list.slice(2));
        var core = (obj ? objectParticle(obj) + " " : "") + ingOf(list[1]) + " 것";
        return ga ? subjectParticle(core) : topicParticle(core);
      }
      if (list.length === 1 && list[0].key === "this") return ga ? "이것이" : "이것은";
      if (list.length === 1 && list[0].key === "that") return ga ? "그것이" : "그것은";
      if (list.length === 1 && list[0].pos === "pron") return ga ? (list[0].ga || list[0].topic) : (list[0].topic || list[0].ga);
      var np = renderNP(list);
      if (!np) return "";
      return ga ? subjectParticle(np) : topicParticle(np);
    }

    function isLexical(tokens, index) {
      var tok = tokens[index];
      if (!tok || tok.punct) return false;
      if (tok.pos !== "v" && tok.pos !== "be") return false;
      if (tok.key === "left") {
        var prev = tokens[index - 1];
        if (prev && (prev.pos === "n" || prev.pos === "name" || prev.pos === "adj")) return false;
      }
      var ahead;
      if (/^(have|has|had|do|does|did)$/.test(tok.key) || tok.pos === "be") {
        for (ahead = index + 1; ahead < tokens.length; ahead += 1) {
          if (!tokens[ahead] || tokens[ahead].punct || tokens[ahead].pos === "adv" || tokens[ahead].key === "not") continue;
          if (tokens[ahead].pos === "v" && tok.pos !== "be") return false;
          if (tok.pos === "be" && tokens[ahead].pos === "v" && (tokens[ahead].form === "ing" || /ing$/.test(tokens[ahead].key))) return false;
          break;
        }
      }
      return true;
    }

    function verbIndex(tokens) {
      var skipInf = tokens[0] && tokens[0].key === "to" && tokens[1] && tokens[1].pos === "v";
      var candidate = -1;
      var i;
      for (i = 0; i < tokens.length; i += 1) {
        if (skipInf && i < 2) continue;
        if (!isLexical(tokens, i)) continue;
        if (tokens[i].pos === "be") {
          if (i > 0 && tokens[i - 1] && tokens[i - 1].key === "to") continue;
          var hasRest = false;
          var n;
          for (n = i + 1; n < tokens.length; n += 1) {
            if (tokens[n] && !tokens[n].punct) { hasRest = true; break; }
          }
          if (hasRest) return i;
          continue;
        }
        if (candidate < 0) candidate = i;
      }
      return candidate;
    }

    function peelAttribution(tokens) {
      var i = tokens.length - 1;
      while (i >= 0 && tokens[i].punct) i -= 1;
      if (i < 1 || !SPEECH[tokens[i].key]) return null;
      var subj = tokens[i - 1];
      if (!subj || (subj.pos !== "pron" && subj.pos !== "name")) return null;
      var cut = i - 1;
      if (cut > 0 && tokens[cut - 1].punct && tokens[cut - 1].raw === ",") cut -= 1;
      var main = tokens.slice(0, cut);
      if (!main.some(function (tok) { return tok && !tok.punct; })) return null;
      return { main: main, attr: tokens.slice(i - 1, i + 1) };
    }

    function isPureInfinitive(tokens) {
      var words = contentTokens(tokens);
      if (!(words[0] && words[0].key === "to" && words[1] && words[1].pos === "v")) return false;
      var peeled = peelAttribution(tokens);
      var body = contentTokens(peeled ? peeled.main : words);
      var i;
      for (i = 2; i < body.length; i += 1) {
        if (body[i].pos === "be" || body[i].pos === "modal" || body[i].pos === "sub" || body[i].pos === "v") return false;
      }
      return true;
    }

    function translateInfinitive(tokens) {
      var peeled = peelAttribution(tokens);
      var body = contentTokens(peeled ? peeled.main : tokens);
      var verb = body[1];
      var obj = renderNP(body.slice(2));
      var head = obj ? ((verb && (verb.key === "enter" || /들어가/.test(verb.base || ""))) ? obj + "에 " + modifierOf(verb) : objectParticle(obj) + " " + modifierOf(verb)) : modifierOf(verb);
      if (!peeled) return head;
      var tail = translateClause(peeled.attr);
      return tail ? head + ", " + tail : head;
    }

    function translatePrep(tokens) {
      var words = contentTokens(tokens);
      if (!words.length) return "";
      var prep = words[0];
      var rest = words.slice(1);
      if (prep.key === "in" && rest[0] && rest[0].key === "how" && rest[1] && rest[1].key === "to" && rest[2] && rest[2].pos === "v") {
        return "어떻게 " + stemBase(rest[2]).replace(/다$/, "") + "는지에";
      }
      if ((prep.key === "of" || prep.particle === "의") && rest[0] && rest[0].pos === "v") {
        var owned = renderNP(rest.slice(1));
        return owned ? objectParticle(owned) + " " + ingOf(rest[0]) : ingOf(rest[0]);
      }
      if (prep.particle === "찾아") {
        var sought = renderNP(rest);
        return sought ? objectParticle(sought) + " 찾아" : "찾아";
      }
      var np = renderNP(rest);
      if (!np) return prep.ko || "";
      return attachParticle(np, prep.particle || particleFor(prep.key, np));
    }

    function renderBe(verb, objTokens) {
      var past = !!(verb && (verb.form === "past" || /^(was|were|been)$/.test(verb.key)));
      var inf = -1;
      var i;
      for (i = 0; i < objTokens.length; i += 1) {
        if (objTokens[i].key === "to" && objTokens[i + 1] && (objTokens[i + 1].pos === "v" || objTokens[i + 1].pos === "be")) {
          inf = i;
          break;
        }
      }
      if (inf >= 0 && objTokens[inf + 1].pos === "v") {
        var ads = [];
        objTokens.slice(0, inf).forEach(function (tok) {
          if (tok.ko && (tok.pos === "adv" || tok.pos === "disc")) ads.push(tok.ko);
        });
        var rest = renderNP(objTokens.slice(inf + 2));
        var core = (rest ? rest + "에 " : "") + ingOf(objTokens[inf + 1]) + " 것이다";
        return ads.concat([core]).join(" ");
      }
      if (inf >= 0 && objTokens[inf + 1].pos === "be") {
        var lead = [];
        objTokens.slice(0, inf).forEach(function (tok) {
          if (tok.ko) lead.push(tok.ko);
        });
        var complement = renderNP(objTokens.slice(inf + 2));
        return lead.concat([complement ? complement + "인 것이다" : "인 것이다"]).join(" ");
      }
      var intens = [];
      var cursor = 0;
      while (cursor < objTokens.length && objTokens[cursor].pos === "adv") {
        if (objTokens[cursor].ko) intens.push(objTokens[cursor].ko);
        cursor += 1;
      }
      if (objTokens[cursor] && objTokens[cursor].pos === "adj") {
        return intens.concat([predicateOf(objTokens[cursor], past)]).join(" ");
      }
      if (objTokens.length === 1 && objTokens[0].key === "why") return "이유이다";
      var np = renderNP(objTokens);
      if (!np) return past ? "이었다" : "이다";
      return np + (past ? (hasBatchim(np) ? "이었다" : "였다") : "이다");
    }

    function nounOnly(conj, words, source) {
      if (!words.length) return conj || "";
      var onlyAdv = words.every(function (tok) { return tok.pos === "adv" || tok.pos === "disc"; });
      if (onlyAdv) return [conj].concat(words.map(function (tok) { return tok.ko; })).filter(Boolean).join(" ");
      var np = renderNP(words);
      if (!np) return conj || "";
      var marked = /^[A-Z]/.test(String(source || "").trim()) ? topicParticle(np) : objectParticle(np);
      return [conj, marked].filter(Boolean).join(" ");
    }

    function translateClause(tokens, source) {
      var words = contentTokens(tokens);
      if (!words.length) return "";
      var conj = "";
      if (words[0].pos === "conj") {
        conj = words[0].ko;
        words = words.slice(1);
      }
      var sub = "";
      if (words[0] && words[0].pos === "sub") {
        sub = words[0].key;
        words = words.slice(1);
      }
      if ((words[0] && (words[0].key === "who" || words[0].key === "which"))) {
        var relWords = words.slice(1);
        var relVerb = verbIndex(relWords);
        if (relVerb >= 0) {
          var relObj = renderNP(relWords.slice(relVerb + 1));
          return [relObj ? objectParticle(relObj) : "", ingOf(relWords[relVerb]) + (words[0].key === "which" ? " 것" : " 사람")].filter(Boolean).join(" ");
        }
      }
      var vAt = verbIndex(words);
      if (vAt < 0) return nounOnly(conj, words, source);
      var before = words.slice(0, vAt);
      var verb = words[vAt];
      var after = words.slice(vAt + 1);
      var front = [];
      var pre = [];
      var subject = [];
      var modals = [];
      before.forEach(function (tok) {
        if (tok.key === "not") return;
        if (tok.pos === "modal") { modals.push(tok.key === "cannot" ? "can" : tok.key); return; }
        if (tok.pos === "disc") { if (tok.ko) front.push(tok.ko); return; }
        if (tok.pos === "adv") { if (tok.ko) pre.push(tok.ko); return; }
        subject.push(tok);
      });
      var obj = [];
      after.forEach(function (tok, index) {
        var rest = after.slice(index + 1).some(function (item) { return item && !item.punct && item.pos !== "adv" && item.pos !== "disc"; });
        if (!rest && (tok.pos === "adv" || tok.pos === "disc")) {
          if (tok.pos === "disc" && tok.ko) front.push(tok.ko);
          else if (tok.ko) pre.push(tok.ko);
          return;
        }
        obj.push(tok);
      });
      var useGa = sub === "when" || sub === "if" || sub === "while" || sub === "because";
      var subjectText = renderSubject(subject, useGa);
      var objectText = "";
      var verbText = "";
      if ((/^appear/.test(verb.key) || /^seem/.test(verb.key)) && obj[0] && obj[0].key === "to" && obj[1] && obj[1].pos === "be") {
        var seemed = renderNP(obj.slice(2));
        verbText = seemed ? seemed + "인 것처럼 보인다" : "것처럼 보인다";
      } else if (verb.pos === "be" && obj[0] && obj[0].key === "why") {
        var whyWords = obj.slice(1);
        var whyVerb = verbIndex(whyWords);
        if (whyVerb >= 0) {
          var whySub = renderSubject(whyWords.slice(0, whyVerb), true);
          var whySaid = presentOf(whyWords[whyVerb]);
          if (/한다$/.test(whySaid)) whySaid = whySaid.slice(0, -2) + "한다는 이유이다";
          verbText = [whySub, whySaid].filter(Boolean).join(" ");
        } else verbText = renderBe(verb, obj);
      } else if (verb.pos === "be") {
        verbText = renderBe(verb, obj);
      } else if (!conj && !subjectText && !modals.length && verb.form !== "past" && verb.form !== "present" && verb.form !== "ing") {
        objectText = renderNP(obj);
        if (objectText) objectText = objectParticle(objectText);
        verbText = imperativeOf(verb);
      } else {
        if (obj[0] && obj[0].key === "to" && obj[1] && obj[1].pos === "v") {
          var infObj = renderNP(obj.slice(2));
          objectText = (infObj ? objectParticle(infObj) + " " : "") + modifierOf(obj[1]);
        } else {
          var np = renderNP(obj);
          objectText = np ? objectParticle(np) : "";
        }
        var modal = modals.length ? modals[modals.length - 1] : "";
        if ((sub === "when" || sub === "while") && !modal) verbText = modifierOf(verb) + " 때";
        else verbText = finiteOf(verb, modal);
      }
      var lead = [];
      if (conj) lead.push(conj);
      if (sub === "although" || sub === "though") lead.push("비록");
      else if (sub === "if") lead.push("만약");
      else if (sub === "because") lead.push("왜냐하면");
      return lead.concat(front).concat([subjectText, objectText]).concat(pre).concat([verbText]).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }

    function startsWithPrep(tokens) {
      var words = contentTokens(tokens);
      return !!(words[0] && words[0].pos === "prep");
    }

    function hasFiniteAfterPrep(tokens) {
      var words = contentTokens(tokens);
      var i;
      for (i = 1; i < words.length; i += 1) {
        if (words[i - 1] && words[i - 1].key === "to" && words[i].pos === "v") continue;
        if (words[i].pos === "be") return true;
        if (words[i].pos === "v" && words[i].form !== "ing") return true;
      }
      return false;
    }

    function splitMarks(tokens) {
      var parts = [[]];
      tokens.forEach(function (tok) {
        if (tok && tok.punct && (tok.raw === "," || tok.raw === ":")) parts.push([]);
        else parts[parts.length - 1].push(tok);
      });
      return parts.filter(function (part) { return contentTokens(part).length; });
    }

    function pastAttr(entry) {
      if (!entry) return "";
      if (entry.pp) return entry.pp;
      if (entry.alt && entry.key === "left") return entry.alt;
      var base = stemBase(entry);
      if (/하다$/.test(base) && (entry.form === "past" || /ed$/.test(entry.key || ""))) return base.slice(0, -2) + "한";
      return "";
    }

    function renderRelativeNP(tokens) {
      var words = contentTokens(tokens);
      var thatAt = -1;
      var i;
      for (i = 0; i < words.length; i += 1) {
        if (i > 0 && /^(that|which|who)$/.test(words[i].key)) { thatAt = i; break; }
      }
      if (thatAt > 0) {
        var noun = renderNP(words.slice(0, thatAt));
        var rel = words.slice(thatAt + 1);
        var relAt = verbIndex(rel);
        if (noun && relAt >= 0) return (pastAttr(rel[relAt]) || ingOf(rel[relAt])) + " " + noun;
      }
      var nounAt = -1;
      for (i = 0; i < words.length; i += 1) {
        if (words[i].pos === "n" || words[i].pos === "name") nounAt = i;
      }
      if (nounAt >= 0 && nounAt < words.length - 1) {
        var mods = [];
        for (i = nounAt + 1; i < words.length; i += 1) {
          var tok = words[i];
          if (tok.alt) mods.push(tok.alt);
          else if (tok.pos === "adj") mods.push(attrOf(tok));
          else if (tok.pos === "v") mods.push(pastAttr(tok) || ingOf(tok));
          else if (tok.ko) mods.push(tok.ko);
        }
        mods = mods.filter(Boolean);
        if (mods.length) return mods.reverse().join(" ") + " " + renderNP(words.slice(0, nounAt + 1));
      }
      return renderNP(words);
    }

    function translateTokens(tokens, source) {
      if (!contentTokens(tokens).length) return "";
      if (isPureInfinitive(tokens)) return translateInfinitive(tokens);
      var words = contentTokens(tokens);
      if (startsWithPrep(tokens)) {
        var last = words[words.length - 1];
        var prev = words[words.length - 2];
        if (last && last.pos === "v" && last.form !== "ing" && prev && prev.key !== "to" && words.length > 2) {
          return [translatePrep(words.slice(0, -1)), finiteOf(last, "")].filter(Boolean).join(" ");
        }
        if (!hasFiniteAfterPrep(tokens)) return translatePrep(tokens);
      }
      return translateClause(tokens, source);
    }

    function translateChunk(text) {
      var tokens = analyze(text);
      if (!contentTokens(tokens).length) return "";
      if (isPureInfinitive(tokens) || peelAttribution(tokens)) return translateTokens(tokens, text);
      var parts = splitMarks(tokens);
      if (parts.length >= 2) {
        return parts.map(function (part) {
          if (startsWithPrep(part) && !hasFiniteAfterPrep(part)) return translatePrep(part);
          if (contentTokens(part).some(function (tok) { return /^(that|who|which)$/.test(tok.key); }) || verbIndex(contentTokens(part)) < 0) return renderRelativeNP(part);
          return translateTokens(part, "");
        }).filter(Boolean).join(", ");
      }
      return translateTokens(tokens, text);
    }

    var QUOTE_PHRASES = [
      ["s'il vous plait", "부탁합니다"],
      ["au revoir", "안녕히 가세요"],
      ["merci beaucoup", "대단히 감사합니다"],
      ["buenos dias", "좋은 아침입니다"],
      ["buenas noches", "안녕히 주무세요"],
      ["buenas tardes", "안녕하세요"],
      ["guten morgen", "좋은 아침입니다"],
      ["guten abend", "안녕하세요"],
      ["guten tag", "안녕하세요"],
      ["good morning", "좋은 아침입니다"],
      ["good evening", "안녕하세요"],
      ["good afternoon", "안녕하세요"],
      ["good night", "안녕히 주무세요"],
      ["thank you", "감사합니다"],
      ["excuse me", "실례합니다"],
      ["bonjour", "안녕하세요"],
      ["bonsoir", "안녕하세요"],
      ["salut", "안녕"],
      ["merci", "감사합니다"],
      ["hola", "안녕하세요"],
      ["adios", "안녕히 가세요"],
      ["gracias", "감사합니다"],
      ["ciao", "안녕"],
      ["grazie", "감사합니다"],
      ["danke", "감사합니다"],
      ["bitte", "부탁합니다"],
      ["konnichiwa", "안녕하세요"],
      ["arigato", "감사합니다"],
      ["hello", "안녕하세요"],
      ["hi", "안녕"],
      ["goodbye", "안녕히 가세요"],
      ["thanks", "감사합니다"],
      ["welcome", "환영합니다"],
      ["sorry", "미안합니다"],
      ["oui", "예"],
      ["non", "아니요"]
    ];
    var QUOTE_TITLES = {
      mister: "씨", mr: "씨", monsieur: "씨", herr: "씨", senor: "씨", sir: "경",
      mrs: "부인", madame: "부인", frau: "부인", senora: "부인",
      ms: "양", miss: "양", mademoiselle: "양",
      dr: "박사", prof: "교수"
    };

    function foldLatin(text) {
      return String(text || "").toLowerCase().replace(/[’‘]/g, "'")
        .replace(/[àáâãäå]/g, "a").replace(/[èéêë]/g, "e").replace(/[ìíîï]/g, "i")
        .replace(/[òóôõö]/g, "o").replace(/[ùúûü]/g, "u").replace(/ñ/g, "n").replace(/ç/g, "c").replace(/ß/g, "ss");
    }

    function keepLatinToken(word) {
      if (/^[A-Z]{1,6}$/.test(word)) return true;
      if (/^[A-Z](?:\.[A-Z])+\.?$/.test(word)) return true;
      if (/^[A-Z]$/.test(word)) return true;
      if (/^[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*$/.test(word)) {
        var key = foldLatin(word);
        if (LEX[key] || QUOTE_TITLES[key] || NAMES[key]) return false;
        var known = QUOTE_PHRASES.some(function (row) { return row[0] === key; });
        if (known) return false;
        return true;
      }
      return false;
    }

    function stripLooseLatin(text) {
      return String(text || "")
        .replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g, function (word) {
          return keepLatinToken(word) ? word : " ";
        })
        .replace(/\s+/g, " ")
        .replace(/\s+,/g, ",")
        .replace(/,(?=\S)/g, ", ")
        .trim();
    }

    function scanQuoteTokens(text) {
      var re = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)?|\d+|[.,!?;:]/g;
      var out = [];
      var match;
      while ((match = re.exec(String(text || "")))) {
        var raw = match[0].replace(/[’‘]/g, "'");
        if (/^[.,!?;:]$/.test(raw)) out.push({ raw: raw, punct: true, key: raw });
        else out.push({ raw: raw, punct: false, key: foldLatin(raw) });
      }
      return out;
    }

    function needsQuoteRescue(text) {
      var words = String(text || "").match(/[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g) || [];
      return words.some(function (word) {
        var key = foldLatin(word);
        if (QUOTE_TITLES[key]) return true;
        if (QUOTE_PHRASES.some(function (row) { return row[0] === key; })) return true;
        if (/^(a|an|the)$/.test(key)) return false;
        if (LEX[key] || NAMES[key]) return false;
        if (morphology(key)) return false;
        return true;
      });
    }

    function quotePhraseAt(tokens, index) {
      var best = null;
      QUOTE_PHRASES.forEach(function (row) {
        var parts = row[0].split(" ");
        if (index + parts.length > tokens.length) return;
        var ok = parts.every(function (part, offset) {
          return tokens[index + offset] && !tokens[index + offset].punct && tokens[index + offset].key === part;
        });
        if (ok && (!best || parts.length > best.len)) best = { len: parts.length, ko: row[1] };
      });
      return best;
    }

    function quoteNameAt(tokens, index) {
      var tok = tokens[index];
      if (!tok || tok.punct) return null;
      if (NAMES[tok.key]) return { text: NAMES[tok.key], next: index + 1 };
      if (/^[A-Z]{2,6}$/.test(tok.raw)) return { text: tok.raw, next: index + 1 };
      if (/^[A-Z][a-zÀ-ÖØ-öø-ÿ'’.-]+$/.test(tok.raw)) return { text: tok.raw, next: index + 1 };
      if (/^[A-Z]$/.test(tok.raw)) {
        var text = tok.raw;
        var i = index + 1;
        var sawMore = false;
        while (i < tokens.length) {
          if (tokens[i].punct && tokens[i].raw === ".") {
            text += ".";
            i += 1;
            continue;
          }
          if (/^[A-Z]$/.test(tokens[i].raw)) {
            text += tokens[i].raw;
            sawMore = true;
            i += 1;
            continue;
          }
          break;
        }
        if (sawMore || /^[A-Z]$/.test(tok.raw)) return { text: text.replace(/\.$/, ""), next: sawMore ? i : index + 1 };
      }
      return null;
    }

    function glossOrKeep(tok) {
      if (!tok) return "";
      if (tok.punct) return tok.raw;
      if (QUOTE_TITLES[tok.key]) return QUOTE_TITLES[tok.key];
      var phrase = QUOTE_PHRASES.filter(function (row) { return row[0] === tok.key; })[0];
      if (phrase) return phrase[1];
      if (NAMES[tok.key]) return NAMES[tok.key];
      var hit = LEX[tok.key] || morphology(tok.key);
      if (hit) {
        if (hit.pos === "pron") return hit.topic || hit.ko || tok.raw;
        if (hit.pos === "be") return "이다";
        if (hit.pos === "v") return hit.form === "past" ? (hit.past || hit.base || tok.raw) : (hit.base || hit.ko || tok.raw);
        if (hit.pos === "adj") return hit.attr || hit.ko || tok.raw;
        if (hit.ko) return hit.ko;
      }
      return tok.raw;
    }

    function translateQuoteText(text) {
      var tokens = scanQuoteTokens(text);
      if (!tokens.length) return "";
      if (!needsQuoteRescue(text)) return polish(translateChunk(text), text);
      var out = [];
      var span = [];
      function pushPiece(piece) {
        if (!piece) return;
        out.push(piece);
      }
      function flushSpan() {
        if (!span.length) return;
        var src = span.map(function (tok) { return tok.raw; }).join(" ");
        var ko = stripLooseLatin(translateChunk(src));
        var missing = span.some(function (tok) {
          if (/^(a|an|the)$/.test(tok.key)) return false;
          if (ko && ko.indexOf(tok.raw) >= 0) return false;
          var gloss = glossOrKeep(tok);
          return !(gloss && ko && ko.indexOf(gloss) >= 0);
        });
        if (ko && !missing) pushPiece(ko);
        else span.forEach(function (tok) { pushPiece(glossOrKeep(tok)); });
        span = [];
      }
      var i;
      for (i = 0; i < tokens.length; i += 1) {
        var tok = tokens[i];
        if (tok.punct) {
          flushSpan();
          pushPiece(tok.raw);
          continue;
        }
        var phrase = quotePhraseAt(tokens, i);
        if (phrase) {
          flushSpan();
          pushPiece(phrase.ko);
          i += phrase.len - 1;
          continue;
        }
        if (QUOTE_TITLES[tok.key]) {
          var nameAt = i + 1;
          while (tokens[nameAt] && tokens[nameAt].punct && tokens[nameAt].raw === ".") nameAt += 1;
          var name = quoteNameAt(tokens, nameAt);
          flushSpan();
          if (name) {
            pushPiece(name.text + " " + QUOTE_TITLES[tok.key]);
            i = name.next - 1;
          } else pushPiece(QUOTE_TITLES[tok.key]);
          continue;
        }
        span.push(tok);
      }
      flushSpan();
      var textOut = "";
      out.forEach(function (piece) {
        if (/^[.,!?;:]$/.test(piece)) textOut = textOut.replace(/\s+$/, "") + piece;
        else textOut += (textOut && !/[\s(]$/.test(textOut) ? " " : "") + piece;
      });
      return textOut.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ").trim();
    }

    function polish(ko, source) {
      var text = stripLooseLatin(ko);
      text = text.replace(/[.!?…]+$/g, "").trim();
      if (/,\s*$/.test(String(source || "")) && text && !/,\s*$/.test(text)) text += ",";
      return text;
    }

    function isSpeechLead(text) {
      var words = contentTokens(analyze(text));
      return !!(words.length && SPEECH[words[words.length - 1].key]);
    }

    function renderSpeech(leading, quoteText) {
      var words = contentTokens(analyze(leading));
      var speech = words.pop();
      var subject = renderSubject(words, false);
      var quoteWords = contentTokens(analyze(quoteText));
      var please = quoteWords.some(function (tok) { return tok.key === "please"; });
      var verb = null;
      var hasSubject = false;
      quoteWords.forEach(function (tok) {
        if (tok.pos === "pron" && !tok.poss && tok.key !== "please") hasSubject = true;
        if (!verb && tok.pos === "v") verb = tok;
      });
      var said = speech && speech.form === "past" ? pastOf(speech) : presentOf(speech);
      var quoted = "";
      if (needsQuoteRescue(quoteText)) {
        quoted = translateQuoteText(quoteText).replace(/[.!?…]+$/g, "");
        if (quoted && !/(라고|다고)$/.test(quoted)) quoted += "라고";
      } else if (verb && !hasSubject) quoted = (please ? "제발 " : "") + quotative(verb);
      else quoted = polish(translateChunk(quoteText), quoteText).replace(/다$/, "다고");
      return [subject, quoted, said].filter(Boolean).join(" ");
    }

    function koreanChunkCompute(text) {
      var raw = String(text || "").trim();
      if (!raw) return "그 부분";
      if (!/["“”]/.test(raw)) return polish(translateChunk(raw), raw) || "그 부분";
      var bits = raw.split(/(["“][^"”]*["”])/);
      var leading = "";
      var trailing = "";
      var quotes = [];
      bits.forEach(function (bit) {
        if (!bit || !String(bit).trim()) return;
        if (/^["“]/.test(bit)) quotes.push(bit.replace(/^["“]|["”]$/g, "").trim());
        else if (!quotes.length) leading += bit;
        else trailing += bit;
      });
      var quoteText = quotes.join(" ");
      if (leading.trim() && isSpeechLead(leading)) return stripLooseLatin(renderSpeech(leading, quoteText)) || "그 부분";
      var quoteKo = quoteText ? translateQuoteText(quoteText) : "";
      var trailKo = trailing.trim() ? polish(translateChunk(trailing), trailing) : "";
      var leadKo = leading.trim() ? polish(translateChunk(leading), leading) : "";
      var parts = [];
      if (leadKo) parts.push(leadKo);
      if (quoteKo && trailKo) {
        var gap = /[.!?…]$/.test(quoteKo) ? " " : ", ";
        parts.push(quoteKo + gap + trailKo);
      } else {
        if (quoteKo) parts.push(quoteKo);
        if (trailKo) parts.push(trailKo);
      }
      return stripLooseLatin(parts.join(", ")).replace(/[.!?…]+$/g, "").trim() || "그 부분";
    }

    function koreanChunk(text) {
      var key = String(text || "").trim();
      if (koreanMemo.has(key)) return koreanMemo.get(key);
      return remember(koreanMemo, key, koreanChunkCompute(key));
    }

    function sanitizeKoreanChunk(text) {
      return stripLooseLatin(text).replace(/\s+([.,!?;:])/g, "$1").trim();
    }

    function chunksAreKorean(list, count) {
      if (!list || list.length !== count) return false;
      return list.every(function (part) {
        var text = String(part || "").trim();
        return /[가-힣]/.test(text) && !/[A-Za-z]/.test(text);
      });
    }

    function literalSentence(sentence) {
      var glossed = String(sentence || "").split(/(\s+)/).map(function (part) {
        if (!/[A-Za-z]/.test(part)) return part;
        var core = part.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, "");
        var gloss = glossWord(core);
        if (!gloss || gloss === core) return part;
        return part.replace(core, gloss);
      }).join("").replace(/\s+/g, " ").trim();
      return glossed || sentence;
    }

    function freeSentence(sentence) {
      var focus = contentWords(sentence).slice(0, 4).map(glossWord).join(", ") || "이 문장의 세부";
      var text = String(sentence || "");
      if (/^although\b|^though\b/i.test(text)) return "양보로 시작합니다. 앞 절의 초점은 " + focus + "이고, 쉼표 뒤가 본주장입니다.";
      if (/^this is why\b/i.test(text)) return "앞 내용이 이유입니다. 여기서의 결론은 " + focus + "입니다.";
      if (/^what\b/i.test(text)) return "겉으로 보이는 것과 실제 주장이 다릅니다. 초점은 " + focus + "입니다.";
      if (/^to\s+[a-z]/i.test(text)) return "to부정사가 주어입니다. 핵심은 " + focus + "입니다.";
      if (/^readers?\b/i.test(text)) return "독자의 읽기 태도를 지적합니다. 놓치는 대상은 " + focus + "입니다.";
      if (/^a\s+/i.test(text)) return "구체적인 예를 듭니다. 핵심 소재는 " + focus + "입니다.";
      return "이 문장의 초점은 " + focus + "입니다.";
    }

    function structureOf(sentence) {
      var text = String(sentence || "");
      if (/^although\b|^though\b|,?\s+but\b/i.test(text)) {
        return { label: "양보와 본동사", explanation: "Although나 though가 이끄는 절은 양보입니다. 쉼표 뒤의 절에 글쓴이의 본주장이 있습니다." };
      }
      if (/^to\s+[a-z]/i.test(text)) {
        return { label: "to부정사 주어", explanation: "문두의 to부정사구가 주어입니다. is already to 뒤에는 그 행위의 결과가 옵니다." };
      }
      if (/^what\b/i.test(text)) {
        return { label: "명사절 주어", explanation: "What으로 시작하는 절 전체가 주어입니다. 동사 is 뒤에서 그 주어를 다시 정의합니다." };
      }
      if (/not only\b/i.test(text)) {
        return { label: "not only A but B", explanation: "not only 다음이 앞 정보이고 but 다음이 글쓴이가 더 밀고 싶은 정보입니다." };
      }
      if (/who\b|which\b|that\b/i.test(text)) {
        return { label: "관계절", explanation: "관계절은 앞의 명사를 한정합니다. 수식 덩어리를 접으면 본동사가 보입니다." };
      }
      return { label: "본동사와 수식", explanation: "수식어를 잠시 접고 주어 다음의 동사를 먼저 잡으면 문장 뼈대가 보입니다." };
    }

    function guessPos(word) {
      var key = String(word || "").toLowerCase();
      if (/ly$/.test(key)) return "부사";
      if (/^(treat|perform|train|look|establish|rush|miss|begin|notice|enter|appear|gather|tell|stop|search)$/.test(key)) return "동사";
      if (/^(mere|single|concrete|demanding|literary|moral|quiet|repeated|unexpected|close|opening|cracked)$/.test(key)) return "형용사";
      return "명사";
    }

    function flowChunks(sentences) {
      var pieces = sentences.slice();
      sentences.forEach(function (sentence) {
        String(sentence || "").split(/\s+[—–]\s+|;\s+/).forEach(function (part) {
          var bit = part.trim();
          if (bit.length > 28 && pieces.indexOf(bit) === -1) pieces.push(bit);
        });
      });
      var unique = [];
      pieces.forEach(function (item) {
        if (!item || unique.indexOf(item) !== -1) return;
        unique.push(item);
      });
      var index = 0;
      while (unique.length < 4) {
        unique.push(sentences[index % sentences.length] || DEMO_PASSAGE);
        index += 1;
        if (index > 8) break;
      }
      return unique;
    }

    function localSource(passage, hasImage) {
      var text = analysisPassage(passage);
      if (text.length >= 40) return { text: text, fromImage: false };
      return { text: DEMO_PASSAGE, fromImage: Boolean(hasImage) };
    }

    function splitSentences(text) {
      var parts = segmentSentences(text);
      return parts.length ? parts : [String(text || "").trim() || DEMO_PASSAGE];
    }

    function contentWords(text) {
      var words = String(text || "").match(/\b[A-Za-z][A-Za-z'-]{3,}\b/g) || [];
      var skip = { that: 1, this: 1, with: 1, from: 1, have: 1, were: 1, been: 1, they: 1, their: 1, which: 1, when: 1, where: 1, what: 1, into: 1, about: 1, after: 1, before: 1, there: 1, these: 1, those: 1, would: 1, could: 1, should: 1, only: 1 };
      var unique = [];
      words.forEach(function (word) {
        var key = word.toLowerCase();
        if (skip[key]) return;
        if (unique.some(function (item) { return item.toLowerCase() === key; })) return;
        unique.push(word);
      });
      ["attention", "meaning", "reader", "detail", "passage"].forEach(function (word) {
        if (unique.length >= 8) return;
        if (!unique.some(function (item) { return item.toLowerCase() === word; })) unique.push(word);
      });
      return unique;
    }

    function rotate(list, count) {
      var shift = list.length ? count % list.length : 0;
      return list.slice(shift).concat(list.slice(0, shift));
    }

    function sentenceWith(word, sentences) {
      var found = sentences.filter(function (sentence) {
        return new RegExp("\\b" + String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(sentence);
      })[0];
      return found || sentences[0] || "";
    }

    function setTaskProgress(done, total) {
      var bar = document.getElementById("task-progress-bar");
      if (bar) bar.style.width = (total ? Math.round((done / total) * 100) : 0) + "%";
      if (els.resultMeta && total) {
        els.resultMeta.textContent = "문장을 나누고 있습니다… " + done + "/" + total;
      }
    }

    async function buildMockAsync(task, passage, hasImage) {
      await yieldToUi();
      if (task !== "translate") return buildMock(task, passage, hasImage);
      console.warn("API 문장 쌍이 없어 브라우저 직독직해를 표시합니다");
      var source = localSource(passage, hasImage);
      var sentences = splitSentences(source.text);
      var rows = [];
      var index = 0;
      while (index < sentences.length) {
        rows.push(localSentenceRow(sentences[index]));
        index += 1;
        setTaskProgress(index, sentences.length);
        await yieldToUi();
      }
      return {
        demo: true,
        engine: "local",
        transcript: source.fromImage ? source.text : "",
        sentences: rows
      };
    }

    function buildMock(task, passage, hasImage) {
      var source = localSource(passage, hasImage);
      var sentences = splitSentences(source.text);
      var words = contentWords(source.text);
      var transcript = source.fromImage ? source.text : "";
      var demo = true;
      if (task === "summary") {
        var picked = sentences.slice(0, 3);
        return {
          demo: demo,
          transcript: transcript,
          title: glossWord(words[0] || "passage"),
          gist: freeSentence(sentences[0]),
          summary: picked.map(freeSentence).join(" "),
          points: picked.map(function (sentence) {
            return { en: sentence, ko: freeSentence(sentence) };
          }),
          main_idea_en: sentences[0]
        };
      }
      if (task === "annotate") {
        var seen = {};
        var structures = [];
        sentences.forEach(function (sentence) {
          var info = structureOf(sentence);
          if (seen[info.label] || structures.length >= 3) return;
          seen[info.label] = true;
          structures.push({
            excerpt: sentence,
            label: info.label,
            explanation: info.explanation,
            paraphrase: freeSentence(sentence)
          });
        });
        if (!structures.length) {
          structures.push({
            excerpt: sentences[0],
            label: "본동사와 수식",
            explanation: "수식어를 접고 주어 다음의 동사를 먼저 잡습니다.",
            paraphrase: freeSentence(sentences[0])
          });
        }
        return {
          demo: demo,
          transcript: transcript,
          structures: structures,
          vocabulary: words.slice(0, 6).map(function (word) {
            var gloss = glossWord(word);
            return {
              word: word,
              pos: guessPos(word),
              meaning: gloss === word ? "이 지문에서 내용을 실어 나르는 말" : gloss,
              context: sentenceWith(word, sentences)
            };
          })
        };
      }
      if (task === "transform") {
        function makeBlank(sentence, shift) {
          var local = contentWords(sentence);
          var known = local.filter(function (word) { return glossWord(word) !== word; });
          var answerWord = known[0] || local[0] || words[0] || "attention";
          var options = [];
          local.concat(words).forEach(function (word) {
            if (!word) return;
            if (options.some(function (item) { return item.toLowerCase() === word.toLowerCase(); })) return;
            options.push(word);
          });
          ["context", "detail", "reader", "passage", "meaning"].forEach(function (word) {
            if (options.length >= 5) return;
            if (!options.some(function (item) { return item.toLowerCase() === word; })) options.push(word);
          });
          options = rotate(options.slice(0, 5), shift);
          if (!options.some(function (item) { return item.toLowerCase() === answerWord.toLowerCase(); })) options[0] = answerWord;
          var answer = options.findIndex(function (item) { return item.toLowerCase() === answerWord.toLowerCase(); }) + 1;
          var pattern = new RegExp("\\b" + answerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
          var cloze = sentence.replace(pattern, "________");
          return { cloze: cloze, options: options.slice(0, 5), answer: answer, answerWord: answerWord };
        }
        var firstBlank = makeBlank(sentences[0], 2);
        var secondBlank = makeBlank(sentences[1] || sentences[0], 1);
        var chunks = flowChunks(sentences);
        return {
          demo: demo,
          transcript: transcript,
          blanks: [firstBlank, secondBlank].map(function (blank) {
            var gloss = glossWord(blank.answerWord);
            var meaning = gloss === blank.answerWord ? blank.answerWord : blank.answerWord + " (" + gloss + ")";
            return {
              instruction: "빈칸에 들어갈 말로 가장 적절한 것을 고르시오.",
              passage: blank.cloze,
              options: blank.options,
              answer: blank.answer,
              explanation: "빈칸의 원래 말은 " + meaning + " 입니다. 앞뒤 수식과 이어지려면 이 말이 필요합니다."
            };
          }),
          ordering: [
            {
              instruction: "주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오.",
              intro: chunks[0],
              sentences: [
                { label: "A", text: chunks[1] },
                { label: "B", text: chunks[2] },
                { label: "C", text: chunks[3] }
              ],
              options: ["(A)-(B)-(C)", "(A)-(C)-(B)", "(B)-(A)-(C)", "(B)-(C)-(A)", "(C)-(A)-(B)"],
              answer: 1,
              explanation: "주어진 글 다음에 원문의 다음 흐름이 A, B, C 순서로 이어집니다."
            }
          ]
        };
      }
      return {
        demo: demo,
        engine: "local",
        transcript: transcript,
        sentences: segmentSentences(source.text).map(localSentenceRow)
      };
    }

    function showParsed(task, data, meta) {
      if (data && typeof data.error === "string" && data.error.trim() && !data.demo) {
        setHeading(task);
        renderError(data.error.trim(), transcriptHtml(data));
        els.resultTitle.focus();
        return;
      }
      var banner = data && data.engine === "local"
        ? '<p class="note">이 브라우저가 문장 경계와 전치사 경계로 지문을 나누어 직독직해를 만들었습니다.</p>'
        : data && data.demo
        ? '<p class="note">시뮬레이션 모드입니다. 입력한 지문(사진만 있으면 예시 지문)으로 이 브라우저가 해석, 요약, 해설, 변형 문제를 만들었습니다. API가 연결되면 같은 칸이 모델 결과로 바뀝니다.</p>'
        : "";
      els.resultBody.dataset.state = "ready";
      els.resultBody.classList.remove("is-revealed");
      els.resultBody.innerHTML = banner + transcriptHtml(data) + RENDERERS[task](data);
      void els.resultBody.offsetWidth;
      els.resultBody.classList.add("is-revealed");
      els.resultMeta.textContent = meta;
      showResultActions(true);
      els.resultTitle.focus();
      if (window.matchMedia("(max-width: 1023px)").matches) {
        els.resultTitle.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function expandSlashed(list) {
      var out = [];
      asArray(list).forEach(function (part) {
        String(part || "").replace(/\/\/+/g, " ").split(/\s+\/\s+/).forEach(function (bit) {
          var clean = bit.replace(/\s+/g, " ").trim();
          if (clean) out.push(clean);
        });
      });
      return out;
    }

    function passageWords(text) {
      var found = String(text || "").match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g) || [];
      return found.map(function (word) { return word.toLowerCase(); });
    }

    function pairedChunks(original, chunks, literals) {
      if (!chunks.length || chunks.length !== literals.length) return false;
      if (!literals.every(function (part) { return /[가-힣]/.test(part); })) return false;
      var source = passageWords(original);
      var covered = passageWords(chunks.join(" "));
      if (source.length !== covered.length) return false;
      for (var i = 0; i < source.length; i += 1) {
        if (source[i] !== covered[i]) return false;
      }
      return true;
    }

    function localSentenceRow(sentence) {
      var chunks = chunkParts(sentence);
      return {
        original: sentence,
        chunks: chunks,
        literal_chunks: sentenceMappedChunks(sentence, chunks)
      };
    }

    function normalizeTranslatePayload(data) {
      var source = asArray(data && data.sentences);
      if (!source.length && data && (data.engChunks || data.korChunks)) source = [data];
      var sentences = source.map(function (item) {
        if (!item || typeof item !== "object") return null;
        var modelEng = asArray(item.engChunks).map(chunkKey).filter(Boolean);
        if (!modelEng.length) modelEng = asArray(item.chunks).map(chunkKey).filter(Boolean);
        var modelKor = asArray(item.korChunks).map(function (part) { return String(part || "").trim(); });
        if (!modelKor.length) modelKor = asArray(item.literal_chunks).map(function (part) { return String(part || "").trim(); });
        var original = String(item.original || "").replace(/\s*\/\/+\s*/g, " ").replace(/\s+\/\s+/g, " ").replace(/\s+/g, " ").trim();
        if (!original) original = modelEng.join(" ");
        if (!original) return null;
        var engChunks = chunkParts(original);
        var korChunks = realignKorChunks(engChunks, modelEng, modelKor);
        console.log("API engChunks", modelEng);
        console.log("API korChunks", modelKor);
        console.log("동기화 engChunks", engChunks);
        console.log("동기화 korChunks", korChunks);
        if (engChunks.length !== korChunks.length) {
          console.warn("청크 길이 불일치", "engChunks", engChunks.length, "korChunks", korChunks.length);
          korChunks = korChunks.slice(0, engChunks.length);
          while (korChunks.length < engChunks.length) korChunks.push("");
        }
        return {
          original: original,
          engChunks: engChunks,
          korChunks: korChunks,
          chunks: engChunks,
          literal_chunks: korChunks
        };
      }).filter(Boolean);
      return {
        transcript: String(data && data.transcript || ""),
        sentences: sentences,
        demo: false
      };
    }

    async function runTask(task) {
      if (abortController) return;
      var info = TASKS[task];
      if (!info) return;
      selectedTask = task;
      markSelected();
      var passage = analysisPassage(els.passage.value);
      var useText = passage.length >= 40;
      if (!useText && !imageFile) {
        setHeading(task);
        setBusy(task, false);
        renderError(passage
          ? "지문이 너무 짧습니다. 해석할 문장이 있는 한 문단을 넣어 주세요."
          : "영어 지문을 붙여 넣거나, 지문이 보이는 사진을 올려 주세요.");
        return;
      }
      var settings = await resolveGeminiSettings(task);
      if (!settings) {
        setHeading(task);
        setBusy(task, true);
        renderLoading(task);
        try {
          var localMock = await buildMockAsync(task, passage, Boolean(imageFile));
          showParsed(task, localMock, task === "translate" ? "브라우저 직독직해" : "시뮬레이션 · 저장된 API 키 없음");
        } finally {
          setBusy(task, false);
        }
        return;
      }

      abortController = new AbortController();
      requestKind = "task";
      var timedOut = false;
      var timer = window.setTimeout(function () {
        timedOut = true;
        abortController.abort();
      }, 120000);
      setBusy(task, true);
      renderLoading(task);

      try {
        var schema = task === "translate" ? TRANSLATE_SCHEMA : null;
        var prompt = buildUserPrompt(info.instruction, useText ? passage : "", !useText && Boolean(imageFile));
        if (task === "translate" && useText) {
          console.log("API 전송 문장", segmentSentences(passage).map(slashSentence));
        }
        var system = task === "translate" ? TRANSLATE_SYSTEM_PROMPT : SYSTEM_PROMPT;
        var image = useText ? null : imageFile;
        var temperature = task === "transform" ? 0.6 : 0.2;
        var result;
        if (settings.fromEnv) {
          result = await askGeminiFromEnv(system, prompt, image, temperature, abortController.signal, schema);
        } else if (settings.provider === "gemini") {
          result = await askGemini(settings, system, prompt, image, temperature, abortController.signal, schema);
        } else {
          result = await askModel(settings, system, prompt, image, temperature, abortController.signal);
        }
        var parsed;
        try {
          parsed = parseModelJson(result.text);
        } catch (error) {
          setHeading(task);
          showParsed(task, await buildMockAsync(task, passage, Boolean(imageFile)), "시뮬레이션 · 모델 응답을 읽지 못해 예시로 표시");
          return;
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setHeading(task);
          showParsed(task, await buildMockAsync(task, passage, Boolean(imageFile)), "시뮬레이션 · 모델 응답을 읽지 못해 예시로 표시");
          return;
        }
        if (task === "translate") {
          parsed = normalizeTranslatePayload(parsed);
          if (!parsed.sentences.length) {
            setHeading(task);
            showParsed(task, await buildMockAsync(task, passage, Boolean(imageFile)), "시뮬레이션 · 모델 응답을 읽지 못해 예시로 표시");
            return;
          }
        }
        var tokenNote = result.tokens ? " · " + Number(result.tokens).toLocaleString("ko-KR") + " tokens" : "";
        var metaName = settings.fromEnv ? "Gemini " + settings.model : settings.model;
        showParsed(task, parsed, metaName + tokenNote);
      } catch (error) {
        setHeading(task);
        if (error.name === "AbortError" && !timedOut) {
          renderError("분석을 취소했습니다.");
        } else if (canSimulate(error)) {
          showParsed(task, await buildMockAsync(task, passage, Boolean(imageFile)), "시뮬레이션 · " + simulationReason(error, timedOut));
        } else {
          renderError(error.message || "분석을 끝내지 못했습니다.");
        }
      } finally {
        window.clearTimeout(timer);
        abortController = null;
        requestKind = null;
        setBusy(task, false);
      }
    }

    async function testConnection() {
      els.formError.textContent = "";
      els.testStatus.textContent = "";
      if (abortController) {
        els.formError.textContent = "다른 요청이 끝난 뒤 연결을 시험해 주세요.";
        return;
      }
      var settings;
      try {
        settings = collectSettings();
      } catch (error) {
        els.formError.textContent = error.message;
        return;
      }
      persistSettings(settings);
      abortController = new AbortController();
      requestKind = "test";
      els.testConnection.disabled = true;
      els.testConnection.textContent = "확인 중…";
      try {
        var result = await askModel(
          settings,
          '연결 테스트입니다. 다른 말 없이 {"ok":true,"service":"folio"} JSON만 답하세요.',
          "ping",
          null,
          0,
          abortController.signal
        );
        parseModelJson(result.text);
        els.testStatus.textContent = "연결되었습니다. " + settings.model + " 모델이 응답했습니다.";
      } catch (error) {
        if (error.name === "AbortError") {
          els.formError.textContent = "연결 테스트를 취소했습니다.";
        } else {
          els.formError.textContent = error.message || "연결에 실패했습니다.";
        }
      } finally {
        abortController = null;
        requestKind = null;
        els.testConnection.disabled = false;
        els.testConnection.textContent = "연결 테스트";
      }
    }

    function bind() {
      els.passage.addEventListener("input", scheduleSourceNote);
      els.loadSample.addEventListener("click", function () {
        if (els.passage.value.trim() && !window.confirm("지금 입력한 지문을 예시 지문으로 바꿀까요?")) return;
        els.passage.value = SAMPLE_PASSAGE;
        clearImage();
        updateSourceNote();
        els.passage.focus();
      });
      els.clearPassage.addEventListener("click", function () {
        els.passage.value = "";
        updateSourceNote();
      });
      els.file.addEventListener("change", function () {
        acceptImage(els.file.files && els.file.files[0]);
      });
      els.camera.addEventListener("change", function () {
        acceptImage(els.camera.files && els.camera.files[0]).then(function () {
          if (imageFile) setSourceMode("file");
        });
      });
      els.showFile.addEventListener("click", function () { setSourceMode("file"); });
      els.showLive.addEventListener("click", function () { setSourceMode("live"); });
      els.startCamera.addEventListener("click", startCamera);
      els.stopCamera.addEventListener("click", stopCamera);
      els.flipCamera.addEventListener("click", function () {
        facingMode = facingMode === "environment" ? "user" : "environment";
        startCamera();
      });
      els.capturePhoto.addEventListener("click", capturePhoto);
      window.addEventListener("pagehide", stopCamera);
      els.dropzone.addEventListener("click", function (event) {
        if (event.target.closest("button, label, input, a")) return;
        els.file.click();
      });
      ["dragenter", "dragover"].forEach(function (name) {
        els.dropzone.addEventListener(name, function (event) {
          event.preventDefault();
          els.dropzone.dataset.hot = "true";
        });
      });
      ["dragleave", "drop"].forEach(function (name) {
        els.dropzone.addEventListener(name, function (event) {
          event.preventDefault();
          els.dropzone.dataset.hot = "false";
        });
      });
      els.dropzone.addEventListener("drop", function (event) {
        acceptImage(event.dataTransfer.files && event.dataTransfer.files[0]);
      });
      els.removeImage.addEventListener("click", clearImage);
      els.taskGrid.addEventListener("click", function (event) {
        var button = event.target.closest("[data-task]");
        if (!button || button.disabled) return;
        selectedTask = button.dataset.task;
        markSelected();
      });
      els.submit.addEventListener("click", function () {
        if (!isSubmitted) {
          revealWorkspace();
          return;
        }
        runTask(selectedTask);
      });
      els.resultBody.addEventListener("click", function (event) {
        var button = event.target.closest("[data-reveal]");
        if (!button) return;
        var card = button.closest("[data-question]");
        var panel = card.querySelector("[data-answer]");
        var opening = panel.classList.contains("hidden");
        panel.classList.toggle("hidden");
        button.textContent = opening ? "정답 숨기기" : "정답과 해설 보기";
        card.querySelectorAll("[data-option]").forEach(function (option) {
          var marked = opening && option.dataset.option === panel.dataset.answer;
          option.classList.toggle("is-correct", marked);
        });
      });
      els.copyResult.addEventListener("click", async function () {
        var text = els.resultBody.innerText.trim();
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
        } catch (error) {
          var area = document.createElement("textarea");
          area.value = text;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        els.copyResult.textContent = "복사됨";
        window.setTimeout(function () { els.copyResult.textContent = "결과 복사"; }, 1400);
      });
      els.clearResult.addEventListener("click", renderEmpty);
      els.closeSettings.addEventListener("click", function () { els.dialog.close(); });
      els.dialog.addEventListener("click", function (event) {
        if (event.target === els.dialog) els.dialog.close();
      });
      els.dialog.addEventListener("close", function () {
        if (requestKind === "test" && abortController) abortController.abort();
      });
      els.form.addEventListener("submit", function (event) {
        event.preventDefault();
        els.formError.textContent = "";
        try {
          persistSettings(collectSettings());
          els.dialog.close();
        } catch (error) {
          els.formError.textContent = error.message;
        }
      });
      document.querySelectorAll('input[name="provider"]').forEach(function (input) {
        input.addEventListener("change", function () {
          if (!input.checked) return;
          applyProviderUI(input.value, defaultModel(input.value));
        });
      });
      els.modelPreset.addEventListener("change", function () {
        els.customModelWrap.classList.toggle("hidden", els.modelPreset.value !== "custom");
        if (els.modelPreset.value === "custom") els.customModel.focus();
      });
      els.toggleKey.addEventListener("click", function () {
        var showing = els.apiKey.type === "text";
        els.apiKey.type = showing ? "password" : "text";
        els.toggleKey.textContent = showing ? "보기" : "숨기기";
      });
      els.testConnection.addEventListener("click", testConnection);
      els.clearKey.addEventListener("click", function () {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
        els.apiKey.value = "";
        updateKeyChip(null);
        els.testStatus.textContent = "";
        els.formError.textContent = "이 브라우저에 저장된 키를 지웠습니다.";
      });
      els.showLogin.addEventListener("click", function () { setAuthMode("login"); });
      els.showSignup.addEventListener("click", function () { setAuthMode("signup"); });
      els.authForm.addEventListener("submit", submitAuth);
      els.logout.addEventListener("click", logout);
      els.adminMark.addEventListener("click", noteAdminClick);
      document.addEventListener("keydown", function (event) {
        if (event.repeat) return;
        if (event.key.toLowerCase() !== "k" || !event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        if (els.dialog.open) els.dialog.close();
        else openSettings();
      });
    }

    function readUsers() {
      try {
        var parsed = JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function writeUsers(users) {
      localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function readSession() {
      try {
        var parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
        if (!parsed || !parsed.email) return null;
        return parsed;
      } catch (error) {
        return null;
      }
    }

    function validEmail(value) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
    }

    function setAuthMessage(text, kind) {
      els.authMessage.textContent = text || "";
      els.authMessage.classList.toggle("is-error", kind === "error");
      els.authMessage.classList.toggle("is-ok", kind !== "error" && Boolean(text));
    }

    function setAuthMode(mode) {
      authMode = mode === "signup" ? "signup" : "login";
      var signup = authMode === "signup";
      els.showLogin.dataset.active = signup ? "false" : "true";
      els.showSignup.dataset.active = signup ? "true" : "false";
      els.showLogin.setAttribute("aria-selected", signup ? "false" : "true");
      els.showSignup.setAttribute("aria-selected", signup ? "true" : "false");
      els.authSubmit.textContent = signup ? "회원가입" : "로그인";
      els.authLead.textContent = signup
        ? "이 브라우저에만 남는 시연용 계정을 만듭니다."
        : "영어 지문 분석실에 들어가려면 로그인하세요.";
      els.authPassword.autocomplete = signup ? "new-password" : "current-password";
      setAuthMessage("");
    }

    function showView(loggedIn) {
      els.authScreen.classList.toggle("hidden", loggedIn);
      els.appScreen.classList.toggle("hidden", !loggedIn);
      if (!loggedIn) return;
      var session = readSession();
      els.sessionEmail.textContent = session ? session.email : "";
      warmOcrWorker();
    }

    function submitAuth(event) {
      event.preventDefault();
      var email = els.authEmail.value.trim().toLowerCase();
      var password = els.authPassword.value;
      if (!validEmail(email)) {
        setAuthMessage("이메일 형식을 확인해 주세요.", "error");
        return;
      }
      if (password.length < 6) {
        setAuthMessage("비밀번호는 6자 이상으로 입력해 주세요.", "error");
        return;
      }
      var users = readUsers();
      var found = null;
      users.forEach(function (user) {
        if (user.email === email) found = user;
      });
      if (authMode === "signup") {
        if (found) {
          setAuthMessage("이미 가입된 이메일입니다. 로그인해 주세요.", "error");
          return;
        }
        users.push({ email: email, password: password });
        writeUsers(users);
        els.authPassword.value = "";
        setAuthMode("login");
        setAuthMessage("가입되었습니다. 같은 이메일로 로그인해 주세요.", "ok");
        return;
      }
      if (!found || found.password !== password) {
        setAuthMessage("이메일 또는 비밀번호가 맞지 않습니다.", "error");
        return;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: email }));
      els.authPassword.value = "";
      setAuthMessage("");
      showView(true);
    }

    function logout() {
      stopCamera();
      sessionStorage.removeItem(SESSION_KEY);
      resetWorkspace();
      renderEmpty();
      showView(false);
      setAuthMode("login");
      els.authPassword.value = "";
    }

    function noteAdminClick() {
      var now = Date.now();
      adminClicks = adminClicks.filter(function (time) { return now - time < 4000; });
      adminClicks.push(now);
      if (adminClicks.length < 5) return;
      adminClicks = [];
      openSettings();
    }

    bind();
    refreshEnvGemini().then(function () {
      updateKeyChip(loadSettings());
    });
    fillSettingsForm();
    updateSourceNote();
    renderEmpty();
    resetWorkspace();
    setAuthMode("login");
    showView(Boolean(readSession()));
