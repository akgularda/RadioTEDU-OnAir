from fastapi.testclient import TestClient

from app.db import get_connection, init_db
from app.main import app


def test_queue_push_writes_queue_and_outbox(tmp_path, monkeypatch):
    monkeypatch.setenv("CLEANROOM_DB_PATH", str(tmp_path / "cleanroom.db"))
    init_db()
    client = TestClient(app)
    res = client.post("/api/queue/push", json={"station_id": 1, "track_id": 77})
    assert res.status_code == 200
    assert res.json()["deduped"] is False

    res2 = client.post("/api/queue/push", json={"station_id": 1, "track_id": 77})
    assert res2.status_code == 200
    assert res2.json()["deduped"] is True

    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM queue_items WHERE station_id=1")
    assert cur.fetchone()[0] == 1
    cur.execute(
        "SELECT COUNT(*) FROM command_outbox WHERE station_id=1 AND command_type='queue_push'"
    )
    assert cur.fetchone()[0] == 1
