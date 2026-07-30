from datetime import datetime, timezone
from contextlib import closing
import threading
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter

from app.api.runtime import runtime_registry, worker_loop_manager
from app.db import get_connection, init_db
from app.repositories.queue_repo import QueueRepository
from app.repositories.settings_repo import SettingsRepository
from app.repositories.show_repo import ShowRepository
from app.repositories.show_session_repo import ShowSessionRepository
from app.repositories.station_output_repo import StationOutputRepository
from app.repositories.station_repo import StationRepository

router = APIRouter()
_ORIGIN_PROBE_TTL_SECONDS = 5.0
_ORIGIN_PROBE_TIMEOUT_SECONDS = 1.5
_ORIGIN_FAILURE_THRESHOLD = 2
_origin_probe_cache: dict[tuple, dict] = {}
_origin_probe_lock = threading.Lock()


def _normalized_mapping(value) -> dict:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _public_status_summary(
    runtime_state: dict,
    worker_state: dict,
    *,
    icecast_origin_confirmed: bool | None = None,
) -> tuple[str, str]:
    runtime_running = bool(runtime_state.get("running"))
    worker_running = bool(worker_state.get("running"))
    branch_health = _normalized_mapping(runtime_state.get("branch_health"))
    required_outputs = _normalized_mapping(runtime_state.get("required_outputs"))

    required_keys = [
        str(key)
        for key, required in required_outputs.items()
        if bool(required)
    ]
    healthy_required = [
        key for key in required_keys if bool(branch_health.get(key))
    ]

    if not runtime_running and not worker_running:
        return "offline", "Runtime and worker are stopped"

    all_required_healthy = not required_keys or len(healthy_required) == len(required_keys)
    if runtime_running and all_required_healthy:
        if "icecast" in required_keys and icecast_origin_confirmed is False:
            return "degraded", "Runtime is running but the Icecast mount is not reachable"
        if worker_running and not str(worker_state.get("last_error") or "").strip():
            return "live", "Runtime healthy"
        if worker_running:
            return "degraded", "Worker reported an issue"
        return "degraded", "Runtime is running but worker is inactive"

    if runtime_running:
        return "degraded", "Runtime is running but required outputs are degraded"

    return "degraded", "Worker is running without an active runtime"


def _probe_icecast_origin(
    station_id: int,
    output,
    station_settings: dict,
) -> bool | None:
    if output is None or not bool(output["icecast_enabled"]):
        return None
    host = str(output["icecast_host"] or "").strip()
    mount = str(output["icecast_mount"] or "").strip()
    if not host or not mount:
        return None
    if not mount.startswith("/"):
        mount = f"/{mount}"
    try:
        port = int(output["icecast_port"] or 0)
    except (TypeError, ValueError):
        return None
    if port <= 0:
        return None
    tls_enabled = str(
        station_settings.get("icecast_tls_enabled", "false")
    ).strip().lower() in {"1", "true", "yes", "on"}
    scheme = "https" if tls_enabled else "http"
    key = (int(station_id), scheme, host.lower(), port, mount)
    now = time.monotonic()
    with _origin_probe_lock:
        cached = dict(_origin_probe_cache.get(key, {}))
        if cached and now - float(cached.get("checked_at", 0.0)) < _ORIGIN_PROBE_TTL_SECONDS:
            return bool(cached.get("confirmed"))

    request = Request(
        f"{scheme}://{host}:{port}{quote(mount, safe='/')}",
        headers={
            "Icy-MetaData": "1",
            "Range": "bytes=0-0",
            "User-Agent": "RadioTEDU OnAir health probe",
        },
    )
    ok = False
    try:
        with urlopen(request, timeout=_ORIGIN_PROBE_TIMEOUT_SECONDS) as response:
            ok = int(getattr(response, "status", 200) or 200) in {200, 206}
    except Exception:
        ok = False

    with _origin_probe_lock:
        previous = dict(_origin_probe_cache.get(key, {}))
        failures = 0 if ok else int(previous.get("failures", 0)) + 1
        confirmed = bool(
            ok
            or (
                previous.get("confirmed")
                and failures < _ORIGIN_FAILURE_THRESHOLD
            )
        )
        _origin_probe_cache[key] = {
            "checked_at": now,
            "confirmed": confirmed,
            "failures": failures,
        }
    return confirmed


def _public_now_playing(conn, station_id: int) -> dict | None:
    current = QueueRepository(conn).current_playing(station_id)
    if current is None:
        return None
    started_at = _public_started_at_iso(current["started_at"])
    return {
        "title": str(current["title"] or ""),
        "artist": str(current["artist"] or ""),
        "track_type": str(current["track_type"] or "music"),
        "duration": float(current["duration"] or 0.0),
        "started_at": started_at,
    }


def _public_started_at_iso(value) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    normalized = raw.replace(" ", "T")
    try:
        started_at = datetime.fromisoformat(normalized.replace("Z", "+00:00"))
    except ValueError:
        return None
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    return started_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _public_active_show_name(conn, station_id: int) -> str | None:
    session = ShowSessionRepository(conn).get_active_for_station(station_id)
    if not session:
        return None
    show = ShowRepository(conn).get(int(session["show_id"]))
    if not show:
        return None
    return str(show.get("name") or "") or None


@router.get("/api/public/stations")
def list_public_station_summaries():
    init_db()
    with closing(get_connection()) as conn:
        stations = []
        station_outputs = StationOutputRepository(conn)
        settings = SettingsRepository(conn)
        for station in StationRepository(conn).list_all():
            station_id = int(station["id"])
            try:
                runtime_state = dict(runtime_registry.status(station_id))
            except Exception:
                runtime_state = {}
            try:
                worker_state = dict(worker_loop_manager.status(station_id))
            except Exception:
                worker_state = {}

            origin_confirmed = None
            required_outputs = _normalized_mapping(
                runtime_state.get("required_outputs")
            )
            if (
                bool(runtime_state.get("running"))
                and bool(required_outputs.get("icecast"))
            ):
                origin_confirmed = _probe_icecast_origin(
                    station_id,
                    station_outputs.get_raw(station_id),
                    settings.get_station(station_id),
                )
            status, status_reason = _public_status_summary(
                runtime_state,
                worker_state,
                icecast_origin_confirmed=origin_confirmed,
            )
            stations.append(
                {
                    "id": station_id,
                    "name": str(station["name"] or ""),
                    "status": status,
                    "status_reason": status_reason,
                    "now_playing": _public_now_playing(conn, station_id),
                    "active_show_name": _public_active_show_name(conn, station_id),
                }
            )
        return {"stations": stations}
