from fastapi import APIRouter
from pydantic import BaseModel

from app.db import get_connection, init_db
from app.engine.priority import choose_source
from app.repositories.ad_break_repo import AdBreakRepository
from app.repositories.outbox_repo import OutboxRepository
from app.repositories.queue_repo import QueueRepository
from app.repositories.schedule_repo import ScheduleRepository
from app.ws.broadcaster import broadcaster

router = APIRouter()


class QueuePush(BaseModel):
    station_id: int
    track_id: int


@router.post("/api/queue/push")
def push(payload: QueuePush):
    init_db()
    conn = get_connection()
    try:
        queue_repo = QueueRepository(conn)
        outbox_repo = OutboxRepository(conn)
        item_id, created = queue_repo.enqueue_or_get_existing(
            station_id=payload.station_id,
            track_id=payload.track_id,
            dedupe_key=f"queue:{payload.station_id}:{payload.track_id}",
        )
        if created:
            outbox_repo.enqueue(payload.station_id, "queue_push", payload.model_dump())
    finally:
        conn.close()

    try:
        from app.api.legacy import list_legacy_queue

        broadcaster.on_queue_changed(payload.station_id, list_legacy_queue(payload.station_id))
    except Exception:
        pass

    return {"ok": True, "item_id": item_id, "deduped": not created}


@router.get("/api/playout/state")
def state(station_id: int):
    init_db()
    conn = get_connection()
    queue_repo = QueueRepository(conn)
    ad_repo = AdBreakRepository(conn)
    schedule_repo = ScheduleRepository(conn)
    pending = queue_repo.next_pending(station_id)
    due_ad = ad_repo.next_due(station_id)
    ready_schedule = schedule_repo.next_ready(station_id)
    manual_count = 1 if pending else 0
    next_source = choose_source(
        manual_count=manual_count,
        ad_due=bool(due_ad),
        schedule_ready=bool(ready_schedule),
        fallback_ready=True,
    )
    return {
        "station_id": station_id,
        "next_source": next_source,
        "manual_count": manual_count,
        "ad_due": bool(due_ad),
        "schedule_ready": bool(ready_schedule),
    }


@router.get("/api/queue/items")
def queue_items(station_id: int, limit: int = 20):
    init_db()
    conn = get_connection()
    queue_repo = QueueRepository(conn)
    rows = queue_repo.list_recent(station_id=station_id, limit=limit)
    items = [
        {
            "id": int(row["id"]),
            "station_id": int(row["station_id"]),
            "track_id": int(row["track_id"]),
            "position": int(row["position"]),
            "status": str(row["status"]),
            "enqueued_at": row["enqueued_at"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "title": str(row["title"]),
            "artist": str(row["artist"]),
        }
        for row in rows
    ]
    return {"station_id": station_id, "items": items}
