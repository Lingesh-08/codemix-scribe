# CodeMix Scribe — live multilingual speech-to-text (demo run-book)

CodeMix Scribe transcribes doctor–patient conversations in English, Tamil, Hindi and code-switched speech
live from the microphone ("Doctor, எனக்கு two weeks-ஆ cough இருக்கு"). It **transcribes, never
translates**: Tamil stays in Tamil script, Hindi in Devanagari, English in Latin letters.

When you stop recording:
1. a **fine-tuned Gemma model** (free Kaggle GPU) fixes speech-recognition errors, and the app
   highlights every word it changed;
2. **clinical coding** picks out symptoms, vitals, tests, procedures and diagnoses and codes them in
   **SNOMED CT**, **LOINC** and **ICD-10**;
3. everything is saved to the user's **History**.

```
Browser (React, :5173) ──mic audio over WebSocket──► ai-service (FastAPI + Whisper, :8001, laptop GPU)
      │ REST + JWT                                        │  on Stop ─► Gemma (Kaggle notebook, cloudflared URL)
      ▼                                                   │  coding  ─► Gemini API (terms) + Ontoserver (SNOMED/LOINC)
Spring Boot (:8080) ◄─── saves transcript + codes ────────┘            + local SNOMED→ICD-10 map file (never uploaded)
      │
PostgreSQL: Supabase (cloud)  or  local Docker (:5432)
```

| Folder | What it is |
|---|---|
| `ai-service/` | Python 3.11, FastAPI, faster-whisper `large-v3-turbo` on the RTX 3050, clinical coding |
| `kaggle/codemix_scribe_gemma_server.ipynb` | Gemma 4 + CodeMix Scribe LoRA adapter served on Kaggle, exposed with cloudflared |
| `backend/` | Spring Boot 3.5 / Java 17: users, JWT login, transcription history, saved codes |
| `frontend/` | React + Vite + TypeScript + Tailwind |
| `docker-compose.yml` | Local PostgreSQL 16 (alternative to Supabase) |
| `backend/run-supabase.ps1` | Starts the backend on the Supabase cloud database (reads `backend/supabase.env`) |

All commands below are for **PowerShell** (Start menu → "Windows PowerShell"). Each one starts by
going to the right folder, so you can paste it as-is.

---

## Part 1: Demo day

Everything in Part 2 (one-time setup) is already done on this laptop. On demo day you only need this part.

### 1.1 Pre-flight checklist (5 minutes before)

- [ ] Laptop **plugged in**, other GPU-heavy apps closed (games, video editors, other AI tools).
- [ ] Internet connection (Supabase, Kaggle and Gemini are online). Docker Desktop is only needed if you use the local database instead of Supabase.
- [ ] Kaggle GPU quota left for at least one hour (Kaggle shows the remaining weekly GPU hours when you pick the accelerator).
- [ ] Microphone works (Windows sound settings → input level moves when you speak).
- [ ] Screen recorder ready. Close anything that shows **`ai-service\.env`** (it contains your Gemini key)
      or the **SNOMED CT folder** (`C:\Users\linge\Documents\MedASR\...`). Neither may appear in the video.
- [ ] Test audio at hand if you play recordings instead of speaking:
      `Audio 1.mpeg` (Hindi) and `Audio 4.mpeg` (Tamil) in your test-audio folder (`TEST_AUDIO_DIR` in `ai-service\.env`).

### 1.2 Start everything (in this order)

You need **3 PowerShell windows** plus the Kaggle tab in the browser. Total time: about 10 minutes,
most of it waiting for Kaggle.

#### Step 1: Kaggle notebook (browser, 5–8 minutes)

1. kaggle.com → *Code* → your **codemix_scribe_gemma_server** notebook → *Edit*.
2. Right panel: *Accelerator* **GPU T4 x2** (or T4 x1), *Internet* **On**, adapter dataset listed under *Input*.
3. *Run → Restart & clear outputs*, then **Run All**.
4. Wait for:
   - cell 5 (test) to print an `OUT:` line with a corrected sentence;
   - cell 7 to print:
     ```
     ======================================================================
     GEMMA URL: https://something-random.trycloudflare.com
     ======================================================================
     ```
