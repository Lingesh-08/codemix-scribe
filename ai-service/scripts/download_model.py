"""Download faster-whisper large-v3-turbo (~1.6 GB) into ai-service/models/ once."""
from pathlib import Path

from faster_whisper.utils import download_model

target = Path(__file__).resolve().parent.parent / "models" / "faster-whisper-large-v3-turbo"
target.mkdir(parents=True, exist_ok=True)
print(f"Downloading large-v3-turbo to {target} ...")
path = download_model("large-v3-turbo", output_dir=str(target))
print("Done:", path)
