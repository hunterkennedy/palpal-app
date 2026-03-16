import os
import shutil
import sys


def yt_dlp_path() -> str:
    """Return the yt-dlp executable path, checking PATH then the active venv."""
    found = shutil.which("yt-dlp")
    if found:
        return found
    venv_bin = os.path.join(os.path.dirname(sys.executable), "yt-dlp")
    if os.path.isfile(venv_bin):
        return venv_bin
    raise FileNotFoundError("yt-dlp not found in PATH or venv")
