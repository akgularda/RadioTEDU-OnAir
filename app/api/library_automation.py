from pydantic import BaseModel
from fastapi import APIRouter

from app.services.managed_library_watcher import get_managed_library_watcher

router = APIRouter(tags=["library-automation"])


class ManagedLibraryRescanPayload(BaseModel):
    station_id: int | None = None
    track_type: str | None = None


@router.get("/api/library/watcher/status")
def managed_library_watcher_status():
    return get_managed_library_watcher().snapshot()


@router.post("/api/library/watcher/rescan")
def managed_library_watcher_rescan(payload: ManagedLibraryRescanPayload):
    watcher = get_managed_library_watcher()
    selected = watcher.request_rescan(
        station_id=payload.station_id,
        track_type=payload.track_type,
    )
    return {"ok": True, "queued_profiles": selected, **watcher.snapshot()}

