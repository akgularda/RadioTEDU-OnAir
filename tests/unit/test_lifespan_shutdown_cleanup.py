from fastapi.testclient import TestClient

from app.api import runtime as runtime_api
from app.main import app


def test_lifespan_shutdown_calls_runtime_cleanup(monkeypatch):
    called = {"loops": 0, "runtimes": 0}

    def _fake_loop_start(*, station_id, fallback_uri="", interval_sec=1.0):
        return {
            "station_id": int(station_id),
            "running": True,
            "interval_sec": float(interval_sec),
            "fallback_uri": str(fallback_uri),
            "ticks": 0,
            "last_result": None,
            "last_error": "",
        }

    def _fake_loop_stop_all():
        called["loops"] += 1
        return {"stations": [], "stopped": 0}

    def _fake_runtime_stop_all():
        called["runtimes"] += 1
        return {"stations": [], "stopped": 0}

    monkeypatch.setattr(runtime_api.worker_loop_manager, "start", _fake_loop_start)
    monkeypatch.setattr(runtime_api.worker_loop_manager, "stop_all", _fake_loop_stop_all)
    monkeypatch.setattr(runtime_api.runtime_registry, "stop_all", _fake_runtime_stop_all)

    with TestClient(app) as client:
        res = client.get("/api/health")
        assert res.status_code == 200

    assert called["loops"] == 1
    assert called["runtimes"] == 1


def test_lifespan_runs_dependency_bootstrap_once(monkeypatch):
    called = {"bootstrap": 0}

    def _fake_bootstrap_dependencies():
        called["bootstrap"] += 1
        return {}

    def _fake_loop_start(*, station_id, fallback_uri="", interval_sec=1.0):
        return {
            "station_id": int(station_id),
            "running": True,
            "interval_sec": float(interval_sec),
            "fallback_uri": str(fallback_uri),
            "ticks": 0,
            "last_result": None,
            "last_error": "",
        }

    monkeypatch.setattr("app.main.bootstrap_dependencies", _fake_bootstrap_dependencies)
    monkeypatch.setattr(runtime_api.worker_loop_manager, "start", _fake_loop_start)

    with TestClient(app) as client:
        res = client.get("/api/health")
        assert res.status_code == 200

    assert called["bootstrap"] == 1