5. **Copy that URL.** Cell 8 keeps running and prints `server ok` every 5 minutes. Leave the tab open
   until you have finished recording.

The URL is new every time the notebook starts.

#### Step 2 + 3: Database and backend (window 1)

The database is **Supabase** (cloud PostgreSQL), so there is nothing to start for it. The backend
connects to it with the details in `backend\supabase.env`:

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\backend; powershell -ExecutionPolicy Bypass -File .\run-supabase.ps1
```

Ready when it prints `Using database: jdbc:postgresql://aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`
and then `Started CodeMixScribeApplication in ... seconds` (about 10–15 s). Leave the window open.

<details><summary>Alternative: local Docker database instead of Supabase</summary>

Start Docker Desktop, then:

```powershell
cd C:\Users\linge\Documents\CodeMixScribe; docker compose up -d
```

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\backend; .\mvnw.cmd spring-boot:run
```

The two databases are separate: accounts made in one don't exist in the other.
</details>

#### Step 4: ai-service (window 2)

Put the new Gemma URL into `ai-service\.env` first, so it survives restarts. Open the file in
Notepad, change only the `GEMMA_URL=` line, save, and close Notepad again (the file has your Gemini key):

```powershell
notepad C:\Users\linge\Documents\CodeMixScribe\ai-service\.env
```

Then start the service:

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\ai-service; .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8001
```

Ready when you see all three lines (takes about 15–30 s):

```
INFO scribe.asr: Whisper loaded on cuda (NVIDIA GeForce RTX 3050 6GB Laptop GPU), compute_type=int8_float16
INFO scribe.clinical: ICD-10 map loaded from der2_iisssccRefset_ExtendedMapSnapshot_INT_20260701.txt (RF2 extended map · 112,464 concepts)
INFO:     Uvicorn running on http://127.0.0.1:8001 (Press CTRL+C to quit)
```

(You can skip the Notepad step and paste the URL in the app's **Settings** page instead. That works
until the ai-service restarts.)

