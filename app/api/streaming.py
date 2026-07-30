import base64
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import require_any_permission, require_permission
from app.db import get_connection, init_db
from app.engine.ad_policy import rocket_ad_insertion_enabled_from_settings
from app.repositories.settings_repo import SettingsRepository
from app.repositories.station_output_repo import StationOutputRepository
from app.repositories.station_repo import StationRepository
from app.security.credential_vault import (
    is_credential_reference,
    resolve_credential_value,
    store_system_secret,
)

router = APIRouter()


class StreamingFeatureSettingsUpdate(BaseModel):
    stream_public_base_url: str = ""
    radio_website_url: str = ""
    rocket_admin_user: str = "admin"
    rocket_admin_password: str = ""
    rocket_health_password: str = ""
    rocket_status_page_enabled: bool = True
    rocket_hls_enabled: bool = True
    rocket_fallbacks_enabled: bool = True
    rocket_listener_auth_enabled: bool = False
    rocket_ad_insertion_enabled: bool = False
    rocket_access_log_enabled: bool = True
    rocket_playlist_log_enabled: bool = True


class MetadataUpdatePayload(BaseModel):
    station_id: int = 0
    mount: str = ""
    song: str


class MoveListenersPayload(BaseModel):
    station_id: int = 0
    mount: str
    destination: str


class KickSourcePayload(BaseModel):
    station_id: int = 0
    mount: str


class MidrollPayload(BaseModel):
    station_id: int = 0
    mount: str
    ads: list[dict]


def _normalize_mount(raw: str) -> str:
    mount = str(raw or "").strip()
    if not mount:
        raise HTTPException(status_code=400, detail="mount is required")
    return mount if mount.startswith("/") else f"/{mount}"


def _truthy(raw, default: bool = False) -> bool:
    token = str(raw if raw is not None else default).strip().lower()
    if token in {"1", "true", "yes", "on"}:
        return True
    if token in {"0", "false", "no", "off"}:
        return False
    return bool(default)


def _secret_is_configured(value: str) -> bool:
    stored = str(value or "").strip()
    return bool(stored) and (
        not is_credential_reference(stored)
        or bool(resolve_credential_value(stored))
    )


def _system_feature_payload(settings: dict) -> dict:
    return {
        "stream_public_base_url": str(settings.get("stream_public_base_url") or ""),
        "radio_website_url": str(settings.get("radio_website_url") or ""),
        "rocket_admin_user": str(settings.get("rocket_admin_user") or "admin"),
        "rocket_admin_password_set": _secret_is_configured(
            settings.get("rocket_admin_password", "")
        ),
        "rocket_health_password_set": _secret_is_configured(
            settings.get("rocket_health_password", "")
        ),
        "rocket_status_page_enabled": _truthy(
            settings.get("rocket_status_page_enabled", "true"), True
        ),
        "rocket_hls_enabled": _truthy(
            settings.get("rocket_hls_enabled", "true"), True
        ),
        "rocket_fallbacks_enabled": _truthy(
            settings.get("rocket_fallbacks_enabled", "true"), True
        ),
        "rocket_listener_auth_enabled": _truthy(
            settings.get("rocket_listener_auth_enabled", "false"), False
        ),
        "rocket_ad_insertion_enabled": rocket_ad_insertion_enabled_from_settings(
            settings
        ),
        "rocket_access_log_enabled": _truthy(
            settings.get("rocket_access_log_enabled", "true"), True
        ),
        "rocket_playlist_log_enabled": _truthy(
            settings.get("rocket_playlist_log_enabled", "true"), True
        ),
        "server_side_config_required": [
            "Enable the Rocket status and health endpoints in the origin configuration.",
            "Enable HLS only on the mounts that should publish it.",
            "Configure fallback mounts or files at the origin.",
            "Configure listener-auth webhooks before enforcing private streams.",
        ],
    }


def _extra_outputs(settings: dict, station_id: int) -> list[dict]:
    raw = str(
        settings.get(f"station_{int(station_id)}_extra_icecast_outputs", "") or ""
    )
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        return []
    return [dict(item) for item in parsed if isinstance(item, dict)]


def _redact_output(output: dict) -> dict:
    redacted = {
        key: value
        for key, value in dict(output).items()
        if key not in {"password", "icecast_password"}
    }
    password = str(
        output.get("icecast_password") or output.get("password") or ""
    )
    redacted["icecast_password_configured"] = bool(password)
    return redacted


