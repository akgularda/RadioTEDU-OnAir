from __future__ import annotations

import hashlib
import os
import sqlite3
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.config import get_db_path
from app.db import get_connection, init_db
from app.runtime_paths import get_data_dir
from app.security.credential_vault import protect_data, unprotect_data

_HEADER = b"ONAIR-DPAPI-1\n"
_RETENTION = {"hourly": 48, "daily": 30, "monthly": 12}


class RecoveryPointService:
    def __init__(self):
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def root(self) -> Path:
        return get_data_dir() / "recovery-points"

    def _backup_sqlite(self, target: Path) -> None:
        source = sqlite3.connect(str(get_db_path()), timeout=30)
        destination = sqlite3.connect(str(target), timeout=30)
        try:
            source.backup(destination)
            row = destination.execute("PRAGMA integrity_check").fetchone()
            if not row or str(row[0]).lower() != "ok":
                raise RuntimeError("backup_integrity_failed")
        finally:
            destination.close()
            source.close()

    def create(self, tier: str = "hourly") -> dict:
        normalized = str(tier).lower()
        if normalized not in _RETENTION:
            raise ValueError("invalid_recovery_tier")
        init_db()
        with self._lock:
            now = datetime.now(timezone.utc)
            directory = self.root / normalized
            directory.mkdir(parents=True, exist_ok=True)
            name = now.strftime("%Y%m%dT%H%M%SZ") + ".db.dpapi"
            final_path = directory / name
            fd, temporary_name = tempfile.mkstemp(prefix="onair-backup-", suffix=".db", dir=str(directory))
            os.close(fd)
            temporary = Path(temporary_name)
            try:
                self._backup_sqlite(temporary)
                raw = temporary.read_bytes()
                protected = protect_data(raw) if os.name == "nt" else raw
                final_path.write_bytes((_HEADER if os.name == "nt" else b"ONAIR-PLAIN-TEST\n") + protected)
                digest = hashlib.sha256(final_path.read_bytes()).hexdigest()
                conn = get_connection()
                try:
                    conn.execute(
                        "INSERT INTO recovery_points(tier, file_path, sha256, size_bytes, integrity_status, verified_at) "
                        "VALUES (?, ?, ?, ?, 'ok', CURRENT_TIMESTAMP)",
                        (normalized, str(final_path), digest, final_path.stat().st_size),
                    )
                    conn.commit()
                finally:
                    conn.close()
                self._prune(normalized)
                return {"tier": normalized, "file_path": str(final_path), "sha256": digest, "verified": True}
            finally:
                temporary.unlink(missing_ok=True)

    def verify_restore(self, path: str | Path) -> dict:
        source = Path(path).resolve()
        raw = source.read_bytes()
        if raw.startswith(_HEADER):
            database = unprotect_data(raw[len(_HEADER) :])
        elif raw.startswith(b"ONAIR-PLAIN-TEST\n"):
            database = raw[len(b"ONAIR-PLAIN-TEST\n") :]
        else:
            raise RuntimeError("unknown_recovery_format")
        fd, name = tempfile.mkstemp(prefix="onair-restore-test-", suffix=".db")
        os.close(fd)
        temporary = Path(name)
        try:
            temporary.write_bytes(database)
            conn = sqlite3.connect(str(temporary))
            try:
                row = conn.execute("PRAGMA integrity_check").fetchone()
                valid = bool(row and str(row[0]).lower() == "ok")
            finally:
                conn.close()
            return {"valid": valid, "path": str(source)}
        finally:
            temporary.unlink(missing_ok=True)

    def _prune(self, tier: str) -> None:
        files = sorted((self.root / tier).glob("*.db.dpapi"), key=lambda p: p.stat().st_mtime, reverse=True)
        for stale in files[_RETENTION[tier] :]:
            stale.unlink(missing_ok=True)

    def start(self) -> None:
        if self._thread is not None or os.getenv("PYTEST_CURRENT_TEST") or os.getenv("CLEANROOM_DISABLE_RECOVERY_POINTS", "").lower() in {"1", "true", "yes"}:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="onair-recovery-points", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        last_hour = last_day = last_month = ""
        while not self._stop.wait(5):
            now = datetime.now(timezone.utc)
            try:
                if now.strftime("%Y%m%d%H") != last_hour:
                    self.create("hourly")
                    last_hour = now.strftime("%Y%m%d%H")
                if now.strftime("%Y%m%d") != last_day:
                    self.create("daily")
                    last_day = now.strftime("%Y%m%d")
                if now.strftime("%Y%m") != last_month:
                    self.create("monthly")
                    last_month = now.strftime("%Y%m")
            except Exception:
                pass
            self._stop.wait(3600)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        self._thread = None


recovery_point_service = RecoveryPointService()
