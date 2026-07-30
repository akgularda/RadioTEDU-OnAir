from fastapi.testclient import TestClient

from app.main import app


def test_root_serves_cleanroom_frontend():
    client = TestClient(app)
    res = client.get("/")
    assert res.status_code == 200
    assert "Station Lobby" in res.text
    assert 'id="publicStationLobby"' in res.text


def test_login_route_serves_login_page():
    client = TestClient(app)
    res = client.get("/login.html")
    assert res.status_code == 200
    assert 'id="loginForm"' in res.text
    assert "Sign In" in res.text


def test_frontend_static_assets_are_served():
    client = TestClient(app)
    res = client.get("/static/js/app.js")
    assert res.status_code == 200
    assert "apiFetch" in res.text
    assert "function exportLogs()" in res.text


def test_frontend_serves_live_mic_client_asset():
    client = TestClient(app)
    res = client.get("/static/js/mic.js")
    assert res.status_code == 200
    assert "MediaRecorder" in res.text


def test_deterministic_wall_contains_emergency_audio_controls():
    client = TestClient(app)
    res = client.get("/app")
    assert res.status_code == 200
    assert 'id="emergencyLamp"' in res.text
    assert 'id="emergencySignalState"' in res.text
    assert 'id="startEmergencyButton"' in res.text
    assert 'id="stopEmergencyButton"' in res.text
