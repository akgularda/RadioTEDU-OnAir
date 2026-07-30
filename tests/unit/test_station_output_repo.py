from app.db import get_connection, init_db
from app.repositories.station_output_repo import StationOutputRepository


def test_upsert_and_count_active_local_outputs(tmp_path, monkeypatch):
    monkeypatch.setenv("CLEANROOM_DB_PATH", str(tmp_path / "cleanroom.db"))
    init_db()
    repo = StationOutputRepository(get_connection())

    repo.upsert(
        station_id=1,
        local_output_enabled=True,
        output_device_id="dev1",
        icecast_enabled=True,
        icecast_host="127.0.0.1",
        icecast_port=8000,
        icecast_mount="/station1",
        icecast_user="source",
        icecast_password="hackme",
        stream_codec_profile="mp3_128",
        stream_bitrate_kbps=128,
    )

    cfg = repo.get(1)
    assert cfg is not None
    assert cfg["local_output_enabled"] == 1
    assert cfg["output_device_id"] == "dev1"
    assert cfg["icecast_enabled"] == 1
    assert cfg["icecast_host"] == "127.0.0.1"
    assert cfg["icecast_mount"] == "/station1"
    assert cfg["stream_codec_profile"] == "mp3_128"
    assert cfg["stream_bitrate_kbps"] == 128
    assert repo.count_active_local_outputs() == 1
