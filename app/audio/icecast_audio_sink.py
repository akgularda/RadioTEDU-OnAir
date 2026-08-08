import http.client
import logging
import queue
import ssl
import subprocess
import threading
import time
from typing import Callable

from app.audio.ffmpeg_pipeline import build_ffmpeg_icecast_sink_cmd
from app.audio.gst_pipeline import StationPipelineConfig

_log = logging.getLogger(__name__)

_PCM_QUEUE_MAX_CHUNKS = 64


def probe_icecast_mount(cfg: StationPipelineConfig, timeout: float = 2.0) -> bool:
    """Confirm that the configured source has created a readable mount."""

    host = str(cfg.icecast_host or "").strip()
    port = int(cfg.icecast_port or 0)
    mount = str(cfg.icecast_mount or "").strip()
    if not host or port <= 0 or not mount:
        return False
    if not mount.startswith("/"):
        mount = f"/{mount}"

    connection = None
    try:
        if bool(getattr(cfg, "icecast_tls_enabled", False)):
            connection = http.client.HTTPSConnection(
                host,
                port,
                timeout=max(0.1, float(timeout)),
                context=ssl.create_default_context(),
            )
        else:
            connection = http.client.HTTPConnection(
                host,
                port,
                timeout=max(0.1, float(timeout)),
            )
        connection.request(
            "GET",
            mount,
            headers={
                "User-Agent": "RadioTEDU-OnAir-Mount-Probe/1.0",
                "Icy-MetaData": "0",
                "Connection": "close",
            },
        )
        response = connection.getresponse()
        content_type = str(response.getheader("Content-Type") or "").lower()
        if int(response.status) not in {200, 206}:
            return False
        if not (
            content_type.startswith("audio/")
            or content_type in {"application/ogg", "video/ogg"}
        ):
            return False
        return bool(response.read(1))
    except (OSError, http.client.HTTPException, ssl.SSLError):
        return False
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass


