from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import require_any_permission, require_permission, user_has_permission
from app.audio.device_registry import DeviceRegistry
from app.config import MAX_LOCAL_OUTPUTS
from app.db import get_connection, init_db
from app.repositories.settings_repo import SettingsRepository
from app.repositories.station_output_repo import StationOutputRepository

router = APIRouter()


class StationOutputUpdate(BaseModel):
    station_id: int
    local_output_enabled: bool = False
    output_device_id: str = ""
    icecast_enabled: bool = False
    icecast_host: str = "127.0.0.1"
    icecast_port: int = 8000
    icecast_mount: str = "/stream"
    icecast_user: str = "source"
    icecast_password: str = ""
    output_gain_db: float = 0.0
    stream_codec_profile: str = "aac_plus_196"
    stream_bitrate_kbps: int = 196


def _normalize_stream_profile(raw_profile: str, raw_bitrate: int) -> tuple[str, int]:
    token = str(raw_profile or "").strip().lower().replace("-", "_").replace("+", "_plus_")
    if token in {"mp3", "mp3_128", "mp3_128kbps"}:
        return "mp3_128", 128
    if token in {"aac", "aac_plus_196", "aac_plus_196kbps", "aacplus_196"}:
        return "aac_plus_196", 196
    try:
        bitrate = max(32, min(512, int(raw_bitrate)))
    except (TypeError, ValueError):
        bitrate = 196
    return "aac_plus_196", bitrate


def _row_to_output_payload(station_id: int, row) -> dict:
    if row is None:
        return {
            "station_id": station_id,
            "local_output_enabled": True,
            "output_device_id": "",
            "icecast_enabled": False,
            "icecast_host": "127.0.0.1",
            "icecast_port": 8000,
            "icecast_mount": f"/station{station_id}",
            "icecast_user": "source",
            "icecast_password": "",
            "icecast_password_configured": False,
            "output_gain_db": 0.0,
            "stream_codec_profile": "aac_plus_196",
            "stream_bitrate_kbps": 196,
        }
    return {
        "station_id": station_id,
        "local_output_enabled": bool(row["local_output_enabled"]),
        "output_device_id": str(row["output_device_id"]),
        "icecast_enabled": bool(row["icecast_enabled"]),
        "icecast_host": str(row["icecast_host"]),
        "icecast_port": int(row["icecast_port"]),
        "icecast_mount": str(row["icecast_mount"]),
        "icecast_user": str(row["icecast_user"]),
        "icecast_password": "",
        "icecast_password_configured": bool(str(row["icecast_password"] or "")),
        "output_gain_db": float(row["output_gain_db"]),
        "stream_codec_profile": str(row["stream_codec_profile"] or "aac_plus_196"),
        "stream_bitrate_kbps": int(row["stream_bitrate_kbps"] or 196),
    }


@router.get("/api/stations/output")
def get_station_output(
    station_id: int,
    _user=Depends(require_any_permission("stations.view", "stations.edit")),
):
    init_db()
    conn = get_connection()
    repo = StationOutputRepository(conn)
    row = repo.get(station_id)
    payload = _row_to_output_payload(station_id, row)
    return payload


@router.post("/api/stations/output")
def update_station_output(
    payload: StationOutputUpdate,
    _user=Depends(require_permission("stations.edit")),
):
    init_db()
    conn = get_connection()
    repo = StationOutputRepository(conn)
    normalized_device_id = str(payload.output_device_id or "").strip()
    normalized_mount = str(payload.icecast_mount or "").strip()
    normalized_profile, normalized_bitrate = _normalize_stream_profile(
        payload.stream_codec_profile,
        payload.stream_bitrate_kbps,
    )

    if not payload.local_output_enabled and not payload.icecast_enabled:
        raise HTTPException(
            status_code=400, detail="at least one output target must be enabled"
        )

    if payload.local_output_enabled:
        if not normalized_device_id:
            raise HTTPException(
                status_code=400,
                detail="output_device_id is required when local output is enabled",
            )
        registry = DeviceRegistry(max_local_outputs=MAX_LOCAL_OUTPUTS)
        for row in repo.list_active_local_output_assignments(
            exclude_station_id=payload.station_id
        ):
            registry.assign(
                station_id=int(row["station_id"]),
                device_id=str(row["output_device_id"]),
            )
        ok, reason = registry.validate_assignment(
            station_id=payload.station_id,
            device_id=normalized_device_id,
        )
        if not ok:
            if reason == "max_local_outputs":
                raise HTTPException(status_code=409, detail="max local outputs limit reached")
            if reason == "device_in_use":
                raise HTTPException(status_code=409, detail="output device already assigned")
            raise HTTPException(status_code=400, detail="output_device_id is required when local output is enabled")

    if payload.icecast_enabled and not normalized_mount:
        raise HTTPException(
            status_code=400,
            detail="icecast_mount is required when icecast is enabled",
        )

    repo.upsert(
        station_id=payload.station_id,
        local_output_enabled=payload.local_output_enabled,
        output_device_id=normalized_device_id,
        icecast_enabled=payload.icecast_enabled,
        icecast_host=payload.icecast_host,
        icecast_port=payload.icecast_port,
        icecast_mount=normalized_mount or payload.icecast_mount,
        icecast_user=payload.icecast_user,
        icecast_password=payload.icecast_password,
        output_gain_db=payload.output_gain_db,
        stream_codec_profile=normalized_profile,
        stream_bitrate_kbps=normalized_bitrate,
    )
    SettingsRepository(conn).upsert_station(
        int(payload.station_id),
        {
            "output_mode": "icecast" if payload.icecast_enabled else "speaker",
            "speaker_monitor_enabled": str(bool(payload.local_output_enabled)).lower(),
            "output_device_id": normalized_device_id,
            "icecast_host": str(payload.icecast_host or "").strip(),
            "icecast_port": str(int(payload.icecast_port)),
            "icecast_mount": normalized_mount or str(payload.icecast_mount or "").strip(),
            "icecast_username": str(payload.icecast_user or "").strip(),
            # The shared settings table must never contain stream passwords.
            # StationOutputRepository stores the secret in the per-user vault.
            "icecast_password": "",
            "output_gain_db": str(float(payload.output_gain_db)),
            "stream_codec_profile": normalized_profile,
            "stream_bitrate_kbps": str(normalized_bitrate),
        },
    )
    return {"ok": True, "output": _row_to_output_payload(payload.station_id, repo.get(payload.station_id))}
