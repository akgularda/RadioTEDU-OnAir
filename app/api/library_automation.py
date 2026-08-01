from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import require_permission
from app.services.managed_library_watcher import get_managed_library_watcher
from app.services.unified_media_folder import (
    UnifiedMediaFolderError,
    get_unified_media_folder_service,
)

router = APIRouter(tags=["library-automation"])


class ManagedLibraryRescanPayload(BaseModel):
    station_id: int | None = None
    track_type: str | None = None


class UnifiedMediaRefreshPayload(BaseModel):
    request_library_rescan: bool = True


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


@router.get("/api/library/unified-media/status")
def unified_media_status(_user=Depends(require_permission("stations.edit"))):
    """Return the fixed media-root layout without reading source media."""
    try:
        return get_unified_media_folder_service().status()
    except UnifiedMediaFolderError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/api/library/unified-media/refresh")
def refresh_unified_media(
    payload: UnifiedMediaRefreshPayload,
    _user=Depends(require_permission("stations.edit")),
):
    """Publish explicit hardlink views, then request existing library syncs."""
    try:
        result = get_unified_media_folder_service().refresh()
    except UnifiedMediaFolderError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    watcher = get_managed_library_watcher()
    queued = watcher.request_rescan() if payload.request_library_rescan else 0
    return {
        **result,
        "library_rescan_queued_profiles": queued,
        "watcher": watcher.snapshot(),
    }