class IcecastAudioSink:
    def __init__(
        self,
        ffmpeg_bin: str,
        spawn_process: Callable[..., subprocess.Popen],
        *,
        mount_probe: Callable[[StationPipelineConfig], bool] | None = None,
        probe_interval_sec: float = 5.0,
        probe_warmup_sec: float = 3.0,
        probe_failure_threshold: int = 2,
    ) -> None:
        self.ffmpeg_bin = ffmpeg_bin
        self._spawn_process = spawn_process
        self._process = None
        self._signature = None
        self._cfg = None
        self._mount_probe = mount_probe
        self._probe_interval_sec = max(0.05, float(probe_interval_sec))
        self._probe_warmup_sec = max(0.0, float(probe_warmup_sec))
        self._probe_failure_threshold = max(1, int(probe_failure_threshold))
        self._probe_stop = threading.Event()
        self._probe_thread = None
        self._probe_lock = threading.Lock()
        self._mount_healthy = None
        self._probe_failures = 0
        self._pcm_queue: queue.Queue[bytes] = queue.Queue(
            maxsize=_PCM_QUEUE_MAX_CHUNKS
        )
        self._writer_stop = threading.Event()
        self._writer_thread = None
        self._writer_lock = threading.Lock()
        self._writer_failed = False
        self._writer_backpressured = False
        self._writer_dropped_chunks = 0
        self._last_write_monotonic = None

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
        process_running = bool(self._process and self._process.poll() is None)
        if not process_running:
            return False
        with self._probe_lock:
            return self._mount_healthy is not False

    def accepts_input(self) -> bool:
        """Return whether the encoder process can accept queued PCM.

        Mount health is deliberately excluded.  A restarted FFmpeg encoder
        needs PCM before it can create the remote mount, so gating input on a
        successful mount probe creates an unrecoverable deadlock.
        """

        return bool(
            self._process
            and self._process.poll() is None
            and self.stdin is not None
        )

    def write_pcm(self, chunk: bytes) -> bool:
        """Queue PCM without allowing a blocked network encoder to stall playout."""

        if not chunk or not self.accepts_input():
            return False
        payload = bytes(chunk)
        try:
            self._pcm_queue.put_nowait(payload)
        except queue.Full:
            with self._writer_lock:
                self._writer_backpressured = True
                self._writer_dropped_chunks += 1
            return False
        return True

    def health_snapshot(self) -> dict:
        with self._probe_lock, self._writer_lock:
            last_write_age = (
                None
                if self._last_write_monotonic is None
                else max(0.0, time.monotonic() - self._last_write_monotonic)
            )
            return {
                "process_running": bool(
                    self._process and self._process.poll() is None
                ),
                "mount_healthy": self._mount_healthy,
                "consecutive_probe_failures": int(self._probe_failures),
                "writer_running": bool(
                    self._writer_thread and self._writer_thread.is_alive()
                ),
                "writer_failed": bool(self._writer_failed),
                "writer_backpressured": bool(self._writer_backpressured),
                "queued_pcm_chunks": int(self._pcm_queue.qsize()),
                "dropped_pcm_chunks": int(self._writer_dropped_chunks),
                "last_write_age_seconds": (
                    None if last_write_age is None else round(last_write_age, 3)
                ),
            }

    def _clear_pcm_queue(self) -> None:
        while True:
            try:
                self._pcm_queue.get_nowait()
            except queue.Empty:
                return

    def _start_writer_worker(self) -> None:
        self._writer_stop.clear()
        self._clear_pcm_queue()
        with self._writer_lock:
            self._writer_failed = False
            self._writer_backpressured = False
            self._writer_dropped_chunks = 0
            self._last_write_monotonic = None

        def run() -> None:
            while not self._writer_stop.is_set():
                try:
                    chunk = self._pcm_queue.get(timeout=0.2)
                except queue.Empty:
                    continue
                stdin = self.stdin
                if stdin is None or not self.accepts_input():
                    continue
                try:
                    stdin.write(chunk)
                    flush = getattr(stdin, "flush", None)
                    if callable(flush):
                        flush()
                    with self._writer_lock:
                        self._writer_failed = False
                        self._writer_backpressured = False
                        self._last_write_monotonic = time.monotonic()
                except Exception:
                    with self._writer_lock:
                        self._writer_failed = True
                    return

        self._writer_thread = threading.Thread(
            target=run,
            name="icecast-pcm-writer",
            daemon=True,
        )
        self._writer_thread.start()

    def _start_probe_worker(
        self,
        cfg: StationPipelineConfig,
        *,
        preserve_failure_state: bool = False,
    ) -> None:
        if self._mount_probe is None:
            return
        self._probe_stop.clear()
        if not preserve_failure_state:
            with self._probe_lock:
                self._mount_healthy = None
                self._probe_failures = 0

        def run() -> None:
            if self._probe_stop.wait(self._probe_warmup_sec):
                return
            while not self._probe_stop.is_set():
                try:
                    healthy = bool(self._mount_probe(cfg))
                except Exception:
                    healthy = False
                with self._probe_lock:
                    if healthy:
                        self._probe_failures = 0
                        self._mount_healthy = True
                    else:
                        self._probe_failures += 1
                        if self._probe_failures >= self._probe_failure_threshold:
                            self._mount_healthy = False
                if self._probe_stop.wait(self._probe_interval_sec):
                    return

        self._probe_thread = threading.Thread(
            target=run,
            name="icecast-mount-probe",
            daemon=True,
        )
        self._probe_thread.start()

    def ensure_started(self, cfg: StationPipelineConfig):
        signature = self._cfg_signature(cfg)
        if self.is_running() and self.stdin is not None and self._signature == signature:
            return self._process
        with self._probe_lock:
            preserve_failure_state = bool(
                self._signature == signature and self._mount_healthy is False
            )
        self.stop(preserve_probe_state=preserve_failure_state)
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
        self._cfg = cfg
        self._start_writer_worker()
        self._start_probe_worker(
            cfg,
            preserve_failure_state=preserve_failure_state,
        )
        return self._process

    def stop(self, *, preserve_probe_state: bool = False) -> None:
        self._probe_stop.set()
        self._writer_stop.set()
        proc = self._process
        self._process = None
        self._signature = None
        self._cfg = None
        stdin = getattr(proc, "stdin", None) if proc is not None else None
        # On Windows, closing a pipe while another writer thread is flushing
        # can block indefinitely. Stop FFmpeg first so the pipe can be closed
        # without leaving a source client connected to Icecast.
        if proc is not None and proc.poll() is None:
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
        if self._probe_thread is not None:
            self._probe_thread.join(timeout=3.0)
        self._probe_thread = None
        if self._writer_thread is not None:
            self._writer_thread.join(timeout=3.0)
        self._writer_thread = None
        self._clear_pcm_queue()
        if not preserve_probe_state:
            with self._probe_lock:
                self._mount_healthy = None
                self._probe_failures = 0
