"""HTTP client for the Gemma correction API running on Kaggle."""
import logging
import re

import httpx

from . import config

log = logging.getLogger("scribe.gemma")

# The Kaggle server chunks text into 55-word pieces. We send exactly one piece per request,
# so each answer belongs to one chunk and can be cleaned on its own (see _clean).
WORDS_PER_REQUEST = 55

# Gemma sometimes writes a malformed end marker such as "<end_of_of_turn>" and then repeats
# itself. Everything from the first chat-control marker on is not part of the answer.
_MARKER = re.compile(r"<\s*/?\s*(?:end_of|start_of|eos|bos|pad|turn)[^>]*>|<\|[^>]*\|>", re.I)


def _clean(answer: str, source: str) -> str:
    """Cut the answer at the first control marker; fall back to the source text if the
    result is empty or clearly not a correction of it (much shorter or much longer)."""
    m = _MARKER.search(answer)
    text = (answer[:m.start()] if m else answer).strip()
    if m:
        log.info("Gemma output had a stray marker %r; cut %d chars", m.group(0), len(answer) - m.start())
    src_words, out_words = len(source.split()), len(text.split())
    if not text or out_words < 0.5 * src_words or out_words > 1.5 * src_words + 5:
        log.warning("Gemma output rejected (%d words for %d), keeping raw text for this chunk", out_words, src_words)
        return source
    return text


class GemmaClient:
    def __init__(self):
        self.url = config.GEMMA_URL  # can be changed at runtime via PUT /config/gemma-url

    def _headers(self):
        return {"Authorization": f"Bearer {config.GEMMA_TOKEN}"} if config.GEMMA_TOKEN else {}

    async def health(self) -> bool:
        if not self.url:
            return False
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(f"{self.url}/health", headers=self._headers())
                return r.status_code == 200
        except Exception:
            return False

    async def _correct_piece(self, client: httpx.AsyncClient, text: str) -> str:
        last_err = None
        for attempt in range(2):  # 1 retry
            try:
                r = await client.post(f"{self.url}/correct", json={"text": text}, headers=self._headers())
                r.raise_for_status()
                return _clean(r.json()["corrected"], text)
            except Exception as e:
                last_err = e
                log.warning("Gemma attempt %d failed: %s", attempt + 1, e)
        raise last_err

    async def correct(self, text: str) -> tuple[str, str]:
        """Returns (text, correctionStatus). Never raises."""
        if not text.strip():
            return text, "SKIPPED"
        if not self.url:
            return text, "UNAVAILABLE"
        words = text.split()
        pieces = [" ".join(words[i:i + WORDS_PER_REQUEST]) for i in range(0, len(words), WORDS_PER_REQUEST)]
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                out = [await self._correct_piece(client, p) for p in pieces]
            return " ".join(out).strip(), "CORRECTED"
        except Exception as e:
            log.error("Gemma unavailable, returning raw text: %s", e)
            return text, "UNAVAILABLE"


gemma = GemmaClient()
