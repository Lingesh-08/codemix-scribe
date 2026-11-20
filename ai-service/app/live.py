"""Live streaming transcription: rolling buffer + LocalAgreement-2.

Every ~1 s we re-transcribe the audio that is not yet committed. Words that two
consecutive passes agree on (longest common prefix) are committed and never change
again; the rest is shown as a grey "partial"."""
import logging
import re
import time
import threading
from dataclasses import replace
from difflib import SequenceMatcher

import numpy as np

from . import config
from .asr import SAMPLE_RATE, Word, asr

log = logging.getLogger("scribe.live")
MIN_NEW_AUDIO_S = 1.0     # re-transcribe after this much new audio
TRIM_AFTER_S = 6.0        # once the buffer is longer, cut it at the last committed word
FORCE_COMMIT_S = 10.0     # never let the buffer grow past this
STUCK_SKIP_S = 3.0        # if it still can't move forward, skip this much of the oldest audio
LANG_MAX_S = 15.0         # re-detect the language on the first 15 s until it is clear, then keep it
LANG_RECHECK_S = 5.0      # after that, re-check every 5 s of new audio (speaker may switch Tamil <-> Hindi)
LANG_RECENT_S = 10.0      # ... looking at the last 10 s
SILENCE_KEEP_S = 2.0      # if a long buffer has no speech, keep only this much


def _norm(t: str) -> str:
    return re.sub(r"[^\w]", "", t.lower())


def _drop_loops(words: list[Word], max_repeats: int = 2) -> list[Word]:
    """Whisper sometimes gets stuck repeating a word/phrase ("x, x, x, x, ...").
    Keep at most `max_repeats` consecutive copies of any 1-3 word unit and drop everything after a loop."""
    keys = [_norm(w.text) for w in words]
    for i in range(len(words)):
        for n in (1, 2, 3):
            unit = keys[i:i + n]
            if len(unit) < n or not all(unit):
                continue
            reps = 1
            while keys[i + reps * n:i + (reps + 1) * n] == unit:
                reps += 1
            if reps > max_repeats + 1:   # a real loop: cut it (the rest of this pass is unreliable)
                return words[:i + max_repeats * n]
        # looser check for loops that alternate spellings ("x y x x y x ..."):
        # 6 words in a row made of only 1-2 different words
        window = keys[i:i + 6]
        if len(window) == 6 and all(window) and len(set(window)) <= 2:
            return words[:i + max_repeats]
    return words


def _echo_prefix_len(committed: list[str], hyp: list[str], max_n: int = 40, min_n: int = 4,
                     threshold: float = 0.8) -> int:
    """Length of the longest start of `hyp` that (fuzzily) repeats a stretch of the recently
    committed words. On noisy audio Whisper sometimes re-writes its prompt (the committed tail),
    with small spelling changes, so exact matching is not enough."""
    if len(hyp) < min_n or len(committed) < min_n:
        return 0
    for n in range(min(max_n, len(hyp)), min_n - 1, -1):
        head = hyp[:n]
        for size in (n - 1, n, n + 1):
            if size < min_n or size > len(committed):
                continue
            for start in range(0, len(committed) - size + 1):
                blocks = SequenceMatcher(None, head, committed[start:start + size], autojunk=False).get_matching_blocks()
                covered = {i for blk in blocks for i in range(blk.a, blk.a + blk.size)}
                # the repeated part must end on a repeated word, and most of its words must be repeats
                if (n - 1) in covered and len(covered) / n >= threshold:
                    return n
    return 0


def _join(words: list[Word]) -> str:
    return "".join(w.text for w in words).strip()


