from datetime import datetime, timezone
from contextlib import closing

from fastapi import APIRouter

from app.api.runtime import runtime_registry, worker_loop_manager
from app.db import get_connection, init_db
from app.repositories.queue_repo import QueueRepository
from app.repositories.show_repo import ShowRepository
from app.repositories.show_session_repo import ShowSessionRepository
from app.repositories.station_repo import StationRepository

router = APIRouter()


def _normalized_mapping(value) -> dict:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _public_status_summary(runtime_state: dict, worker_state: dict) -> tuple[str, str]:
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
        if worker_running and not str(worker_state.get("last_error") or "").strip():
            return "live", "Runtime healthy"
        if worker_running:
            return "degraded", "Worker reported an issue"
        return "degraded", "Runtime is running but worker is inactive"

    if runtime_running:
        return "degraded", "Runtime is running but required outputs are degraded"

    return "degraded", "Worker is running without an active runtime"


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

            status, status_reason = _public_status_summary(runtime_state, worker_state)
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
