"""Make the CUDA DLLs from the nvidia-cublas-cu12 / nvidia-cudnn-cu12 pip packages
visible to ctranslate2 on Windows. Import this BEFORE importing faster_whisper."""
import os
import sys
from pathlib import Path


def add_cuda_dll_dirs() -> list[str]:
    if os.name != "nt":
        return []
    added = []
    for sp in sys.path:
        nvidia = Path(sp) / "nvidia"
        if not nvidia.is_dir():
            continue
        for sub in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc"):
            bin_dir = nvidia / sub / "bin"
            if bin_dir.is_dir():
                os.add_dll_directory(str(bin_dir))
                # ctranslate2 loads some DLLs lazily via the normal search path too
                os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
                added.append(str(bin_dir))
    return added


add_cuda_dll_dirs()
