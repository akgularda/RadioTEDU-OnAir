from app.db import get_connection, init_db
from app.engine.lease import LeaseService


def test_second_worker_cannot_take_active_lease(tmp_path, monkeypatch):
    monkeypatch.setenv("CLEANROOM_DB_PATH", str(tmp_path / "cleanroom.db"))
    init_db()
    conn = get_connection()
    svc = LeaseService(conn, lease_seconds=30)
    assert svc.try_acquire(station_id=1, worker_id="w1") is True
    assert svc.try_acquire(station_id=1, worker_id="w2") is False
