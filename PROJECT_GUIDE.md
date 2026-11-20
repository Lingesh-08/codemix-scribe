# CodeMix Scribe — project guide (how it works + interview questions)

Read this top to bottom once, then open each file it mentions next to it.

---

## 1. The one-paragraph pitch

CodeMix Scribe is a live speech-to-text app for doctor–patient conversations in **Tamil, Hindi and English
mixed in the same sentence**. It **transcribes, never translates**: Tamil stays in Tamil script, Hindi
in Devanagari, English in Latin letters. Whisper runs on my laptop GPU and shows words within about a
second. When the doctor stops, a **Gemma model I fine-tuned with LoRA** fixes recognition errors, and a
clinical-coding step turns the conversation into **SNOMED CT, LOINC and ICD-10 codes**. Everything is
saved per user in a **Supabase** (cloud PostgreSQL) database behind a Spring Boot API with JWT login, and the UI is React.

## 2. The architecture (4 services)

```
React (Vite, :5173)  ──── mic audio, WebSocket ────►  ai-service (Python FastAPI, :8001)
   │  REST + JWT                                         • faster-whisper large-v3-turbo on RTX 3050
   ▼                                                     • on Stop → Gemma API (Kaggle GPU, cloudflared URL)
Spring Boot (:8080)  ◄── saves transcript ───────────    • clinical coding → Gemini + Ontoserver + local ICD-10 map
   │  JDBC over SSL (session pooler)
Supabase PostgreSQL 17 (cloud)   [local Docker PostgreSQL as an alternative]
```

| Part | Tech | Job | Main files |
|---|---|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind, React Router | UI, mic capture, WebSocket client | `frontend/src/pages/Live.tsx`, `audio/recorder.ts`, `public/pcm-worklet.js`, `components/ResultPanels.tsx`, `components/ClinicalCodes.tsx` |
| ai-service | Python 3.11, FastAPI, faster-whisper (CTranslate2), httpx | Speech recognition, live streaming, Gemma call, clinical coding | `ai-service/app/main.py`, `asr.py`, `live.py`, `gemma_client.py`, `clinical.py` |
| Backend | Java 17, Spring Boot 3.5, Spring Security, JPA/Hibernate, Flyway, jjwt | Users, login, history, uploads, saving codes | `backend/src/main/java/com/codemixscribe/...`, `db/migration/V1__init.sql`, `V2__clinical_codes.sql` |
| Gemma server | Kaggle T4 GPU, Unsloth, PEFT, FastAPI, cloudflared | Runs the fine-tuned correction model | `kaggle/codemix_scribe_gemma_server.ipynb` |
| Database | **Supabase** (managed PostgreSQL 17, cloud); local Docker PostgreSQL as fallback | `users`, `transcriptions` tables, created by Flyway | `backend/run-supabase.ps1`, `backend/supabase.env` (private), `docker-compose.yml` |

**Why three languages of code (TypeScript, Python, Java)?** Each does what it's best at: the AI
libraries (Whisper, PyTorch) live in Python; Spring Boot is a strong, typical choice for a secure
business API (auth, database, validation); React is the standard for an interactive UI.

## 3. The flows, step by step

### 3.1 Login
1. React posts email + password to `POST /api/auth/register` or `/login` (Spring Boot).
2. Spring hashes passwords with **BCrypt** and, on success, returns a **JWT** (HS256, signed with
   `JWT_SECRET`, user id in `sub`, valid 24 h).
3. React stores it in `localStorage` and sends `Authorization: Bearer <token>` on every API call.
   `JwtAuthFilter` validates it and puts the user id into the security context.

### 3.2 Live recording (the core)
1. You pick **Tamil / Hindi / Auto** and press the mic button.
2. React opens `ws://localhost:8001/ws/live?token=<JWT>&lang=ta`. The **ai-service validates the same
   JWT itself** (same secret), so audio never has to pass through Spring Boot.
3. Browser mic (48 kHz) → an **AudioWorklet** (`pcm-worklet.js`) downsamples to **16 kHz mono 16-bit PCM**
   and sends a binary frame every **100 ms** (3,200 bytes). It also reports the volume for the waveform.
4. The ai-service appends frames to a **rolling buffer** (`live.py`). About every **1 s of new audio**, a
   worker thread re-transcribes the buffer with Whisper (fast settings: `beam_size=1`, `temperature=0`,
   word timestamps, VAD filter, the code-mixed `initial_prompt` + the last committed words).