class LiveSession:
    def __init__(self, language: str | None = None):
        """language: "ta"/"hi" chosen by the user = fixed for the whole recording; None = auto."""
        self._fixed = language if language in config.ASR_LANGUAGES else config.ASR_LANGUAGE
        self._buf_lock = threading.Lock()
        self.buffer = np.zeros(0, dtype=np.float32)
        self.buffer_start = 0.0          # absolute time (s) of buffer[0]
        self.samples_total = 0
        self.samples_at_last_pass = 0
        self.committed: list[Word] = []  # absolute times
        self.prev_hyp: list[Word] = []
        self.language = self._fixed or config.ASR_LANGUAGES[0]
        self._lang_locked = bool(self._fixed)
        self.head = np.zeros(0, dtype=np.float32)
        self.recent = np.zeros(0, dtype=np.float32)   # last LANG_RECENT_S seconds, for re-checks
        self._samples_at_lang_check = 0
        self._lang_from = 0                           # index in committed where the current language began

    # ---- input ----
    def add_pcm16(self, data: bytes):
        if len(data) % 2:
            data = data[:-1]
        chunk = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        with self._buf_lock:
            self.buffer = np.concatenate([self.buffer, chunk])
            if not self._lang_locked and len(self.head) < LANG_MAX_S * SAMPLE_RATE:
                self.head = np.concatenate([self.head, chunk])  # first seconds, for language detection
            self.recent = np.concatenate([self.recent, chunk])[-int(LANG_RECENT_S * SAMPLE_RATE):]
            self.samples_total += len(chunk)

    @property
    def duration(self) -> float:
        return self.samples_total / SAMPLE_RATE

    def ready(self) -> bool:
        return (self.samples_total - self.samples_at_last_pass) >= MIN_NEW_AUDIO_S * SAMPLE_RATE

    def text(self) -> str:
        return _join(self.committed)

    # ---- processing (runs in a worker thread) ----
    def _prompt(self) -> str | None:
        tail = _join(self.committed[self._lang_from:])[-150:]  # only text in the current language
        parts = [p for p in (config.ASR_PROMPTS.get(self.language), tail) if p]
        return " ".join(parts) or None

    def _hypothesis(self) -> list[Word]:
        with self._buf_lock:
            audio, start = self.buffer.copy(), self.buffer_start
        if not self._lang_locked:
            with self._buf_lock:
                head = self.head.copy()
            self.language, confident = asr.pick_language(head)
            if confident or len(head) >= LANG_MAX_S * SAMPLE_RATE:
                self._lang_locked = True
                self.head = np.zeros(0, dtype=np.float32)
                self._samples_at_lang_check = self.samples_total
                log.info("live language locked: %s", self.language)
        elif not self._fixed and len(config.ASR_LANGUAGES) > 1 and (
                self.samples_total - self._samples_at_lang_check >= LANG_RECHECK_S * SAMPLE_RATE):
            self._recheck_language()
        words, _ = asr.transcribe_words(audio, self._prompt(), self.language)
        last_end = self.committed[-1].end if self.committed else 0.0
        hyp = [replace(w, start=w.start + start, end=w.end + start) for w in _drop_loops(words)]
        hyp = [w for w in hyp if w.start >= last_end - 0.1]
        # loops can also build up across passes: check committed tail + new words together
        if self.committed and hyp:
            tail = self.committed[-9:]
            kept = _drop_loops(tail + hyp)
            if len(kept) >= len(tail):  # only cut new words, never stall on old text
                hyp = kept[len(tail):]
        # drop words at the start that repeat the tail of committed text (1..5-gram, exact)
        if self.committed and hyp:
            for n in range(min(5, len(hyp), len(self.committed)), 0, -1):
                if [_norm(w.text) for w in self.committed[-n:]] == [_norm(w.text) for w in hyp[:n]]:
                    hyp = hyp[n:]
                    break
        # and longer, fuzzy repeats of recently committed text (Whisper echoing its prompt)
        if self.committed and hyp:
            recent = [_norm(w.text) for w in self.committed[-80:]]
            n = _echo_prefix_len(recent, [_norm(w.text) for w in hyp])
            if n:
                log.info("dropped %d words that repeat already committed text", n)
                hyp = hyp[n:]
        return hyp

    def _recheck_language(self):
        """Switch language if another one clearly dominates the last few seconds."""
        self._samples_at_lang_check = self.samples_total
        with self._buf_lock:
            recent = self.recent.copy()
        probs = asr.language_probs(recent)
        if not probs:
            return
        cur = probs.get(self.language, 0.0)
        other = max((l for l in config.ASR_LANGUAGES if l != self.language), key=lambda l: probs.get(l, 0.0))
        p = probs.get(other, 0.0)
        if p >= 0.15 and p >= 3 * cur:
            log.info("live language switch: %s -> %s (%s=%.2f, %s=%.2f)", self.language, other, self.language, cur, other, p)
            self.language = other
            self.prev_hyp = []            # restart agreement in the new language
            self._lang_from = len(self.committed)

    def _trim(self, t_abs: float):
        cut = int((t_abs - self.buffer_start) * SAMPLE_RATE)
        if cut > 0:
            with self._buf_lock:
                self.buffer = self.buffer[cut:]
                self.buffer_start = t_abs

    def process(self) -> tuple[str, str]:
        """Returns (newly committed text, current partial text)."""
        self.samples_at_last_pass = self.samples_total
        t0 = time.time()
        hyp = self._hypothesis()
        buf_len = (self.samples_total / SAMPLE_RATE) - self.buffer_start

        # LocalAgreement-2: commit the longest common prefix with the previous pass
        k = 0
        while k < len(hyp) and k < len(self.prev_hyp) and _norm(hyp[k].text) == _norm(self.prev_hyp[k].text):
            k += 1
        if buf_len > FORCE_COMMIT_S:
            k = len(hyp)
        new_commit, rest = hyp[:k], hyp[k:]
        self.committed.extend(new_commit)
        self.prev_hyp = rest

        before = self.buffer_start
        if self.committed and buf_len > TRIM_AFTER_S:
            self._trim(self.committed[-1].end)
        advanced = self.buffer_start > before
        if not advanced and buf_len > FORCE_COMMIT_S:
            # Stuck: nothing new could be committed (usually a Whisper repetition loop that the
            # loop filter removed). Re-reading the same audio would freeze the transcript, so
            # skip the oldest few seconds and let Whisper start fresh.
            log.warning("live buffer stuck at %.1fs, skipping %.0fs of audio", buf_len, STUCK_SKIP_S)
            self._trim(self.buffer_start + STUCK_SKIP_S)
            self.prev_hyp = []
        elif not advanced and not hyp and buf_len > TRIM_AFTER_S:
            self._trim(self.buffer_start + buf_len - SILENCE_KEEP_S)

        log.info("pass %.2fs on %.1fs buffer, committed %d words", time.time() - t0, buf_len, len(new_commit))
        return _join(new_commit), _join(rest)

    def finish(self) -> str:
        """Final pass on stop: commit everything that is left."""
        if len(self.buffer) < SAMPLE_RATE * 0.3:
            tail = self.prev_hyp
        else:
            tail = self._hypothesis()
        self.committed.extend(tail)
        self.prev_hyp = []
        self.buffer = np.zeros(0, dtype=np.float32)
        return _join(tail)
