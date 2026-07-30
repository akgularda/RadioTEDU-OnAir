from datetime import datetime, timedelta, timezone


class LeaseService:
    def __init__(self, conn, lease_seconds: int = 30):
        self.conn = conn
        self.lease_seconds = lease_seconds

    def try_acquire(self, station_id: int, worker_id: str) -> bool:
        now = datetime.now(timezone.utc)
        expires = now + timedelta(seconds=self.lease_seconds)
        cur = self.conn.cursor()
        cur.execute(
            "SELECT worker_id, lease_expires_at FROM station_worker_lease WHERE station_id=?",
            (station_id,),
        )
        row = cur.fetchone()
        if row:
            lease_expires_at = datetime.fromisoformat(row["lease_expires_at"])
            if lease_expires_at > now and row["worker_id"] != worker_id:
                return False
            cur.execute(
                "UPDATE station_worker_lease SET worker_id=?, lease_expires_at=?, updated_at=CURRENT_TIMESTAMP WHERE station_id=?",
                (worker_id, expires.isoformat(), station_id),
            )
        else:
            cur.execute(
                "INSERT INTO station_worker_lease (station_id, worker_id, lease_expires_at) VALUES (?, ?, ?)",
                (station_id, worker_id, expires.isoformat()),
            )
        self.conn.commit()
        return True
