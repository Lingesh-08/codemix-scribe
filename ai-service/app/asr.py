"""faster-whisper wrapper shared by the upload endpoint and the live WebSocket."""
import logging
import subprocess
import threading
from dataclasses import dataclass

import numpy as np

from . import cuda_setup  # noqa: F401  (must run before faster_whisper import)
from faster_whisper import WhisperModel, decode_audio

from . import config

log = logging.getLogger("scribe.asr")
SAMPLE_RATE = 16000


@dataclass
class Word:
    start: float  # seconds, relative to the audio passed in
    end: float
    text: str     # includes the leading space, as Whisper emits it


class ASR:
    def __init__(self):
        self.model: WhisperModel | None = None
        self.compute_type = None
        self.gpu_name = None
        self._lock = threading.Lock()  # one GPU, one transcription at a time

    def load(self):
        if not config.MODEL_DIR.exists():
            raise RuntimeError(
                f"Whisper model not found at {config.MODEL_DIR}. Run: python scripts/download_model.py"
            )
        for ct in (config.COMPUTE_TYPE, "int8"):
            try:
                self.model = WhisperModel(str(config.MODEL_DIR), device=config.DEVICE, compute_type=ct)
                self.compute_type = ct
                break
            except Exception as e:  # e.g. int8_float16 unsupported
                log.warning("Loading with compute_type=%s failed: %s", ct, e)
        if self.model is None:
            raise RuntimeError("Could not load the Whisper model")
        self.gpu_name = _gpu_name()
        log.info("Whisper loaded on %s (%s), compute_type=%s", config.DEVICE, self.gpu_name, self.compute_type)

    def pick_language(self, audio: np.ndarray) -> tuple[str, bool]:
        """Fixed ASR_LANGUAGE, or the most likely of ASR_LANGUAGES for this audio.
        Returns (language, confident). Not confident = too little non-English speech to tell."""
        if config.ASR_LANGUAGE:
            return config.ASR_LANGUAGE, True
        probs = self.language_probs(audio)
        if probs is None:
            return config.ASR_LANGUAGES[0], False
        ranked = sorted(config.ASR_LANGUAGES, key=lambda l: probs.get(l, 0.0), reverse=True)
        best = probs.get(ranked[0], 0.0)
        second = probs.get(ranked[1], 0.0) if len(ranked) > 1 else 0.0
        confident = best >= 0.1 and best >= 3 * second
        log.info("language: %s confident=%s (%s)", ranked[0], confident,
                 ", ".join(f"{l}={probs.get(l, 0):.2f}" for l in config.ASR_LANGUAGES))
        return ranked[0], confident

    def language_probs(self, audio: np.ndarray) -> dict | None:
        """Whisper's language probabilities for (up to 30 s of) audio, or None if there is no speech."""
        try:
            with self._lock:
                _, _, probs = self.model.detect_language(audio[: 30 * SAMPLE_RATE], vad_filter=True)
            return dict(probs)
        except Exception as e:  # e.g. no speech found
            log.warning("language detection failed (%s)", e)
            return None

    def _opts(self, language: str, **overrides):
        opts = dict(
            language=language,
            initial_prompt=config.ASR_PROMPTS.get(language),
            task="transcribe",  # never translate
            vad_filter=True,
            beam_size=5,
        )
        opts.update(overrides)
        return opts

    def transcribe_file(self, path: str) -> dict:
        audio = decode_audio(path, sampling_rate=SAMPLE_RATE)  # PyAV: any format
        return self.transcribe_array(audio)

    def transcribe_array(self, audio: np.ndarray, **overrides) -> dict:
        language, _ = self.pick_language(audio)
        with self._lock:
            segments, info = self.model.transcribe(audio, **self._opts(language, **overrides))
            text = " ".join(s.text.strip() for s in segments).strip()
        return {"text": text, "language": info.language, "duration": round(len(audio) / SAMPLE_RATE, 2)}

    def transcribe_words(self, audio: np.ndarray, prompt: str | None, language: str) -> tuple[list[Word], str]:
        """Fast pass with word timestamps, used for live streaming."""
        with self._lock:
            segments, info = self.model.transcribe(
                audio,
                **self._opts(
                    language,
                    beam_size=1,
                    temperature=0.0,  # no slow fallback re-decodes during live passes
                    word_timestamps=True,
                    condition_on_previous_text=False,
                    initial_prompt=prompt,
                    vad_parameters={"min_silence_duration_ms": 500},
                ),
            )
            words = []
            for seg in segments:
                for w in seg.words or []:
                    words.append(Word(w.start, w.end, w.word))
        return words, info.language


def _gpu_name() -> str | None:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        return out.stdout.strip().splitlines()[0] if out.returncode == 0 else None
    except Exception:
        return None


asr = ASR()
