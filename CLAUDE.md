# CodeMix Scribe Full-Stack — project brief for Claude Code

CodeMix Scribe is a multilingual **live speech-to-text** app for English, Tamil, Hindi and
code-switched speech (e.g. "Doctor, எனக்கு two weeks-ஆ cough இருக்கு"). It must
**transcribe, never translate**: Tamil stays in Tamil script, English words stay in
Latin script.

Goal: a working end-to-end demo to record **one video**. The app does not need to stay
online afterwards. Build it from scratch in this folder.

## The user is a beginner
First time using Claude Code and first full-stack project. Work in small steps. Before
each step, say in plain words what it does and why. Give exact Windows commands to copy,
say which terminal to run them in, and say what output to expect. Stop after each step and
check it worked before moving on. Explain any error simply.

Gemma: the LoRA adapter is not a full model. The Kaggle notebook downloads the base
model from Hugging Face automatically and attaches the adapter on top. Nothing Gemma-related
is loaded on the laptop. The user's Kaggle account uses a different Gmail from this
machine's; that's fine, since Kaggle is used only in the browser. The adapter is uploaded
as a Kaggle Dataset in the same Kaggle account that runs the notebook.

## Hard rules
- **Do not reuse the old Whisper code** (the old `*_core.py`, `streamlit_ui.py`, `main.py`,
  `Transcriptor_check*.py` in the old project). Write the ASR service fresh.
- No Streamlit, no Qwen, no IndicTrans2.
- **Never load Gemma on the laptop.** It runs on a free Kaggle GPU behind an HTTP API.
- Don't claim accuracy improvements unless they were measured on the test audio.
- Keep it minimal: one test script for ASR, not many.

## Machine
- Windows 11, NVIDIA **RTX 3050 6 GB**, Python via miniconda.
- The user has **no Java code yet**. Check for `java -version` (need 17+), `mvn`/Maven
  wrapper, `node`, and PostgreSQL. If any are missing, give exact Windows install steps
  (winget commands) before continuing. A `~/.m2` folder exists, so Maven may be installed.

## Existing assets (read-only, in the old project)
Old project: the folder in `OLD_PROJECT_DIR` (ai-service/.env, not in git)
- Test audio: `audio\Audio 1.mpeg`, `audio\Audio 2.mpeg`, `audio\Audio  3.mpeg`
  (two spaces), `audio\Audio 4.mpeg` — four code-switched recordings.
- **Gemma LoRA adapter:** `models\gemma4-codemix-final\` (adapter_model.safetensors
  ~147 MB, adapter_config.json, tokenizer files, chat_template.jinja).
  - Base model per adapter_config: `unsloth/gemma-4-e4b-it-unsloth-bnb-4bit`
    (class `Gemma4ForConditionalGeneration`), LoRA r=16, alpha=32.
  - The user uploads this folder as a **Kaggle Dataset**.
- Prompt format the adapter was trained/used with (keep it identical):
  ```
  <start_of_turn>user
  Fix ASR errors. Preserve code-mixed script (keep English words in Latin script, native language words in their own script).
  {chunk_text}<end_of_turn>
  <start_of_turn>model
  ```
  Chunk input into ~55-word pieces, max_new_tokens=200, temperature=0.3, stop on
  `<end_of_turn>`, join chunks with spaces. (Reference: old `gemma_corrector.py`.)

## Architecture
```
React (Vite)  ── mic audio over WebSocket (16 kHz mono PCM16) ──►  ai-service (FastAPI, laptop GPU)
     │                                                              • faster-whisper large-v3-turbo
     │ REST (JWT)                                                   • live partials ~1–2 s
     ▼                                                              • on stop → Gemma API → final
Spring Boot  ◄── POST finished transcript (raw + corrected) ───────┘
     │                                                       Gemma API (Kaggle notebook,
     ▼                                                       exposed via cloudflared tunnel)
