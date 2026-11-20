"""Transcribe the 4 code-switched test files with several settings and save the outputs.

Run from ai-service/:   .venv\\Scripts\\python scripts\\test_asr.py
Outputs:                test_outputs/<file>__<setting>.txt  and  test_outputs/summary.md

The summary shows *script* statistics only (how much Tamil script vs Latin script
is kept). It does not measure accuracy: read the transcripts to judge that."""
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import cuda_setup  # noqa: E402,F401
from faster_whisper import WhisperModel, decode_audio  # noqa: E402

from app import config  # noqa: E402

import os  # noqa: E402

# Folder with the 4 test recordings; set TEST_AUDIO_DIR in ai-service/.env (kept out of git).
AUDIO_DIR = Path(os.getenv("TEST_AUDIO_DIR", "test_audio"))
FILES = ["Audio 1.mpeg", "Audio 2.mpeg", "Audio  3.mpeg", "Audio 4.mpeg"]
PROMPT = "Doctor, எனக்கு two weeks-ஆ cough இருக்கு. Meeting-க்கு late ஆயிடுச்சு, sorry."
SETTINGS = {
    "auto": dict(language=None),
    "ta": dict(language="ta"),
    "auto_prompt": dict(language=None, initial_prompt=PROMPT),
    "ta_prompt": dict(language="ta", initial_prompt=PROMPT),
}
OUT = ROOT / "test_outputs"


def script_stats(text: str):
    words = text.split()
    tamil = sum(1 for w in words if re.search(r"[\u0B80-\u0BFF]", w))
    latin = sum(1 for w in words if re.search(r"[A-Za-z]", w))
    deva = sum(1 for w in words if re.search(r"[\u0900-\u097F]", w))
    return len(words), tamil, latin, deva


def main():
    OUT.mkdir(exist_ok=True)
    model = None
    for ct in (config.COMPUTE_TYPE, "int8"):
        try:
            model = WhisperModel(str(config.MODEL_DIR), device=config.DEVICE, compute_type=ct)
            print(f"Loaded model ({config.DEVICE}, {ct})")
            break
        except Exception as e:
            print(f"compute_type={ct} failed: {e}")
    if model is None:
        sys.exit("Could not load model. Did you run scripts/download_model.py?")

    rows = []
    for fname in FILES:
        audio = decode_audio(str(AUDIO_DIR / fname), sampling_rate=16000)
        dur = len(audio) / 16000
        for name, opts in SETTINGS.items():
            t0 = time.time()
            segments, info = model.transcribe(audio, task="transcribe", vad_filter=True, beam_size=5, **opts)
            text = " ".join(s.text.strip() for s in segments).strip()
            secs = time.time() - t0
            stem = fname.replace(" ", "_").replace(".mpeg", "")
            (OUT / f"{stem}__{name}.txt").write_text(text, encoding="utf-8")
            n, ta, la, dv = script_stats(text)
            rows.append((fname, name, info.language, f"{dur:.0f}s", f"{secs:.1f}s", n, ta, la, dv))
            print(f"\n=== {fname} | {name} | detected={info.language} | {secs:.1f}s ===\n{text}")

    lines = ["| file | setting | detected | audio | time | words | Tamil-script words | Latin words | Devanagari words |",
             "|---|---|---|---|---|---|---|---|---|"]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    (OUT / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n" + "\n".join(lines))
    print(f"\nSaved to {OUT}")


if __name__ == "__main__":
    main()
