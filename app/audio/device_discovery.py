import re
import subprocess

from app.runtime_paths import require_binary


def parse_ffmpeg_dshow_audio_devices(stderr_output: str) -> list[str]:
    devices: list[str] = []
    pattern = re.compile(r'\[dshow @ .*?\]\s+"(.+?)"')
    for line in (stderr_output or "").splitlines():
        match = pattern.search(line)
        if not match:
            continue
        candidate = match.group(1).strip()
        if candidate and not candidate.startswith("Alternative name"):
            devices.append(candidate)
    # Preserve order, de-duplicate.
    seen = set()
    out: list[str] = []
    for item in devices:
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def list_output_devices(ffmpeg_bin: str | None = None) -> list[str]:
    resolved = ffmpeg_bin or require_binary("ffmpeg.exe")
    cmd = [ffmpeg_bin, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"]
    cmd[0] = resolved
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    return parse_ffmpeg_dshow_audio_devices(proc.stderr)
