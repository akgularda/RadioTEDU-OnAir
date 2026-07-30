from fastapi.testclient import TestClient

from app.main import app


def test_public_root_serves_lobby_shell():
    client = TestClient(app)
    res = client.get("/")
    assert res.status_code == 200
    assert "Station Lobby" in res.text
    assert 'id="publicStationLobby"' in res.text


def test_app_route_serves_authenticated_operator_shell():
    client = TestClient(app)
    res = client.get("/app")
    assert res.status_code == 200
    assert "RadioTEDU OnAir" in res.text
    assert 'id="stationSelect"' in res.text
    assert 'id="startBroadcastButton"' in res.text


def test_login_route_still_serves_login_page():
    client = TestClient(app)
    res = client.get("/login.html")
    assert res.status_code == 200
    assert 'id="loginForm"' in res.text
    assert "Sign In" in res.text
