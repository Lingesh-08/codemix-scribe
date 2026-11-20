import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _get(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


MODEL_DIR = Path(_get("WHISPER_MODEL_DIR", str(ROOT / "models" / "faster-whisper-large-v3-turbo")))
DEVICE = _get("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = _get("WHISPER_COMPUTE_TYPE", "int8_float16")

# ASR decoding settings (see README "ASR test results").
# ASR_LANGUAGE set (e.g. "ta") = always use that language.
# ASR_LANGUAGE empty = detect it per recording, choosing only among ASR_LANGUAGES,
# so Tamil comes out in Tamil script and Hindi in Devanagari (English words stay Latin).
ASR_LANGUAGE = _get("ASR_LANGUAGE") or None
ASR_LANGUAGES = [l.strip() for l in _get("ASR_LANGUAGES", "ta,hi").split(",") if l.strip()]
# A short code-mixed sample per language, passed as Whisper's initial_prompt.
ASR_PROMPTS = {
    "ta": _get("ASR_PROMPT_TA", "Doctor, எனக்கு two weeks-ஆ cough இருக்கு. Meeting-க்கு late ஆயிடுச்சு, sorry."),
    # Hindi needs a longer sample, or Whisper writes Hindi words in Latin letters.
    "hi": _get("ASR_PROMPT_HI", "Doctor, मेरे घुटने में बहुत दर्द है, सीढ़ियाँ चढ़ने में problem होती है। कब से है? "
               "लगभग एक महीने से। Any injury? नहीं, बस सुबह उठने पर stiffness रहती है। "
               "Okay, X-ray करवा लीजिए और यह painkiller दिन में दो बार खाना है।"),
}

GEMMA_URL = _get("GEMMA_URL").rstrip("/")
GEMMA_TOKEN = _get("GEMMA_TOKEN")
BACKEND_URL = _get("BACKEND_URL", "http://localhost:8080").rstrip("/")
SERVICE_SECRET = _get("SERVICE_SECRET", "scribe-dev-service-secret")
JWT_SECRET = _get("JWT_SECRET", "scribe-dev-jwt-secret-change-me-0123456789abcdef")
# Clinical coding (app/clinical.py)
GEMINI_API_KEY = _get("GEMINI_API_KEY")                  # free key: https://aistudio.google.com/apikey
GEMINI_MODEL = _get("GEMINI_MODEL", "gemini-3.1-flash-lite")
# tried in order when the main model is overloaded, retired or too slow
GEMINI_FALLBACK_MODELS = [m.strip() for m in _get("GEMINI_FALLBACK_MODELS", "gemini-3-flash-preview,gemini-3.8-flash").split(",") if m.strip()]
GEMINI_TIMEOUT_S = float(_get("GEMINI_TIMEOUT_S", "25"))
FHIR_TERMINOLOGY_URL = _get("FHIR_TERMINOLOGY_URL", "https://r4.ontoserver.csiro.au/fhir").rstrip("/")
ICD10_MAP_PATH = _get("ICD10_MAP_PATH")                  # your local SNOMED CT -> ICD-10 map file (never shared)

CORS_ORIGINS = [o.strip() for o in _get("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