#### Step 5: Frontend (window 3)

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\frontend; npm run dev
```

Open **http://localhost:5173** in Chrome or Edge.

### 1.3 Ready check (1 minute)

1. **Sign in**, or **Create an account**. For a clean History in the video, create a fresh account,
   e.g. name "Dr. Demo", any email such as `drdemo@scribe.test`, a password of 6+ characters.
2. Sidebar → **Services**: both **Whisper ASR** and **Gemma correction** show a **green** dot.
   - Gemma red? **Settings** → paste the Gemma URL → **Save & test** → "Saved. Gemma is reachable."
3. **Settings** → *System status*: Whisper `large-v3-turbo · loaded`, GPU `RTX 3050`, Gemma `Connected`.
4. **Warm-up recording** (not for the video): **Live** → **தமிழ் + English** → record 10 seconds → **Stop**.
   Wait until the **Clinical coding** card appears. This makes sure the microphone permission is
   granted and all services are awake, so the real take has no first-time delays.

### 1.4 Recording script for the video (about 4 minutes)

| # | Screen | What to do / say |
|---|---|---|
| 1 | **Login page** | Show the split screen: "Speech to text for the way India actually talks." Sign in. |
| 2 | **Sidebar** | Point at *Services*: Whisper runs on the laptop GPU, Gemma on Kaggle. Both green. |
| 3 | **Live → தமிழ் + English** | Choose the language, press the **mic button**, speak (or play `Audio 4.mpeg`) for 30–45 s. Show grey words (still listening) turning black (confirmed), the waveform, the timer, and the *Pipeline* panel on the right. |
| 4 | **Stop** | The pipeline moves to *Transcribe* → *Gemma correction*. Then the results appear: **"Gemma corrected N of M words"**; **green** = Gemma's fix, **red strikethrough** = what Whisper heard. Point at one or two fixes (e.g. "ரும்ப" → "ரொம்ப", "scientists" → "symptoms"). |
| 5 | **Clinical coding card** | Below the transcripts: symptoms, vitals, tests and diagnoses with **SNOMED CT / LOINC** codes and **ICD-10** (e.g. Fatigue 84229001 → R53, Excessive thirst 17173007 → R63.1). Show the "Heard as" column with the original Tamil words. Mention the footer: suggestions only, a clinician verifies. |
| 6 | **Live → हिन्दी + English** | Short take (play `Audio 1.mpeg` for about 30 s): Hindi comes out in **Devanagari**, English stays English. |
| 7 | **Upload** | Drop `Audio 1.mpeg` → *Transcribe* (about 20–30 s for this 94 s file) → raw vs corrected + clinical codes (Fever 386661006 → R50.9, Viral infection 34014006 → B34.9, Body temperature 8310-5 = 101.8 °F). |
| 8 | **History** | The recordings are saved: search, open one, codes are stored with it, **Copy**, **.txt** download. |
| 9 | **Settings** | System status tiles: model loaded, RTX 3050, Gemma connected. End. |

Tips:
- **Pick Tamil or Hindi, not Auto**, before each recording. With a fixed language every word is in the
  right script from the first second. Use one language mix per recording.
- Speaking directly into the microphone gives better results than playing audio through speakers.
- Each step after **Stop** takes a few seconds: Gemma about 3–10 s, clinical coding about 5–12 s.
- If Gemma is unreachable you still get the raw text (the card says so), and the recording is still saved.

### 1.5 Stop everything after recording

Press `Ctrl+C` in each of the 3 PowerShell windows, and stop the Kaggle notebook (■ button, or
*Run → Stop session*, so it doesn't use up GPU quota). Your accounts and recordings stay in Supabase.
(If you used the local database: `docker compose down` in the project folder.)

---

## Part 2: One-time setup (already done on this laptop)

### 2.1 Tools

| Tool | Status | If missing |
|---|---|---|
| Java 17+ | ✅ Temurin 21 | `winget install EclipseAdoptium.Temurin.21.JDK` |
| Maven | not needed | the project ships `mvnw.cmd`, which downloads Maven itself |
| Node.js | ✅ v24 | `winget install OpenJS.NodeJS.LTS` |
| Python 3.11 | ✅ `C:\Python311` | `winget install Python.Python.3.11` |
| ffmpeg | ✅ | `winget install Gyan.FFmpeg` |
| Docker Desktop | ✅ installed, must be **running** | `winget install Docker.DockerDesktop` |

### 2.2 Database: Supabase (used for the demo)

1. supabase.com → *New project* → name `scribe`, generate and save a database password, Free plan.
2. *Connect* → **Session pooler** (the "Direct" connection needs IPv6) → note host and user.
3. Create the private settings file (git-ignored):

   ```powershell
   cd C:\Users\linge\Documents\CodeMixScribe\backend; Copy-Item supabase.env.example supabase.env; notepad supabase.env
   ```

   ```
   DB_URL=jdbc:postgresql://aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require
   DB_USER=postgres.<project-ref>
   DB_PASSWORD=<your database password>
   DB_POOL_SIZE=5
   ```
4. Start the backend with `run-supabase.ps1`. On the first start Flyway creates the tables
   (`Successfully applied 2 migrations`); you can see them in Supabase → *Table Editor*.

Tested 2026-11-20: Supabase PostgreSQL 17, register, login, save transcript (Tamil text intact),
save clinical codes, list and delete all work.

### 2.2b Alternative: local PostgreSQL (Docker)

Start Docker Desktop, wait for "Engine running", then:

```powershell
cd C:\Users\linge\Documents\CodeMixScribe; docker compose up -d
```

Database `scribe`, user `scribe`, password `scribe` are created automatically. The backend creates the
tables on its first start (Flyway migrations `V1__init`, `V2__clinical_codes`).

> **No Docker?** `winget install PostgreSQL.PostgreSQL.16`, then in "SQL Shell (psql)":
> `CREATE USER scribe WITH PASSWORD 'scribe'; CREATE DATABASE scribe OWNER scribe;`

### 2.3 ai-service (Python)

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\ai-service; C:\Python311\python.exe -m venv .venv
```

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\ai-service; $env:PIP_CONFIG_FILE="nul"; .\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

