from pathlib import Path

from app.db import get_connection, init_db


def _fake_metadata(file_path: str, fallback_title: str = "Track", **_kwargs) -> dict:
    return {
        "title": Path(file_path).stem or fallback_title,
        "artist": "Test Artist",
        "duration": 180.0,
    }


def _audio(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"ID3-test-audio")
    return path.resolve()


def test_replace_sync_is_exact_idempotent_and_cleans_pending_queue(
    client, tmp_path, monkeypatch
):
    monkeypatch.setattr("app.api.legacy._get_audio_metadata", _fake_metadata)
    managed = tmp_path / "pop"
    first = _audio(managed / "First.mp3")
    second = _audio(managed / "nested" / "Second.wav")
    old = _audio(tmp_path / "old" / "Old Rock.mp3")

    init_db()
    conn = get_connection()
    conn.execute("INSERT INTO stations (id, name) VALUES (2, 'Managed Test')")
    cursor = conn.execute(
        "INSERT INTO tracks "
        "(station_id, title, artist, track_type, file_path, is_active, duration) "
        "VALUES (2, 'Old Rock', '', 'music', ?, 1, 120)",
        (str(old),),
    )
    old_track_id = int(cursor.lastrowid)
    conn.execute(
        "INSERT INTO queue_items (station_id, track_id, position, status) "
        "VALUES (2, ?, 1, 'pending')",
        (old_track_id,),
    )
    conn.commit()
    conn.close()

    payload = {
        "station_id": 2,
        "folder": str(managed),
        "mode": "replace",
        "profile_label": "Pop",
        "default_genre": "Pop",
        "default_language": "en",
    }
    response = client.post("/api/library/folder/sync", json=payload)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["verified"] is True
    assert result["expected_files"] == 2
    assert result["active_files"] == 2
    assert result["added"] == 2
    assert result["deactivated"] == 1
    assert result["pending_queue_items_removed"] == 1

    conn = get_connection()
    active_rows = conn.execute(
        "SELECT file_path, genre, language FROM tracks "
        "WHERE station_id=2 AND track_type='music' AND is_active=1 ORDER BY file_path"
    ).fetchall()
    assert {Path(row["file_path"]).resolve() for row in active_rows} == {first, second}
    assert {str(row["genre"]) for row in active_rows} == {"Pop"}
    assert {str(row["language"]) for row in active_rows} == {"en"}
    assert conn.execute(
        "SELECT COUNT(*) AS c FROM queue_items "
        "WHERE station_id=2 AND track_id=? AND status='pending'",
        (old_track_id,),
    ).fetchone()["c"] == 0
    settings = {
        str(row["key"]): str(row["value"])
        for row in conn.execute(
            "SELECT key, value FROM station_settings WHERE station_id=2"
        ).fetchall()
    }
    conn.close()
    assert Path(settings["music_library_folder"]).resolve() == managed.resolve()
    assert settings["library_management_mode"] == "replace"
    assert settings["library_profile_label"] == "Pop"
    assert settings["library_active_files"] == "2"

    second_response = client.post("/api/library/folder/sync", json=payload)
    assert second_response.status_code == 200, second_response.text
    second_result = second_response.json()
    assert second_result["verified"] is True
    assert second_result["added"] == 0
    assert second_result["retained"] == 2
    assert second_result["deactivated"] == 0