PostgreSQL (users, transcriptions)
```
Live audio goes **straight from React to Python**. Don't relay audio through Spring Boot.
Uploaded files go React → Spring Boot → Python `/transcribe`.

## Folder layout to create
```
CodeMixScribe/
├── CLAUDE.md
├── README.md                 # demo run-book: start order, URLs, troubleshooting
├── ai-service/               # Python 3.11, FastAPI, faster-whisper
├── kaggle/codemix_scribe_gemma_server.ipynb
├── backend/                  # Spring Boot 3, Java 17, Maven wrapper
└── frontend/                 # React + Vite + TypeScript
```

## 1. ai-service (Python)
- `faster-whisper` model **`large-v3-turbo`**, `device="cuda"`, `compute_type="int8_float16"`
  (fallback `int8`). Download it once into `ai-service/models/` (it's ~1.6 GB) — fresh, don't copy old models.
- Windows CUDA: if cuBLAS/cuDNN DLLs are missing, use the `nvidia-cublas-cu12` and
  `nvidia-cudnn-cu12` pip packages and add their `bin` dirs with `os.add_dll_directory`.
- **First, `scripts/test_asr.py`**: transcribe the 4 test files directly (no VAD tricks
  beyond `vad_filter=True`) with `language=None` and also with `language="ta"`; save
  outputs to `ai-service/test_outputs/` and show them to the user. Pick the setting that
  keeps Tamil script + English words. Also try `initial_prompt` with a short
  Tamil-English mixed sample sentence; it often helps code-switching.
- Endpoints:
  - `GET /health` → model loaded, GPU name, Gemma reachability.
  - `POST /transcribe` (multipart audio; decode any format with PyAV/ffmpeg) → `{raw, corrected, language, duration, correctionStatus}`.
  - `WS /ws/live?token=…`: client sends binary PCM16 16 kHz frames; server keeps a
    rolling buffer, runs Silero VAD (built into faster-whisper), re-transcribes the
    current unfinished segment every ~1 s and emits `{"type":"partial","text":…}`;
    committed text is finalized via LocalAgreement (two consecutive passes agree) →
    `{"type":"final_segment","text":…}`. Client sends `{"type":"stop"}` → server
    emits `{"type":"raw_complete"}`, calls Gemma, emits `{"type":"corrected","text":…}`,
    then POSTs the record to Spring Boot.
  - `GET/PUT /config/gemma-url`: the Kaggle tunnel URL changes each session; store it
    at runtime (also readable from `.env` `GEMMA_URL`).
- Gemma client: `httpx`, 120 s timeout, 1 retry. If Gemma is unreachable, return the raw
  text with `correctionStatus="UNAVAILABLE"`. Never crash.
- Config via `.env` (`GEMMA_URL`, `BACKEND_URL`, `SERVICE_SECRET` shared with Spring Boot).

## 2. Kaggle notebook (`kaggle/codemix_scribe_gemma_server.ipynb`)
- GPU T4 x1 (or P100), Internet ON, adapter attached as a Kaggle Dataset.
- Install unsloth (Kaggle-compatible), load base `unsloth/gemma-4-e4b-it` in 4-bit with
  `FastLanguageModel`, attach adapter with `PeftModel.from_pretrained`, `for_inference`.
- FastAPI app: `POST /correct {text}` → `{corrected}` using the exact prompt/chunking
  above; `GET /health`. Run with uvicorn in a background thread.
- Expose with **cloudflared quick tunnel** (`cloudflared tunnel --url http://localhost:8000`),
  print the `https://*.trycloudflare.com` URL clearly. Optional simple bearer token.
- Include a test cell that corrects a sample code-mixed sentence.

## 3. backend (Spring Boot)
- Spring Boot 3.x, Java 17, Maven wrapper: Web, Security, Data JPA, Validation, PostgreSQL, Flyway, jjwt.
- Entities: `User(id, email, passwordHash, name, createdAt)`,
  `Transcription(id, user, title, rawText, correctedText, language, durationSec,
  source[LIVE|UPLOAD], correctionStatus, createdAt)`.
- REST: `POST /api/auth/register`, `POST /api/auth/login` (JWT),
  `POST /api/transcriptions/upload` (forwards file to ai-service `/transcribe`, saves),
  `GET /api/transcriptions`, `GET /api/transcriptions/{id}`, `DELETE /api/transcriptions/{id}`,
  `POST /api/internal/transcriptions` (from ai-service, guarded by `X-Service-Secret` header;
  carries the user id from the validated JWT the client gave the WS).
- The ai-service validates the WS JWT with the same `JWT_SECRET` (HS256).
- CORS for `http://localhost:5173`. Upload limit 100 MB.
- `application.yml` with env overrides; DB `scribe` / user `scribe`.

## 4. frontend (React)
- Vite + React + TypeScript + Tailwind, React Router.
- Pages: Login/Register, **Live** (big record button, waveform/level meter, partial text
  in grey, final text in black, "Correcting with Gemma…" state, then raw vs corrected
  side by side), **Upload** (drag-drop audio → result), **History** (list + detail,
  copy, download .txt, delete), **Settings** (paste Gemma URL → PUT to ai-service, health badge).
- Mic capture: `AudioWorklet` → downsample to 16 kHz mono Int16 → send ~100 ms frames on the WS.
- Use a font that renders Tamil/Devanagari well (Noto Sans + Noto Sans Tamil).

## Build order
1. Check the tools on the machine → install steps if needed.
2. ai-service + `test_asr.py` on the 4 audio files → show results, tune.
3. Kaggle notebook → user runs it → test `/correct` from the laptop.
4. Live WebSocket in ai-service; test with a tiny HTML page or the frontend.
5. Spring Boot + Postgres.
6. React frontend.
7. README run-book + end-to-end demo check (live record → partials → corrected → history).

## Ports
ai-service 8001 · backend 8080 · frontend 5173 · Postgres 5432 · Kaggle API 8000 (tunneled)
