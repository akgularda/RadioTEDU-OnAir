import json

from app.db import _migrate_station_credentials, get_connection, init_db
from app.repositories.station_output_repo import StationOutputRepository
from app.security.credential_vault import CredentialVault, credential_reference


def _protect(value: bytes) -> bytes:
    return b"protected:" + value[::-1]


def _unprotect(value: bytes) -> bytes:
    assert value.startswith(b"protected:")
    return value[len(b"protected:") :][::-1]


def test_vault_never_writes_plaintext(tmp_path):
    path = tmp_path / "vault.json"
    vault = CredentialVault(path, protect=_protect, unprotect=_unprotect)
    reference = credential_reference(4)

    vault.set_secret(reference, "test-stream-password")

    raw = path.read_text(encoding="utf-8")
    assert "test-stream-password" not in raw
    assert vault.get_secret(reference) == "test-stream-password"
    assert vault.has_secret(reference) is True
    assert json.loads(raw)["version"] == 1


def test_station_output_repository_stores_only_credential_reference(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("CLEANROOM_DB_PATH", str(tmp_path / "cleanroom.db"))
    monkeypatch.setenv(
        "CLEANROOM_CREDENTIAL_STORE_FILE", str(tmp_path / "credentials.json")
    )
    init_db()
    conn = get_connection()
    repo = StationOutputRepository(conn)

    repo.upsert(
        station_id=1,
        local_output_enabled=False,
        output_device_id="",
        icecast_enabled=True,
        icecast_host="127.0.0.1",
        icecast_port=8000,
        icecast_mount="/test",
        icecast_user="source",
        icecast_password="not-for-sqlite",
    )

    raw = repo.get_raw(1)
    assert str(raw["icecast_password"]).startswith("credential://user/")
    assert raw["icecast_password"] != "not-for-sqlite"
    assert repo.get(1)["icecast_password"] == "not-for-sqlite"


def test_schema_migration_moves_legacy_password_and_blanks_settings(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("CLEANROOM_DB_PATH", str(tmp_path / "cleanroom.db"))
    monkeypatch.setenv(
        "CLEANROOM_CREDENTIAL_STORE_FILE", str(tmp_path / "credentials.json")
    )
    init_db()
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO station_outputs (station_id, icecast_password) "
            "VALUES (1, ?) "
            "ON CONFLICT(station_id) DO UPDATE SET icecast_password=excluded.icecast_password",
            ("legacy-password",),
        )
        conn.execute(
            "INSERT INTO station_settings (station_id, key, value) "
            "VALUES (1, 'icecast_password', ?) "
            "ON CONFLICT(station_id, key) DO UPDATE SET value=excluded.value",
            ("legacy-settings-password",),
        )

        _migrate_station_credentials(conn.cursor())
        conn.commit()

        raw = StationOutputRepository(conn).get_raw(1)
        assert str(raw["icecast_password"]).startswith("credential://user/station/1/")
        assert StationOutputRepository(conn).get(1)["icecast_password"] == "legacy-password"
        row = conn.execute(
            "SELECT value FROM station_settings "
            "WHERE station_id=1 AND key='icecast_password'"
        ).fetchone()
        assert row["value"] == ""
    finally:
        conn.close()