5. **LocalAgreement-2**: words that **two consecutive passes agree on** (longest common prefix) are
   **committed** → `{"type":"final_segment"}` (black text). The rest is `{"type":"partial"}` (grey).
6. The buffer is **trimmed** after the last committed word once it passes 6 s and force-committed at
   15 s, so each pass stays fast (0.5–0.8 s on the RTX 3050).
7. A loop filter drops Whisper's repetition loops ("x x x x …").
8. **Stop** → `{"type":"stop"}` → a final pass on what's left → `raw_complete`.
9. The ai-service sends the text to **Gemma** on Kaggle (`POST /correct`, ~55-word chunks, exact training
   prompt) → `corrected`. If Kaggle is down: raw text, status `UNAVAILABLE`, never a crash.
10. The ai-service saves the record in Spring Boot via `POST /api/internal/transcriptions`, protected
    by the `X-Service-Secret` header → `saved {id}`.
11. React shows raw vs corrected with a **word-level diff** (LCS algorithm in the browser) and starts
    clinical coding.

### 3.3 Upload
React → `POST /api/transcriptions/upload` (Spring, JWT) → Spring forwards the file to the ai-service
`POST /transcribe` (with the service secret) → PyAV decodes any format → language detection (Tamil vs
Hindi only) → Whisper (beam 5) → Gemma → Spring saves and returns the record. (Live audio goes straight
to Python; uploaded files go through Spring because it owns the user and the record.)

### 3.4 Clinical coding
1. React → ai-service `POST /clinical/codes {text}`.
2. **Gemini** reads the corrected transcript and returns JSON: terms per category (symptoms, vitals with
   values, lab tests, procedures, diagnoses with confirmed/suspected), up to 2 alternative names, and the
   exact words heard.
3. For each name, **Ontoserver** (a public FHIR terminology server, `ValueSet/$expand`) returns up to 8
   real candidates: SNOMED CT clinical findings / procedures, or LOINC observations.
4. **Gemini chooses among those candidates** (or none). It can't invent codes. Fallback without Gemini:
   a strict text match that prefers "no match" over a wrong code.
5. **ICD-10**: SNOMED code → local **SNOMED CT International ICD-10 extended map** (RF2 file, 112,464
   concepts), using map group 1 and the unconditional rule first.
6. React shows the table and saves it: `PUT /api/transcriptions/{id}/clinical-codes` (JSON in a `text` column).

## 4. Key design decisions (be ready to defend these)

| Decision | Why |
|---|---|
| Audio straight React → Python over WebSocket | Lowest latency; Spring would only add a hop. The ai-service checks the same JWT, so it's still authenticated. |
| faster-whisper `large-v3-turbo`, int8_float16 | Best quality that fits a 6 GB laptop GPU in real time; int8 weights halve memory. |
| Re-transcribe + LocalAgreement instead of one pass at the end | Gives live text while it's spoken, and text that two passes agree on is stable, so it doesn't flicker. |
| Fixed Tamil/Hindi choice in Live | Measured: Auto detection on mixed speech switched 20 s late, and Whisper set to the wrong language *translates*. A fixed choice is reliable. |
| Gemma on Kaggle, not the laptop | Whisper already uses most of the 6 GB GPU; Kaggle gives a free T4. Exposed with a cloudflared tunnel; the URL is configurable at runtime. |
| LoRA adapter, not full fine-tuning | Trains ~1% of parameters (r=16, α=32), small file (~147 MB), base model downloaded separately. |
| Gemini only *chooses* codes from server results | LLMs can hallucinate codes; the terminology server is the source of truth. |
| ICD-10 from a local licensed file | The public server has no SNOMED→ICD-10 map, and the licensed release must not be uploaded. |
| Flyway migrations | Versioned, repeatable DB schema (`V1`, `V2`) instead of Hibernate auto-DDL. The same migrations built the local and the Supabase database. |
| Supabase for the database | Managed PostgreSQL in the cloud: no local database to run, backups and a dashboard (Table Editor) included. Because it is standard PostgreSQL, the backend only needed a different connection string, no code changes. |
| Graceful degradation everywhere | Gemma down → raw text; Gemini down → message + Re-run; nothing crashes the recording. |

## 5. Interview questions with answers

### Project overview
1. **What problem does CodeMix Scribe solve?** Doctors in India switch between Tamil/Hindi and English mid-sentence.
   Normal speech-to-text either forces one language or translates. CodeMix Scribe keeps every word in its own script,
   fixes errors with a fine-tuned model, and produces clinical codes.