def _mount_credentials(
    conn,
    settings: dict,
    station_id: int,
    mount: str,
) -> dict:
    normalized_mount = _normalize_mount(mount)
    output_repo = StationOutputRepository(conn)
    if station_id > 0:
        row = output_repo.get(int(station_id))
        if row is not None and _normalize_mount(row["icecast_mount"]) == normalized_mount:
            return {
                "host": str(row["icecast_host"]),
                "port": int(row["icecast_port"]),
                "user": str(row["icecast_user"] or "source"),
                "password": str(row["icecast_password"] or ""),
            }
        for output in _extra_outputs(settings, station_id):
            raw_mount = str(
                output.get("icecast_mount") or output.get("mount") or ""
            ).strip()
            if raw_mount and _normalize_mount(raw_mount) == normalized_mount:
                return {
                    "host": str(
                        output.get("icecast_host") or output.get("host") or ""
                    ),
                    "port": int(
                        output.get("icecast_port") or output.get("port") or 80
                    ),
                    "user": str(
                        output.get("icecast_user")
                        or output.get("user")
                        or "source"
                    ),
                    "password": resolve_credential_value(
                        str(
                            output.get("icecast_password")
                            or output.get("password")
                            or ""
                        )
                    ),
                }

    rows = conn.execute(
        "SELECT station_id FROM station_outputs ORDER BY station_id"
    ).fetchall()
    for output_row in rows:
        row = output_repo.get(int(output_row["station_id"]))
        if row is not None and _normalize_mount(row["icecast_mount"]) == normalized_mount:
            return {
                "host": str(row["icecast_host"]),
                "port": int(row["icecast_port"]),
                "user": str(row["icecast_user"] or "source"),
                "password": str(row["icecast_password"] or ""),
            }

    return {
        "host": str(settings.get("rocket_admin_host") or "127.0.0.1"),
        "port": int(float(settings.get("rocket_admin_port") or 8000)),
        "user": str(settings.get("rocket_admin_user") or "admin"),
        "password": resolve_credential_value(
            str(settings.get("rocket_admin_password") or "")
        ),
    }


