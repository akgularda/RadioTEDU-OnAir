from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.audio.live_mic_registry import live_mic_registry
from app.db import get_connection, init_db
from app.engine.continuity import resolve_station_fallback_uri
from app.engine.playout_state import PlayoutStateService
from app.engine.station_worker import StationWorker
from app.engine.runtime_registry import StationRuntimeRegistry
from app.engine.runtime_supervisor import RuntimeSupervisor
from app.engine.worker_loop import StationWorkerLoopManager
from app.ws.broadcaster import broadcaster

router = APIRouter()
runtime_registry = StationRuntimeRegistry(live_mic_registry=live_mic_registry)
runtime_supervisor = RuntimeSupervisor(runtime_registry)
worker_loop_manager = StationWorkerLoopManager(
    runtime_registry=runtime_registry,
    runtime_supervisor=runtime_supervisor,
)


class RuntimeStartPayload(BaseModel):
    input_uri: str
    stream_title: str = ""
    stream_artist: str = ""


class RuntimeTickPayload(BaseModel):
    fallback_uri: str = ""


class RuntimeLoopStartPayload(BaseModel):
    fallback_uri: str = ""
    interval_sec: float = 1.0


def _station_broadcast_autostart_enabled(conn, station_id: int) -> bool:
    row = conn.execute(
        "SELECT value FROM station_settings "
        "WHERE station_id=? AND key='broadcast_autostart_enabled'",
        (int(station_id),),
    ).fetchone()
    value = str(row["value"] if row else "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _require_unattended_start_authorization(station_id: int) -> None:
    """Reject automatic start paths unless the operator explicitly opted in."""
    conn = get_connection()
    try:
        authorized = _station_broadcast_autostart_enabled(conn, station_id)
    finally:
        conn.close()
    if not authorized:
        raise HTTPException(
            status_code=409,
            detail=(
                "operator_authorization_required: automatic callers cannot "
                "start this station while broadcast restart is disabled"
            ),
        )


def _start_runtime_loop(station_id: int, payload: RuntimeLoopStartPayload) -> dict:
    conn = get_connection()
    try:
        fallback_uri = resolve_station_fallback_uri(
            station_id=station_id,
            conn=conn,
            requested=payload.fallback_uri,
        )
    finally:
        conn.close()
    worker_loop_manager.start(
        station_id=station_id,
        fallback_uri=fallback_uri,
        interval_sec=payload.interval_sec,
    )
    response = _runtime_loop_payload(station_id)
    _broadcast_runtime_events(station_id)
    return response


def _preserve_operator_playout(station_id: int) -> dict:
    """Requeue interrupted items without deleting or advancing the program."""
    init_db()
    conn = get_connection()
    try:
        sid = int(station_id)
        state_service = PlayoutStateService(conn)
        previous = state_service.get_current(sid)
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) AS c FROM queue_items "
            "WHERE station_id=? AND status IN ('pending','playing')",
            (sid,),
        )
        queue_before = int(cur.fetchone()["c"] or 0)
        cur.execute(
            "UPDATE queue_items SET status='pending', started_at=NULL, finished_at=NULL "
            "WHERE station_id=? AND status='playing'",
            (sid,),
        )
        queue_requeued = int(cur.rowcount or 0)
        cur.execute(
            "UPDATE ad_break_items SET status='pending', started_at=NULL, finished_at=NULL "
            "WHERE station_id=? AND status='playing'",
            (sid,),
        )
        ads_requeued = int(cur.rowcount or 0)
        cur.execute(
            "UPDATE schedule_items SET status='pending' "
            "WHERE station_id=? AND status='playing'",
            (sid,),
        )
        schedules_requeued = int(cur.rowcount or 0)
        state_service.set_current(
            sid,
            "none",
            None,
            reason="operator_stop_preserve_playlist",
        )
        cur.execute(
            "SELECT COUNT(*) AS c FROM queue_items "
            "WHERE station_id=? AND status IN ('pending','playing')",
            (sid,),
        )
        queue_after = int(cur.fetchone()["c"] or 0)
        return {
            "playlist_preserved": queue_after == queue_before,
            "queue_items_before": queue_before,
            "queue_items_after": queue_after,
            "queue_items_requeued": queue_requeued,
            "ads_requeued": ads_requeued,
            "schedules_requeued": schedules_requeued,
            "previous_source": str(previous.get("source") or "none"),
            "previous_item_id": previous.get("item_id"),
            "resume_behavior": (
                "The interrupted item remains in place and restarts from its beginning."
            ),
        }
    finally:
        conn.close()


def _runtime_status_payload(station_id: int) -> dict:
    payload = dict(runtime_registry.status(station_id=station_id))
    payload["worker_loop"] = worker_loop_manager.status(station_id=station_id)
    return payload


def _runtime_loop_payload(station_id: int) -> dict:
    payload = dict(worker_loop_manager.status(station_id=station_id))
    payload["runtime"] = runtime_registry.status(station_id=station_id)
    return payload