2. **Walk me through what happens when I press Record.** → Section 3.2 in order: worklet → 16 kHz PCM →
   WebSocket → rolling buffer → Whisper every ~1 s → LocalAgreement → partial/final → Stop → Gemma → save → coding.
3. **What was the hardest part?** Making live, code-mixed transcription stable: language detection
   was unreliable on mixed speech, Whisper sometimes looped or translated, and the fix was a fixed language
   choice, code-mixed prompts and a loop filter, each measured on real test audio.
4. **What did you measure?** Live pass time 0.5–0.8 s on an RTX 3050; ~20 updates per 30 s; upload of
   94 s audio in 22 s including Gemma; clinical coding 5–12 s; Audio 1: 12/12 terms coded. I did **not**
   measure word error rate because there were no reference transcripts. That's the next step.

### Speech / AI
5. **Why Whisper, and why `large-v3-turbo`?** Multilingual, robust to accents and noise; turbo is a
   distilled decoder that's much faster with similar quality. It fits a 6 GB GPU in int8.
6. **What is VAD?** Voice Activity Detection (Silero, built into faster-whisper): skips silence, so Whisper
   doesn't hallucinate on silent audio and runs faster.
7. **What does `initial_prompt` do?** It conditions the decoder with example text. A code-mixed sample
   ("Doctor, எனக்கு two weeks-ஆ cough இருக்கு") nudges Whisper to keep English words in Latin and Tamil in
   Tamil script. For Hindi, a short prompt wasn't enough; a longer one was needed (measured).
8. **Explain LocalAgreement.** Each pass re-reads the uncommitted audio. A word is final only when two
   consecutive passes produce the same words up to that point. It trades ~1 s latency for stable output.
9. **Why 16 kHz mono PCM16?** Whisper's native input; 16-bit integers halve the bandwidth versus float32
   (32 KB/s).
10. **What is an AudioWorklet and why not MediaRecorder?** It runs on the audio thread and gives raw
    samples, so I can resample and send exact 100 ms frames. MediaRecorder gives compressed chunks
    (WebM/Opus) that would need decoding.
11. **What is LoRA?** Low-Rank Adaptation: freeze the base model, train small low-rank matrices added to
    some layers. r=16 is the rank, α=32 the scaling. Cheap to train and to share.
12. **What is 4-bit quantization (bitsandbytes)?** Stores weights in 4 bits so a multi-billion-parameter
    model fits on a 16 GB T4; compute still happens in fp16.
13. **Why chunk the text for Gemma?** Matches how the adapter was trained (~55 words) and keeps each
    generation within `max_new_tokens=200`.
14. **How do you stop Gemma from going on forever?** A stopping criterion on `<end_of_turn>` plus
    `max_new_tokens`.
15. **What went wrong on Kaggle and how did you fix it?** "Offset increment outside graph capture" was
    caused by the model split over two GPUs, bf16 on a T4 and Unsloth's compiled CUDA graphs. Fix: pin
    GPU 0, float16, compile off, greedy fallback.
16. **How do you know Gemma helped?** The UI shows a word diff ("Gemma corrected N of M words") and I
    checked examples (scientists→symptoms, Cuff→Cough). Honestly, it also made mistakes (dropped a sentence
    once), so both versions stay visible. A proper evaluation needs reference transcripts and WER.

### Clinical coding
17. **SNOMED CT vs ICD-10 vs LOINC?** SNOMED CT: detailed clinical terminology (findings, procedures)
    for the record. ICD-10: a classification for statistics/billing/insurance (coarser). LOINC: codes for
    lab tests and measurements/vitals.
18. **What is FHIR and `$expand`?** FHIR is the HL7 standard API for health data; `ValueSet/$expand` with a
    `filter` searches a code system and returns matching concepts.
19. **Why not just take the first search result?** Measured: "Type 2 diabetes mellitus" returned *Diabetes
    mellitus type 1 stage 2* first, "Viral fever" returned *Viral haemorrhagic fever*. Ranking candidates fixes this.
20. **How do you prevent the LLM from inventing codes?** It only picks an index from the server's
    candidate list; the code itself always comes from the server.
21. **What is the RF2 extended map and map rules?** SNOMED's release format; the ICD-10 map has groups,
    priorities and rules like "IFA 248152002 | Female |". I use group 1 and the unconditional rule first, and
    mark age/sex-dependent maps.
