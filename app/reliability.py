from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from pathlib import Path
from typing import Any


_log = logging.getLogger(__name__)
_LOCKS_GUARD = threading.Lock()
_PATH_LOCKS: dict[str, threading.RLock] = {}


def _path_lock(path: Path) -> threading.RLock:
    key = str(path.resolve())
    with _LOCKS_GUARD:
        lock = _PATH_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _PATH_LOCKS[key] = lock
        return lock


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(str(path), os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_synced(path: Path, payload: bytes) -> None:
    with path.open("wb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def _temporary_path(target: Path) -> Path:
    return target.with_name(
        f".{target.name}.{os.getpid()}.{threading.get_ident()}.{uuid.uuid4().hex}.tmp"
    )


def atomic_write_json(
    target: Path,
    value: Any,
    *,
    keep_backup: bool = True,
) -> None:
    """Durably replace a JSON file while preserving the last valid generation."""
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = (
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    lock = _path_lock(target)
    with lock:
        temporary = _temporary_path(target)
        backup_temporary: Path | None = None
        try:
            if keep_backup and target.exists():
                current = target.read_bytes()
                try:
                    json.loads(current.decode("utf-8"))
                except (UnicodeDecodeError, ValueError):
                    _log.warning(
                        "Refusing to replace valid backup with corrupt state path=%s",
                        target,
                    )
                else:
                    backup = target.with_suffix(target.suffix + ".bak")
                    backup_temporary = _temporary_path(backup)
                    _write_synced(backup_temporary, current)
                    os.replace(backup_temporary, backup)
                    backup_temporary = None

            _write_synced(temporary, payload)
            os.replace(temporary, target)
            _fsync_directory(target.parent)
        finally:
            temporary.unlink(missing_ok=True)
            if backup_temporary is not None:
                backup_temporary.unlink(missing_ok=True)


def read_json_object(target: Path) -> dict[str, Any]:
    """Read an object, falling back to the last valid generation after corruption."""
    target = Path(target)
    backup = target.with_suffix(target.suffix + ".bak")
    for candidate in (target, backup):
        try:
            value = json.loads(candidate.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            continue
        if isinstance(value, dict):
            if candidate == backup:
                _log.error(
                    "Recovered JSON state from backup primary=%s backup=%s",
                    target,
                    backup,
                )
            return value
    return {}
