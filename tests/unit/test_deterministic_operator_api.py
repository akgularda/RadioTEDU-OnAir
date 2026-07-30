from app.db import get_connection
from app.repositories.station_output_repo import StationOutputRepository


def test_existing_station_can_be_renamed_and_verified(client):
    response = client.put("/api/stations/1", json={"name": "Community Radio"})
    assert response.status_code == 200, response.text
    assert response.json()["station"]["name"] == "Community Radio"

    stations = client.get("/api/stations")
    assert stations.status_code == 200, stations.text
    assert any(
        int(station["id"]) == 1 and station["name"] == "Community Radio"
        for station in stations.json()["stations"]
    )


def test_output_editor_persists_the_runtime_source_of_truth(client):
    payload = {
        "station_id": 1,
        "local_output_enabled": False,
        "output_device_id": "",
        "icecast_enabled": True,
        "icecast_host": "stream.example.test",
        "icecast_port": 8443,
        "icecast_mount": "/community",
        "icecast_user": "source-user",
        "icecast_password": "source-secret",
        "output_gain_db": -1.5,
        "stream_codec_profile": "mp3_128",
        "stream_bitrate_kbps": 128,
    }
    response = client.post("/api/stations/output", json=payload)
    assert response.status_code == 200, response.text

    conn = get_connection()
    settings = {
        str(row["key"]): str(row["value"])
        for row in conn.execute(
            "SELECT key, value FROM station_settings WHERE station_id=1"
        ).fetchall()
    }
    output_repo = StationOutputRepository(conn)
    raw_output = output_repo.get_raw(1)
    runtime_output = output_repo.get(1)
    conn.close()

    assert settings["output_mode"] == "icecast"
    assert settings["speaker_monitor_enabled"] == "false"
    assert settings["icecast_host"] == "stream.example.test"
    assert settings["icecast_port"] == "8443"
    assert settings["icecast_mount"] == "/community"
    assert settings["icecast_username"] == "source-user"
    assert settings["icecast_password"] == ""
    assert str(raw_output["icecast_password"]).startswith(
        "credential://user/station/1/"
    )
    assert runtime_output["icecast_password"] == "source-secret"
    assert settings["stream_codec_profile"] == "mp3_128"
    assert settings["stream_bitrate_kbps"] == "128"