22. **Privacy?** Audio and Whisper stay local; the licensed SNOMED file is never uploaded; only the
    transcript goes to Gemini (so demo audio only, not real patients) and only term names go to Ontoserver.

### Backend (Spring Boot)
23. **How does JWT auth work here?** Login returns a signed token; a filter (`JwtAuthFilter`) validates the
    signature and expiry on each request; sessions are stateless (no server session).
24. **How does the ai-service authenticate to the backend?** A shared `X-Service-Secret` header, compared in
    constant time (`MessageDigest.isEqual`) to avoid timing attacks.
25. **How are passwords stored?** BCrypt hashes, never plain text.
26. **Why Flyway?** Versioned SQL migrations: the same schema everywhere, and changes like
    `V2__clinical_codes.sql` are tracked.
27. **How do you make sure a user only sees their own data?** Every query is scoped by the user id from the
    JWT: `findByIdAndUserId`, so another user's id returns 404.
28. **CORS?** The browser blocks cross-origin calls; Spring and FastAPI allow only `http://localhost:5173`.
29. **What was the time-zone bug?** Postgres 16 rejected the JVM's old zone name "Asia/Calcutta"; fixed by
    setting the JVM default time zone to UTC at startup.
30. **Why `RestClient` with a 15-minute timeout for uploads?** Long audio plus Gemma correction can take
    minutes; the default timeout would cut it off.

30b. **How did you integrate Supabase?** Supabase is managed PostgreSQL, so Spring Boot connects with
    the normal PostgreSQL JDBC driver. I used Supabase's **session pooler** endpoint (IPv4, port 5432) with
    `sslmode=require`, kept the credentials in a git-ignored `supabase.env` loaded by a start script, limited
    the Hikari connection pool to 5 for the free tier, and Flyway created the schema on the first start.
30c. **Session pooler vs direct connection vs transaction pooler?** Direct = straight to the database (IPv6
    only on the free plan). Session pooler = a Supavisor proxy that keeps one server connection per client
    session, which works with prepared statements and IPv4. Transaction pooler = shares connections per
    transaction; better for serverless, but prepared statements need extra settings.

### Frontend (React)
31. **How is state handled on the Live page?** A `phase` state machine: idle → connecting → recording →
    finishing → correcting → done, which drives the button, the pipeline steps and the messages.
32. **How does the diff work?** Split both texts into words, compute the longest common subsequence
    ignoring case and punctuation, mark inserted words green and deleted red.
33. **How do you render Tamil and Hindi properly?** Noto Sans + Noto Sans Tamil + Noto Sans Devanagari.
34. **Why Vite and Tailwind?** Fast dev server/builds; utility CSS keeps styles next to the markup.

### System design / improvements
35. **How would you deploy it?** Containerize each service; GPU host or a managed ASR service for Whisper;
    the database is already on Supabase (managed Postgres); the Gemma model on a GPU endpoint instead of Kaggle; HTTPS/WSS.
36. **How would you scale to many users?** Whisper is the bottleneck (one GPU, one lock): a queue and
    several GPU workers, batching, or streaming-native ASR.
37. **What would you improve next?** Collect reference transcripts and measure WER/CER; speaker
    diarization (doctor vs patient); Malayalam; FHIR export of the codes; tests and CI.
38. **What are the failure modes?** Kaggle session/URL expires; Gemini rate limits or overload (handled with
    model fallback); wrong language choice → translation; noisy audio.

## 6. A 2-minute way to explain it in an interview

"CodeMix Scribe is a live medical transcription app for code-mixed Tamil, Hindi and English. The browser streams
16 kHz audio over a WebSocket to a Python FastAPI service, where faster-whisper on my laptop GPU
re-transcribes about every second, and a LocalAgreement step confirms words once two passes agree, so text
appears live without flickering. When the doctor stops, the text goes to a Gemma model I fine-tuned with
LoRA, running on a Kaggle GPU, which fixes recognition errors while keeping each language in its own
script; the UI shows exactly which words it changed. Then a clinical-coding step uses Gemini to pick out
symptoms, vitals, tests and diagnoses, looks them up on a FHIR terminology server for SNOMED CT and LOINC,
and maps to ICD-10 with the licensed SNOMED map stored locally. A Spring Boot API with JWT and a Supabase (cloud PostgreSQL) database
stores users, transcripts and codes, and the frontend is React with TypeScript. The hardest part was making
code-mixed live transcription stable, which I solved with measured choices: fixed language selection,
code-mixed prompts and loop filtering."
