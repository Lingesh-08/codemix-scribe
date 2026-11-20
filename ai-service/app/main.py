import asyncio
import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config
from .asr import asr
from .clinical import code_transcript, icd10_map
from .backend_client import save_transcription, user_id_from_token
from .gemma_client import gemma
from .live import LiveSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("scribe")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(asr.load)
    if config.ICD10_MAP_PATH:
        await asyncio.to_thread(icd10_map.load, config.ICD10_MAP_PATH)
    yield


app = FastAPI(title="CodeMix Scribe ai-service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


# ---------- health & config ----------
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "modelLoaded": asr.model is not None,
        "device": config.DEVICE,
        "computeType": asr.compute_type,
        "gpu": asr.gpu_name,
        "asrLanguage": config.ASR_LANGUAGE or "auto:" + ",".join(config.ASR_LANGUAGES),
        "gemma": {"url": gemma.url or None, "reachable": await gemma.health()},
        "clinical": {
            "geminiKey": bool(config.GEMINI_API_KEY),
            "geminiModel": config.GEMINI_MODEL,
            "icd10Map": icd10_map.source,
        },
    }


class CodeIn(BaseModel):
    text: str               # corrected transcript (or raw if there is no correction)
    raw: str | None = None  # raw Whisper text; helps when the correction model got a word wrong


@app.post("/clinical/codes")
async def clinical_codes(body: CodeIn):
    """Clinical terms -> SNOMED CT / LOINC -> ICD-10 for a (corrected) transcript."""
    if len(body.text) + len(body.raw or "") > 40000:
        raise HTTPException(413, "Transcript too long for clinical coding")
    return await code_transcript(body.text, body.raw)


class GemmaUrl(BaseModel):
    url: str


@app.get("/config/gemma-url")
async def get_gemma_url():
    return {"url": gemma.url}


@app.put("/config/gemma-url")
async def put_gemma_url(body: GemmaUrl):
    url = body.url.strip().rstrip("/")
    if url and not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL must start with http:// or https://")
    gemma.url = url
    return {"url": gemma.url, "reachable": await gemma.health()}


# ---------- file upload (called by Spring Boot) ----------
@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), x_service_secret: str | None = Header(default=None)):
    if config.SERVICE_SECRET and x_service_secret != config.SERVICE_SECRET:
        raise HTTPException(401, "Bad service secret")
    suffix = os.path.splitext(file.filename or "")[1] or ".bin"
    fd, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as f:
            while chunk := await file.read(1 << 20):
                f.write(chunk)
        try:
            result = await asyncio.to_thread(asr.transcribe_file, path)
        except Exception as e:
            log.exception("Transcription failed")
            raise HTTPException(400, f"Could not decode/transcribe audio: {e}")
    finally:
        os.remove(path)
    corrected, status = await gemma.correct(result["text"])
    return {
        "raw": result["text"],
        "corrected": corrected,
        "language": result["language"],
        "duration": result["duration"],
        "correctionStatus": status,
    }


# ---------- live WebSocket ----------
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket, token: str = "", lang: str = "auto"):
    await ws.accept()
    user_id = user_id_from_token(token)
    if user_id is None:
        await ws.send_json({"type": "error", "message": "Invalid or expired login. Please log in again."})
        await ws.close(code=4401)
        return

    session = LiveSession(language=None if lang == "auto" else lang)
    log.info("live session: user %s, language %s", user_id, session.language if lang != "auto" else "auto")
    stop = asyncio.Event()
    state = {"disconnected": False}

    async def receiver():
        try:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    state["disconnected"] = True
                    break
                if msg.get("bytes"):
                    session.add_pcm16(msg["bytes"])
                elif msg.get("text"):
                    try:
                        data = json.loads(msg["text"])
                    except ValueError:
                        continue
                    if data.get("type") == "stop":
                        break
        except (WebSocketDisconnect, RuntimeError):
            state["disconnected"] = True
        finally:
            stop.set()

    recv_task = asyncio.create_task(receiver())
    try:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=0.2)
            except asyncio.TimeoutError:
                pass
            if not stop.is_set() and session.ready():
                committed, partial = await asyncio.to_thread(session.process)
                if committed:
                    await ws.send_json({"type": "final_segment", "text": committed})
                await ws.send_json({"type": "partial", "text": partial})

        if state["disconnected"]:
            return

        tail = await asyncio.to_thread(session.finish)
        if tail:
            await ws.send_json({"type": "final_segment", "text": tail})
        await ws.send_json({"type": "partial", "text": ""})
        raw = session.text()
        duration = round(session.duration, 2)
        await ws.send_json({"type": "raw_complete", "text": raw, "duration": duration, "language": session.language})

        corrected, status = await gemma.correct(raw)
        await ws.send_json({"type": "corrected", "text": corrected, "status": status})

        saved_id = None
        if raw:
            title = "Live recording " + datetime.now().strftime("%Y-%m-%d %H:%M")
            saved_id = await save_transcription(user_id, title, raw, corrected, session.language, duration, status)
        await ws.send_json({"type": "saved", "id": saved_id})
        await ws.close()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.exception("Live session error")
        try:
            await ws.send_json({"type": "error", "message": str(e)})
            await ws.close(code=1011)
        except Exception:
            pass
    finally:
        recv_task.cancel()