> `PIP_CONFIG_FILE="nul"` makes pip ignore the global pip config, which points at
> `pypi.ngc.nvidia.com` (unreachable from this laptop) and makes installs crawl.

Download the Whisper model once (~1.6 GB into `ai-service\models\`):

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\ai-service; .\.venv\Scripts\python.exe scripts\download_model.py
```

Create the config file and fill in the three personal values (see 2.6 and 2.7):

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\ai-service; Copy-Item .env.example .env
```

| Line in `ai-service\.env` | Value |
|---|---|
| `GEMMA_URL=` | the Kaggle URL (changes each session) |
| `GEMINI_API_KEY=` | your free Gemini key |
| `ICD10_MAP_PATH=` | full path to the SNOMED CT → ICD-10 map file |

Everything else already matches the backend.

### 2.4 Backend and frontend dependencies

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\backend; .\mvnw.cmd -DskipTests package
```

Expected: `BUILD SUCCESS`.

```powershell
cd C:\Users\linge\Documents\CodeMixScribe\frontend; npm install
```

### 2.5 Kaggle (Gemma)

1. kaggle.com (your Kaggle account) → **Datasets → New Dataset** → upload every file in
   your local adapter folder `gemma4-codemix-final\`
   (`adapter_model.safetensors`, `adapter_config.json`, tokenizer files, `chat_template.jinja`).
   Name it e.g. `gemma4-codemix-adapter`. Keep it **private**.
2. **Code → New Notebook → File → Import Notebook** → `kaggle\codemix_scribe_gemma_server.ipynb`.
3. Right panel: *Accelerator* **GPU T4 x2** or **T4 x1** (only one GPU is used), *Internet* **On**
   (needs a phone-verified account), *Add Input* → your adapter dataset.

The notebook downloads the base model `unsloth/gemma-4-e4b-it` from Hugging Face and attaches the
adapter. It pins GPU 0, loads in float16 and turns off Unsloth's compiler (needed on T4).
Nothing Gemma-related runs on the laptop.

### 2.6 Gemini key (clinical term extraction)

https://aistudio.google.com/apikey → sign in → *Create API key* → put it in `GEMINI_API_KEY=`.
Default model `gemini-3.1-flash-lite`; if it is overloaded or slower than 25 s, the service tries
`gemini-3-flash-preview`, then `gemini-3.8-flash` (`GEMINI_FALLBACK_MODELS`).

### 2.7 SNOMED CT → ICD-10 map (local, confidential)

Point `ICD10_MAP_PATH` at the extended map file **where it already is**; no need to copy it:

```
ICD10_MAP_PATH=C:\Users\linge\Documents\MedASR\Insurance\Licenced SNOMED\SnomedCT_InternationalRF2_PRODUCTION_20260701T120000Z\Snapshot\Refset\Map\der2_iisssccRefset_ExtendedMapSnapshot_INT_20260701.txt
```

Also supported: a CSV with a header `snomed_code,icd10_code[,icd10_name]`. If you ever copy a map
into the project, use `ai-service\private\`, which is git-ignored (as are `der2_*` / `sct2_*` files).

---

## Part 3: How it works and what was measured

### 3.1 Speech recognition (Whisper)

- Model: faster-whisper `large-v3-turbo`, CUDA, `int8_float16`, VAD on, `task="transcribe"` (never translate).
- **Language:** chosen per recording on the Live page (**Tamil**, **Hindi**, or **Auto**). Each
  language has a code-mixed sample sentence as Whisper's `initial_prompt` (`app/config.py`,
  `ASR_PROMPTS`). Uploads detect Tamil vs Hindi automatically.
- **Live streaming:** the browser sends 16 kHz audio every 100 ms; about every second the service
  re-transcribes the unfinished part. Words that two passes in a row agree on are confirmed (black);
  the rest is shown grey. A filter removes Whisper's occasional repetition loops.
- Measured on the RTX 3050 (30 s of Audio 4 streamed in real time): a pass usually takes 0.5–0.8 s
  (occasionally 2–3 s), giving about 20 updates per 30 s. Uploads run much faster than real time
  (94 s of audio in 22 s including Gemma).

**ASR test** (`scripts\test_asr.py`, 4 settings on the 4 test files, 2026-11-20). No accuracy (WER)
was measured; there are no reference transcripts. Observations:

| File | Speech | Result with the current settings |
|---|---|---|
| Audio 1 | Hindi + English | Hindi in **Devanagari** ("सर भी भारी लग रहा है"), English in Latin; a few English words in Devanagari ("फास्ट"). Needs the longer Hindi prompt; a one-line prompt gave all-Latin output. |
| Audio 2 | Malayalam + English | Not supported (Malayalam gets written as Hindi/Tamil). Not used in the demo. |
| Audio 3 | Mostly English | English; the few Tamil words come out romanized. |
| Audio 4 | Tamil + English | Tamil in Tamil script, English words in Latin ("energy", "excessive thirst"). |

**Auto language** is less reliable: in a microphone test it took 11 s to settle on Hindi and switched
to Tamil about 20 s late, and Tamil heard as "Hindi" gets translated into English. That is why the demo
uses the fixed Tamil/Hindi choice.

### 3.2 Gemma correction

On **Stop**, the transcript is sent in ~55-word chunks to the Kaggle notebook (`POST /correct`, the exact
prompt the LoRA adapter was trained with, `max_new_tokens=200`, `temperature=0.3`). The app shows raw vs
corrected side by side with a word-level diff. Observed: it fixes Tamil spellings ("ரும்ப" → "ரொம்ப"),
English words that Whisper wrote in Devanagari ("बत" → "but") and wrong words ("scientists" →
"symptoms", "Cuff" → "Cough"). It can also make mistakes: once it dropped a sentence, once it put a
Tamil word into Hindi text. That is why both versions stay visible. If Gemma is unreachable, the raw
text is kept with `correctionStatus = UNAVAILABLE`.

### 3.3 Clinical coding (SNOMED CT · LOINC · ICD-10)

`ai-service/app/clinical.py`, runs after the transcript is ready (automatically on Live and Upload,
via a button in History), and is saved with the transcript.

1. **Gemini** lists the clinical terms in plain English, with up to 2 alternative names and the exact
   words heard ("Heard as", original script).
2. **Ontoserver** (`ValueSet/$expand`) returns up to 8 real candidates per name: SNOMED CT clinical
   findings (symptoms, diagnoses), SNOMED CT procedures, LOINC (vitals, labs). **Gemini only chooses
   among those candidates**, so it cannot invent a code. Without Gemini, a strict text match is used
   that prefers "no match" over a wrong code.
3. **ICD-10** for symptoms and diagnoses comes from the local map: group 1, unconditional rule
   (`TRUE` / `OTHERWISE TRUE`) first; codes that depend on age/sex rules are marked
   "depends on patient context". Vitals, labs and procedures get no ICD-10 (ICD-10 classifies
   diagnoses and findings).

Measured (2026-11-20, real Gemini key, real SNOMED CT International 20260701 map with 112,464 concepts):

| Transcript | Result |
|---|---|
| Audio 1 (Hindi) | 12 of 12 terms coded: Fever 386661006 → R50.9, Headache 25064002 → R51 ("सर भी भारी"), Fatigue 84229001 → R53, Myalgia 68962001 → M79.19, Throat irritation 162400007 → J39.2, Viral infection 34014006 → B34.9 (suspected), Body temperature 8310-5 (101.8 °F), Heart rate 8867-4, Blood pressure panel 35094-2, Oxygen saturation 115653-8 (98%), CBC panel 58410-2, CRP 105126-7 |
| Audio 4 (Tamil) | Fatigue → R53, Excessive thirst 17173007 → R63.1, Anxiety 48694002 → F41.9 |

5–12 s per run. Taking only the first search result, as the earlier validation script did, gave wrong
codes ("Type 2 diabetes mellitus" → *Diabetes mellitus type 1 stage 2*, "Viral fever" → *Viral
haemorrhagic fever*); choosing among ranked candidates fixes this. Some choices are approximate
("सर भी भारी" = heavy head → *Headache*; "பயமா இருக்கு" = I'm scared → *Anxiety*). **These are coding
suggestions; a clinician must verify them.**

### 3.4 What leaves the laptop

| Data | Goes to |
|---|---|
| Microphone audio, Whisper | Stays on the laptop |
| Transcript for correction | Your Kaggle notebook (Gemma) |
| Corrected transcript for coding | Google Gemini API. On the free tier Google may use prompts to improve its products, so **use only the demo recordings, never real patient audio**. |
| Clinical term names only (e.g. "Fever") | Ontoserver (public, CSIRO) |
| SNOMED CT release / ICD-10 map | **Nowhere.** Read from disk by the ai-service. Don't show it on screen. |

---

## Part 4: Reference

### URLs and ports

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8080/api/... |
| ai-service | http://localhost:8001/health · API docs: http://localhost:8001/docs |
| Postgres | localhost:5432 (db/user/password `scribe`) |
| Gemma (Kaggle) | `https://*.trycloudflare.com` (new each session) |

### API summary

**ai-service**: `GET /health` · `GET/PUT /config/gemma-url` ·
`POST /transcribe` (multipart `file`, header `X-Service-Secret`) → `{raw, corrected, language, duration, correctionStatus}` ·
`WS /ws/live?token=<JWT>&lang=ta|hi|auto` (send PCM16 16 kHz mono frames, then `{"type":"stop"}`; receive
`partial`, `final_segment`, `raw_complete`, `corrected`, `saved`, `error`) ·
`POST /clinical/codes {text}` → `{status, model, items[{category, term, value, evidence, system, code, display, icd10}], warnings}`.

**backend**: `POST /api/auth/register` · `POST /api/auth/login` → `{token, ...}` ·
`GET /api/transcriptions` · `GET/DELETE /api/transcriptions/{id}` · `POST /api/transcriptions/upload` ·
`PUT /api/transcriptions/{id}/clinical-codes` · `POST /api/internal/transcriptions` (ai-service only, `X-Service-Secret`).

**Kaggle**: `GET /health` · `POST /correct {text}` → `{corrected}`.

### Configuration (`ai-service\.env` and backend environment)

Shared secrets must match between the ai-service and the backend; the dev defaults already match.

| Variable | Where | Default |
|---|---|---|
| `JWT_SECRET` | backend + ai-service | `scribe-dev-jwt-secret-change-me-0123456789abcdef` |
| `SERVICE_SECRET` | backend + ai-service | `scribe-dev-service-secret` |
| `GEMMA_URL` | ai-service (or Settings page, until restart) | empty |
| `GEMMA_TOKEN` | ai-service + notebook cell 2 | empty (no auth) |
| `ASR_LANGUAGE` | ai-service | empty = Tamil/Hindi auto-detect for uploads and Live "Auto"; `ta`/`hi` = force that language there (the Live Tamil/Hindi buttons always win) |
| `ASR_LANGUAGES` | ai-service | `ta,hi` |
| `ASR_PROMPT_TA`, `ASR_PROMPT_HI` | ai-service | code-mixed sample sentences in `app/config.py` |
| `GEMINI_API_KEY` | ai-service | empty (clinical coding off) |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_TIMEOUT_S` | ai-service | `gemini-3.1-flash-lite`; `gemini-3-flash-preview,gemini-3.8-flash`; `25` |
| `ICD10_MAP_PATH` | ai-service | empty (no ICD-10 codes) |
| `FHIR_TERMINOLOGY_URL` | ai-service | `https://r4.ontoserver.csiro.au/fhir` |
| `DB_URL`, `DB_USER`, `DB_PASSWORD` | backend (`supabase.env` for Supabase) | local: `jdbc:postgresql://localhost:5432/scribe`, `scribe`, `scribe` |
| `DB_POOL_SIZE` | backend | `10` (`5` for the Supabase free tier) |
| `AI_SERVICE_URL` | backend | `http://localhost:8001` |

### Troubleshooting

| Problem | Fix |
|---|---|
| `docker compose` → "cannot find dockerDesktopLinuxEngine" | Docker Desktop is not running. Start it, wait for "Engine running". |
| Backend: `Connection to localhost:5432 refused` | You started the local-database command. Use `run-supabase.ps1`, or start Docker (`docker compose up -d`). |
| `run-supabase.ps1`: "supabase.env not found" | Create it from `supabase.env.example` (2.2). |
| Backend on Supabase: `password authentication failed` | Wrong password or user in `supabase.env`. Reset the password in Supabase → *Project Settings* → *Database*. |
| Backend on Supabase: `UnknownHost` / connection timeout | Use the **Session pooler** host, not `db.<ref>.supabase.co` (IPv6 only). Check the internet connection. |
| Supabase project "paused" | Free projects pause after about a week without use. Supabase dashboard → *Restore project*, wait 1–2 minutes. |
| Backend: `Port 8080 already in use` | An old backend is still running: close that window, or `Stop-Process -Name java`. |
| ai-service: `Could not load library cudnn_*.dll` / `cublas64_12.dll` | `.\.venv\Scripts\python.exe -m pip install --force-reinstall nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"` |
| ai-service: `Whisper model not found` | Run `scripts\download_model.py` (2.3). |
| ai-service: CUDA out of memory | Close other GPU apps, or set `WHISPER_COMPUTE_TYPE=int8` in `.env`. |
| ai-service: `[Errno 10048]` (port 8001 in use) | An old ai-service is still running: find its PowerShell window and press `Ctrl+C`, or close it. |
| pip install very slow / `pypi.ngc.nvidia.com` errors | `$env:PIP_CONFIG_FILE="nul"` before pip (2.3). |
| Live: "Cannot connect to the ai-service" | ai-service not running or still loading the model. |
| Live: "Invalid or expired login" | Log out and in again (logins last 24 h). |
| Live: no text at all | The browser blocked the mic: click the 🔒 in the address bar → allow microphone. Use `localhost`, not an IP address. |
| Live: Tamil comes out as English sentences | Whisper was set to Hindi or Auto picked the wrong language. Choose **தமிழ் + English** before recording. |
| Gemma dot red / "Gemma was unreachable" | The Kaggle session stopped or the URL changed. Re-run the notebook, paste the new URL in **Settings → Save & test** (and in `.env`). |
| Kaggle: `Adapter not found` | Add the adapter dataset as Input (2.5). |
| Kaggle cell 5: `Offset increment outside graph capture` | Old notebook version. Import the current `kaggle\codemix_scribe_gemma_server.ipynb`, *Restart & clear outputs*, Run All. |
| Kaggle cell 2: `Run -> Restart & clear outputs...` | torch was already loaded from an earlier run. Restart the session, then Run All. |
| Kaggle: unsloth/transformers import errors | *Run → Restart & clear outputs*, then Run All (the first cell upgrades packages). |
| Clinical coding: "Gemini API key needed" | Set `GEMINI_API_KEY` in `.env`, restart the ai-service. |
| Clinical coding: "All Gemini models failed" | Google's models are overloaded or the free quota is used up. Wait a minute, press **Re-run**. You can put another model from aistudio.google.com in `GEMINI_MODEL`. |
| Clinical coding is slow (30 s+) | The main model is overloaded and the service is waiting 25 s before falling back. It skips that model for the next 5 minutes. |
| ICD-10 column shows "—" for symptoms/diagnoses | `ICD10_MAP_PATH` missing or wrong. The ai-service log must show `ICD-10 map loaded`. |
| Upload fails with 502 | ai-service is down. Uploads go backend → ai-service. |
| Recording missing from History | Check the ai-service window for `Could not save transcript in backend` (backend down). |
