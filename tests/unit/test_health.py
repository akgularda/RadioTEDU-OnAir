from fastapi.testclient import TestClient

from app.api import runtime as runtime_api
from app.db import get_connection, init_db
from app.main import app
from app.repositories.station_repo import StationRepository


def test_health_endpoint_reports_ok():
    client = TestClient(app)
    res = client.get("/api/health")
    assert res.status_code == 200
    payload = res.json()
    assert payload["status"] == "ok"
    assert "engine_running" in payload
    assert isinstance(payload["engine_running"], bool)
    assert isinstance(payload.get("runtime_branch_health"), dict)
    deps = payload.get("dependencies") or {}
    assert isinstance(deps, dict)
    for key in ("ffmpeg", "ffplay", "ffprobe", "gst_launch", "yt_dlp"):
        item = deps.get(key) or {}
        assert isinstance(item.get("found"), bool)
        assert isinstance(item.get("path"), str)


def test_health_endpoint_reports_dependency_source_and_bootstrap_status(monkeypatch):
    monkeypatch.setattr(
        "app.api.health.describe_dependency",
        lambda *names: {
            "found": True,
            "path": "C:/tools/bin/yt-dlp.exe",
            "source": "managed",
            "managed_path": "C:/tools/bin/yt-dlp.exe",
            "bootstrap_status": "installed",
            "bootstrap_error": "",
        },
    )

    client = TestClient(app)
    payload = client.get("/api/health").json()
    deps = payload["dependencies"]

    assert deps["yt_dlp"]["source"] == "managed"
    assert deps["yt_dlp"]["bootstrap_status"] == "installed"
    assert deps["yt_dlp"]["managed_path"] == "C:/tools/bin/yt-dlp.exe"
    assert deps["ffprobe"]["source"] == "managed"
    assert deps["ffprobe"]["bootstrap_status"] == "installed"


def test_health_defaults_to_active_station_without_unapproved_autostart(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("CLEANROOM_DB_PATH", str(tmp_path / "cleanroom.db"))
    monkeypatch.setattr("app.main.bootstrap_dependencies", lambda: {})

    init_db()
    conn = get_connection()
    stations = StationRepository(conn)
    active_station_id = stations.create("Station 2")
    stations.set_active(active_station_id)
    conn.close()

    started = []

    def _fake_loop_start(*, station_id, fallback_uri="", interval_sec=1.0):
        started.append(int(station_id))
        return {
            "station_id": int(station_id),
            "running": True,
            "interval_sec": float(interval_sec),
            "fallback_uri": str(fallback_uri),
            "ticks": 0,
            "last_result": None,
            "last_error": "",
        }

    def _fake_loop_status(station_id):
        running = int(station_id) == active_station_id and active_station_id in started
        return {
            "station_id": int(station_id),
            "running": running,
            "interval_sec": 1.0 if running else None,
            "fallback_uri": "",
            "ticks": 0,
            "last_result": None,
            "last_error": "",
        }

    monkeypatch.setattr(runtime_api.worker_loop_manager, "start", _fake_loop_start)
    monkeypatch.setattr(runtime_api.worker_loop_manager, "status", _fake_loop_status)
    monkeypatch.setattr(
        runtime_api.worker_loop_manager,
        "snapshot",
        lambda: [_fake_loop_status(active_station_id)] if started else [],
    )
    monkeypatch.setattr(
        runtime_api.runtime_registry,
        "status",
        lambda station_id: {
            "station_id": int(station_id),
            "running": False,
            "branch_health": {"icecast": False, "local": False},
            "required_outputs": {"icecast": True, "local": False},
        },
    )
    monkeypatch.setattr(runtime_api.runtime_registry, "snapshot", lambda: [])

    with TestClient(app) as client:
        payload = client.get("/api/health").json()

    assert started == []
    assert payload["station_id"] == active_station_id
    assert payload["active_station_id"] == active_station_id
    assert payload["worker_loop"]["station_id"] == active_station_id
    assert payload["worker_loop"]["running"] is False
    assert payload["engine_running"] is False
