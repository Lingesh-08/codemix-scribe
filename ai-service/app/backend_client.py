"""Saves finished live transcripts in Spring Boot."""
import logging

import httpx
import jwt

from . import config

log = logging.getLogger("scribe.backend")


def user_id_from_token(token: str) -> int | None:
    """Validate the JWT issued by Spring Boot (HS256, shared JWT_SECRET)."""
    try:
        claims = jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])
        return int(claims["sub"])
    except Exception as e:
        log.info("Rejected token: %s", e)
        return None


async def save_transcription(user_id: int, title: str, raw: str, corrected: str,
                             language: str, duration: float, status: str) -> int | None:
    body = {
        "userId": user_id,
        "title": title,
        "rawText": raw,
        "correctedText": corrected,
        "language": language,
        "durationSec": duration,
        "correctionStatus": status,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{config.BACKEND_URL}/api/internal/transcriptions", json=body,
                             headers={"X-Service-Secret": config.SERVICE_SECRET})
            r.raise_for_status()
            return r.json().get("id")
    except Exception as e:
        log.error("Could not save transcript in backend: %s", e)
        return None