def _broadcast_runtime_events(station_id: int, *, include_queue: bool = False, include_track: bool = False) -> None:
    try:
        from app.api.legacy import legacy_liquidsoap_status, list_legacy_queue

        status_payload = legacy_liquidsoap_status(station_id=station_id)
        broadcaster.on_runtime_updated(station_id, status_payload)
        broadcaster.on_engine_event(station_id, status_payload)
        broadcaster.on_health_changed(
            station_id,
            {
                "station_id": int(station_id),
                "active_station_id": int(status_payload.get("active_station_id") or station_id),
                "engine_running": bool(status_payload.get("alive")),
                "liquidsoap_connected": bool(status_payload.get("liquidsoap_connected")),
            },
        )
        if include_track:
            broadcaster.on_track_changed(station_id, status_payload)
        if include_queue:
            broadcaster.on_queue_changed(station_id, list_legacy_queue(station_id))
    except Exception:
        # WebSocket fan-out must never break HTTP endpoints.
        pass


@router.post("/api/runtime/{station_id}/start")
def start_runtime(station_id: int, payload: RuntimeStartPayload):
    _require_unattended_start_authorization(station_id)
    return _start_runtime(station_id, payload)


@router.post("/api/runtime/{station_id}/operator-start-track")
def operator_start_runtime(station_id: int, payload: RuntimeStartPayload):
    """Explicit operator path for applying or starting the selected program item."""
    return _start_runtime(station_id, payload)


def _start_runtime(station_id: int, payload: RuntimeStartPayload) -> dict:
    try:
        runtime_registry.start_station(
            station_id=station_id,
            input_uri=payload.input_uri,
            stream_title=payload.stream_title,
            stream_artist=payload.stream_artist,
        )
        response = _runtime_status_payload(station_id)
        _broadcast_runtime_events(station_id, include_track=True)
        return response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"GStreamer runtime binary not found: {exc}",
        ) from exc


@router.post("/api/runtime/{station_id}/stop")
def stop_runtime(station_id: int):
    runtime_registry.stop_station(station_id=station_id)
    response = _runtime_status_payload(station_id)
    _broadcast_runtime_events(station_id)
    return response


@router.post("/api/runtime/{station_id}/operator-stop")
def operator_stop_runtime(station_id: int):
    loop_state = worker_loop_manager.stop(station_id=station_id)
    if bool(loop_state.get("running")):
        raise HTTPException(
            status_code=409,
            detail="Scheduler did not stop; playlist state was not changed.",
        )
    runtime_before = runtime_registry.status(station_id=station_id)
    runtime_registry.stop_station(station_id=station_id)
    preservation = _preserve_operator_playout(station_id)
    response = _runtime_status_payload(station_id)
    response.update(preservation)
    response["runtime_was_running"] = bool(
        runtime_before.get("running") or runtime_before.get("program_running")
    )
    _broadcast_runtime_events(station_id, include_queue=True, include_track=True)
    return response


@router.get("/api/runtime/{station_id}/status")
def runtime_status(station_id: int):
    return _runtime_status_payload(station_id)


@router.get("/api/runtime/{station_id}/transitions")
def runtime_transitions(station_id: int, limit: int = 100):
    init_db()
    conn = get_connection()
    try:
        return {
            "station_id": int(station_id),
            "items": PlayoutStateService(conn).list_recent(
                int(station_id),
                limit=limit,
            ),
        }
    finally:
        conn.close()


@router.post("/api/runtime/{station_id}/supervise")
def supervise_runtime(station_id: int):
    _require_unattended_start_authorization(station_id)
    return runtime_supervisor.evaluate_station(station_id=station_id)


@router.post("/api/runtime/{station_id}/operator-supervise")
def operator_supervise_runtime(station_id: int):
    """Explicit operator path for an immediate recovery evaluation."""
    return runtime_supervisor.evaluate_station(station_id=station_id)


@router.post("/api/runtime/{station_id}/tick")
def tick_runtime(station_id: int, payload: RuntimeTickPayload):
    _require_unattended_start_authorization(station_id)
    try:
        conn = get_connection()
        try:
            fallback_uri = resolve_station_fallback_uri(
                station_id=station_id,
                conn=conn,
                requested=payload.fallback_uri,
            )
        finally:
            conn.close()
        worker = StationWorker(
            station_id=station_id,
            runtime_registry=runtime_registry,
            fallback_uri=fallback_uri,
        )
        response = worker.process_once()
        _broadcast_runtime_events(
            station_id,
            include_queue=True,
            include_track=bool(response.get("input_uri")),
        )
        return response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"GStreamer runtime binary not found: {exc}",
        ) from exc


@router.post("/api/runtime/{station_id}/loop/start")
def start_runtime_loop(station_id: int, payload: RuntimeLoopStartPayload):
    _require_unattended_start_authorization(station_id)
    return _start_runtime_loop(station_id, payload)


@router.post("/api/runtime/{station_id}/operator-start")
def operator_start_runtime_loop(station_id: int, payload: RuntimeLoopStartPayload):
    """Explicit operator Start path; never available to unattended guards."""
    return _start_runtime_loop(station_id, payload)


@router.post("/api/runtime/{station_id}/loop/stop")
def stop_runtime_loop(station_id: int):
    worker_loop_manager.stop(station_id=station_id)
    response = _runtime_loop_payload(station_id)
    _broadcast_runtime_events(station_id)
    return response


@router.get("/api/runtime/{station_id}/loop/status")
def runtime_loop_status(station_id: int):
    return _runtime_loop_payload(station_id)
