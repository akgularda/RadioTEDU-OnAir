import logging
import subprocess
import time
from typing import Callable

from app.audio.ffmpeg_pipeline import build_ffmpeg_icecast_sink_cmd
from app.audio.gst_pipeline import StationPipelineConfig

_log = logging.getLogger(__name__)


class IcecastAudioSink:
    def __init__(
        self,
        ffmpeg_bin: str,
        spawn_process: Callable[..., subprocess.Popen],
    ) -> None:
        self.ffmpeg_bin = ffmpeg_bin
        self._spawn_process = spawn_process
        self._process = None
        self._signature = None

    @property
    def process(self):
        return self._process

    @property
    def stdin(self):
        if not self._process:
            return None
        return getattr(self._process, "stdin", None)

    def _cfg_signature(self, cfg: StationPipelineConfig) -> tuple[str, int, str, str, str]:
        mount = str(cfg.icecast_mount or "").strip()
        if mount and not mount.startswith("/"):
            mount = f"/{mount}"
        return (
            str(cfg.icecast_host or "").strip(),
            int(cfg.icecast_port),
            mount or "/stream",
            str(cfg.icecast_user or "").strip(),
            str(cfg.icecast_password or ""),
        )

    def is_running(self) -> bool:
        return bool(self._process and self._process.poll() is None)

    def ensure_started(self, cfg: StationPipelineConfig):
        signature = self._cfg_signature(cfg)
        if self.is_running() and self.stdin is not None and self._signature == signature:
            return self._process
        self.stop()
        cmd = build_ffmpeg_icecast_sink_cmd(cfg, self.ffmpeg_bin)
        _log.info(
            "Starting Icecast sink host=%s port=%s mount=%s user=%s",
            cfg.icecast_host,
            cfg.icecast_port,
            cfg.icecast_mount,
            cfg.icecast_user,
        )
        self._process = self._spawn_process(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            # FFmpeg can keep retrying a failed Icecast handshake for a long
            # time.  An unread PIPE eventually fills and freezes the encoder
            # while the process still appears alive.  Discard stderr here;
            # connection health is reported separately without risking secret
            # bearing command lines in logs.
            stderr=subprocess.DEVNULL,
        )
        # Give FFmpeg a moment to start; if it dies immediately (bad password,
        # unreachable host) we should report failure rather than returning a dead process.
        time.sleep(0.3)
        if self._process.poll() is not None:
            _log.warning(
                "Icecast sink exited during startup code=%s host=%s port=%s "
                "mount=%s user=%s",
                self._process.returncode,
                cfg.icecast_host,
                cfg.icecast_port,
                cfg.icecast_mount,
                cfg.icecast_user,
            )
            self._process = None
            self._signature = None
            raise RuntimeError("Icecast sink process exited immediately")
        self._signature = signature
        return self._process

    def stop(self) -> None:
        if not self._process:
            self._signature = None
            return
        proc = self._process
        self._process = None
        self._signature = None
        stdin = getattr(proc, "stdin", None)
        # On Windows, closing a pipe while another writer thread is flushing
        # can block indefinitely. Stop FFmpeg first so the pipe can be closed
        # without leaving a source client connected to Icecast.
        if proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
            try:
                proc.wait(timeout=3)
            except Exception:
                try:
                    proc.kill()
                    proc.wait(timeout=3)
                except Exception:
                    pass
        if stdin is not None:
            try:
                stdin.close()
            except Exception:
                pass