def test_managed_folders_are_isolated_per_station(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.legacy._get_audio_metadata", _fake_metadata)
    pop_folder = tmp_path / "pop"
    rock_folder = tmp_path / "rock-en"
    pop_track = _audio(pop_folder / "Pop Song.mp3")
    rock_track = _audio(rock_folder / "Rock Song.mp3")

    init_db()
    conn = get_connection()
    conn.execute("INSERT INTO stations (id, name) VALUES (2, 'Rock')")
    conn.commit()
    conn.close()

    pop_response = client.post(
        "/api/library/folder/sync",
        json={
            "station_id": 1,
            "folder": str(pop_folder),
            "mode": "replace",
            "profile_label": "Pop",
            "default_genre": "Pop",
        },
    )
    rock_response = client.post(
        "/api/library/folder/sync",
        json={
            "station_id": 2,
            "folder": str(rock_folder),
            "mode": "replace",
            "profile_label": "Rock (EN)",
            "default_genre": "Rock",
            "default_language": "en",
        },
    )
    assert pop_response.status_code == 200, pop_response.text
    assert rock_response.status_code == 200, rock_response.text

    conn = get_connection()
    rows = conn.execute(
        "SELECT station_id, file_path, genre, language FROM tracks "
        "WHERE is_active=1 AND track_type='music' ORDER BY station_id"
    ).fetchall()
    conn.close()
    assert [(int(row["station_id"]), Path(row["file_path"]).resolve()) for row in rows] == [
        (1, pop_track),
        (2, rock_track),
    ]
    assert str(rows[1]["genre"]) == "Rock"
    assert str(rows[1]["language"]) == "en"


def test_jingle_folder_profile_does_not_overwrite_music_profile(
    client, tmp_path, monkeypatch
):
    monkeypatch.setattr("app.api.legacy._get_audio_metadata", _fake_metadata)
    music_folder = tmp_path / "music"
    jingle_folder = tmp_path / "jingles"
    _audio(music_folder / "Song.mp3")
    _audio(jingle_folder / "Station ID.mp3")

    music_response = client.post(
        "/api/library/folder/sync",
        json={
            "station_id": 1,
            "folder": str(music_folder),
            "track_type": "music",
            "mode": "replace",
            "profile_label": "Pop",
            "default_genre": "Pop",
        },
    )
    jingle_response = client.post(
        "/api/library/folder/sync",
        json={
            "station_id": 1,
            "folder": str(jingle_folder),
            "track_type": "jingle",
            "mode": "replace",
            "profile_label": "Jingles",
        },
    )
    assert music_response.status_code == 200, music_response.text
    assert jingle_response.status_code == 200, jingle_response.text

    conn = get_connection()
    settings = {
        str(row["key"]): str(row["value"])
        for row in conn.execute(
            "SELECT key, value FROM station_settings WHERE station_id=1"
        ).fetchall()
    }
    rows = conn.execute(
        "SELECT track_type, COUNT(*) AS count FROM tracks "
        "WHERE station_id=1 AND is_active=1 GROUP BY track_type"
    ).fetchall()
    conn.close()

    assert settings["library_profile_label"] == "Pop"
    assert settings["library_management_mode"] == "replace"
    assert settings["library_active_files"] == "1"
    assert settings["jingle_library_profile_label"] == "Jingles"
    assert settings["jingle_library_management_mode"] == "replace"
    assert settings["jingle_library_active_files"] == "1"
    assert Path(settings["jingle_library_folder"]).resolve() == jingle_folder.resolve()
    assert {str(row["track_type"]): int(row["count"]) for row in rows} == {
        "jingle": 1,
        "music": 1,
    }


def test_folder_sync_rejects_entire_folder_before_writes_when_any_audio_is_unplayable(
    client, tmp_path, monkeypatch
):
    managed = tmp_path / "managed"
    good = _audio(managed / "Good.mp3")
    bad = _audio(managed / "Broken.mp3")

    def probe(file_path: str, **_kwargs):
        if Path(file_path).resolve() == bad:
            raise ValueError("decoder rejected file")
        return {"title": Path(file_path).stem, "artist": "", "duration": 120.0}

    monkeypatch.setattr("app.api.legacy._get_audio_metadata", probe)
    response = client.post(
        "/api/library/folder/sync",
        json={"station_id": 1, "folder": str(managed), "mode": "replace"},
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["invalid_count"] == 1
    assert detail["files"][0]["file"] == bad.name

    conn = get_connection()
    count = conn.execute(
        "SELECT COUNT(*) AS count FROM tracks WHERE station_id=1 AND file_path IN (?, ?)",
        (str(good), str(bad)),
    ).fetchone()["count"]
    conn.close()
    assert int(count) == 0