def _basic_auth(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def _request_text(
    url: str,
    user: str,
    password: str,
    data: dict | None = None,
) -> dict:
    encoded = None if data is None else urlencode(data).encode("utf-8")
    request = Request(
        url,
        data=encoded,
        method="GET" if encoded is None else "POST",
        headers={"Authorization": _basic_auth(user, password)},
    )
    try:
        with urlopen(request, timeout=8) as response:
            body = response.read(2000).decode("utf-8", errors="replace")
            return {"ok": True, "status": int(response.status), "body": body}
    except HTTPError as exc:
        return {
            "ok": False,
            "status": int(exc.code),
            "error_code": (
                "credentials_rejected"
                if int(exc.code) in {401, 403}
                else "origin_request_failed"
            ),
            "message": "The streaming origin rejected the management request.",
        }
    except (URLError, TimeoutError, OSError):
        return {
            "ok": False,
            "error_code": "origin_unreachable",
            "message": "The streaming origin could not be reached.",
        }


@router.get("/api/streaming/features")
def get_streaming_features(
    _user=Depends(require_any_permission("stations.view", "stations.edit")),
):
    init_db()
    conn = get_connection()
    try:
        settings_repo = SettingsRepository(conn)
        settings = settings_repo.get_system()
        stations = []
        for station in StationRepository(conn).list_all():
            sid = int(station["id"])
            station_settings = settings_repo.get_station(sid)
            safe_settings = {
                key: value
                for key, value in station_settings.items()
                if (key.startswith("icecast_") or key.startswith("rocket_"))
                and "password" not in key
            }
            output = StationOutputRepository(conn).get(sid)
            if output is not None:
                safe_settings["icecast_password_configured"] = bool(
                    output["icecast_password"]
                )
            stations.append(
                {
                    "id": sid,
                    "name": str(station["name"] or ""),
                    "settings": safe_settings,
                    "extra_icecast_outputs": [
                        _redact_output(item)
                        for item in _extra_outputs(settings, sid)
                    ],
                }
            )
        return {"system": _system_feature_payload(settings), "stations": stations}
    finally:
        conn.close()


@router.put("/api/streaming/features")
def update_streaming_features(
    payload: StreamingFeatureSettingsUpdate,
    _user=Depends(require_permission("stations.edit")),
):
    init_db()
    conn = get_connection()
    try:
        repo = SettingsRepository(conn)
        existing = repo.get_system()
        admin_password = str(existing.get("rocket_admin_password") or "")
        health_password = str(existing.get("rocket_health_password") or "")
        if payload.rocket_admin_password:
            admin_password = store_system_secret(
                "rocket_admin_password",
                payload.rocket_admin_password,
            )
        if payload.rocket_health_password:
            health_password = store_system_secret(
                "rocket_health_password",
                payload.rocket_health_password,
            )
        repo.upsert_system(
            {
                "stream_public_base_url": payload.stream_public_base_url,
                "radio_website_url": payload.radio_website_url,
                "rocket_admin_user": payload.rocket_admin_user,
                "rocket_admin_password": admin_password,
                "rocket_health_password": health_password,
                "rocket_status_page_enabled": str(
                    bool(payload.rocket_status_page_enabled)
                ).lower(),
                "rocket_hls_enabled": str(bool(payload.rocket_hls_enabled)).lower(),
                "rocket_fallbacks_enabled": str(
                    bool(payload.rocket_fallbacks_enabled)
                ).lower(),
                "rocket_listener_auth_enabled": str(
                    bool(payload.rocket_listener_auth_enabled)
                ).lower(),
                "rocket_ad_insertion_enabled": str(
                    bool(payload.rocket_ad_insertion_enabled)
                ).lower(),
                "rocket_access_log_enabled": str(
                    bool(payload.rocket_access_log_enabled)
                ).lower(),
                "rocket_playlist_log_enabled": str(
                    bool(payload.rocket_playlist_log_enabled)
                ).lower(),
            }
        )
        return {"ok": True}
    finally:
        conn.close()


@router.get("/api/streaming/health")
def rocket_health(
    _user=Depends(require_any_permission("stations.view", "stations.edit")),
):
    init_db()
    conn = get_connection()
    try:
        settings = SettingsRepository(conn).get_system()
        host = str(settings.get("rocket_admin_host") or "127.0.0.1")
        port = int(float(settings.get("rocket_admin_port") or 8000))
        user = str(
            settings.get("rocket_health_user")
            or settings.get("rocket_admin_user")
            or "admin"
        )
        password = resolve_credential_value(
            str(
                settings.get("rocket_health_password")
                or settings.get("rocket_admin_password")
                or ""
            )
        )
        return _request_text(f"http://{host}:{port}/health", user, password)
    finally:
        conn.close()


def _management_request(payload, path: str, data: dict | None = None) -> dict:
    init_db()
    conn = get_connection()
    try:
        settings = SettingsRepository(conn).get_system()
        mount = _normalize_mount(payload.mount)
        credentials = _mount_credentials(
            conn,
            settings,
            int(payload.station_id),
            mount,
        )
        url = f"http://{credentials['host']}:{credentials['port']}/{path}"
        return _request_text(
            url,
            credentials["user"],
            credentials["password"],
            data,
        )
    finally:
        conn.close()


@router.post("/api/streaming/metadata")
def update_stream_metadata(
    payload: MetadataUpdatePayload,
    _user=Depends(require_permission("stations.edit")),
):
    init_db()
    conn = get_connection()
    try:
        settings = SettingsRepository(conn).get_system()
        mount = _normalize_mount(payload.mount)
        credentials = _mount_credentials(
            conn,
            settings,
            int(payload.station_id),
            mount,
        )
        query = urlencode(
            {"mode": "updinfo", "mount": mount, "song": str(payload.song or "")}
        )
        url = (
            f"http://{credentials['host']}:{credentials['port']}"
            f"/admin/metadata?{query}"
        )
        return _request_text(
            url,
            credentials["user"],
            credentials["password"],
        )
    finally:
        conn.close()


@router.post("/api/streaming/manage/move-listeners")
def move_listeners(
    payload: MoveListenersPayload,
    _user=Depends(require_permission("stations.edit")),
):
    mount = _normalize_mount(payload.mount)
    return _management_request(
        payload,
        f"{mount.strip('/')}/manage",
        {
            "action": "movelisteners",
            "dest": _normalize_mount(payload.destination),
        },
    )


@router.post("/api/streaming/manage/kick")
def kick_source(
    payload: KickSourcePayload,
    _user=Depends(require_permission("stations.edit")),
):
    mount = _normalize_mount(payload.mount)
    return _management_request(
        payload,
        f"{mount.strip('/')}/manage",
        {"action": "kick"},
    )


@router.post("/api/streaming/manage/midroll")
def insert_midroll(
    payload: MidrollPayload,
    _user=Depends(require_permission("stations.edit")),
):
    init_db()
    conn = get_connection()
    try:
        settings = SettingsRepository(conn).get_system()
        if not rocket_ad_insertion_enabled_from_settings(settings):
            raise HTTPException(status_code=409, detail="ads_disabled_for_station")
        if int(payload.station_id) > 0:
            station_settings = SettingsRepository(conn).get_station(
                int(payload.station_id)
            )
            if not rocket_ad_insertion_enabled_from_settings(station_settings):
                raise HTTPException(
                    status_code=409,
                    detail="ads_disabled_for_station",
                )
    finally:
        conn.close()
    mount = _normalize_mount(payload.mount)
    return _management_request(
        payload,
        f"{mount.strip('/')}/manage",
        {
            "action": "midroll",
            "json": json.dumps({"ads": payload.ads}, ensure_ascii=False),
        },
    )
