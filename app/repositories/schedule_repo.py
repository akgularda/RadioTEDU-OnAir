class ScheduleRepository:
    def __init__(self, conn):
        self.conn = conn

    def enqueue(
        self,
        station_id: int,
        track_id: int,
        play_at: str,
        window_end: str | None = None,
        event_name: str = "",
    ) -> int:
        cur = self.conn.cursor()
        cur.execute(
            "INSERT INTO schedule_items "
            "(station_id, track_id, play_at, window_end, event_name, status) "
            "VALUES (?, ?, ?, ?, ?, 'pending')",
            (station_id, track_id, play_at, window_end, str(event_name or "")),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def next_ready(self, station_id: int):
        cur = self.conn.cursor()
        cur.execute(
            "SELECT * FROM schedule_items "
            "WHERE station_id=? "
            "AND status='pending' "
            "AND datetime(play_at) <= CURRENT_TIMESTAMP "
            "AND (window_end IS NULL OR datetime(window_end) >= CURRENT_TIMESTAMP) "
            "ORDER BY datetime(play_at) ASC, id ASC "
            "LIMIT 1",
            (station_id,),
        )
        return cur.fetchone()

    def list_recent(self, station_id: int, limit: int = 20):
        safe_limit = max(1, min(int(limit), 200))
        cur = self.conn.cursor()
        cur.execute(
            "SELECT s.id, s.station_id, s.track_id, s.play_at, s.window_end, "
            "s.event_name, s.status, "
            "COALESCE(t.title, '') AS title, COALESCE(t.artist, '') AS artist "
            "FROM schedule_items s "
            "LEFT JOIN tracks t ON t.id = s.track_id "
            "WHERE s.station_id=? "
            "ORDER BY s.id DESC "
            "LIMIT ?",
            (station_id, safe_limit),
        )
        return cur.fetchall()

    def list_all(self, station_id: int):
        cur = self.conn.cursor()
        cur.execute(
            "SELECT s.id, s.station_id, s.track_id, s.play_at, s.window_end, "
            "s.event_name, s.status, "
            "COALESCE(t.title, '') AS title, COALESCE(t.artist, '') AS artist "
            "FROM schedule_items s "
            "LEFT JOIN tracks t ON t.id = s.track_id "
            "WHERE s.station_id=? "
            "ORDER BY datetime(s.play_at) ASC, s.id ASC",
            (int(station_id),),
        )
        return cur.fetchall()

    def get(self, schedule_id: int):
        cur = self.conn.cursor()
        cur.execute(
            "SELECT id, station_id, track_id, play_at, window_end, event_name, "
            "status FROM schedule_items WHERE id=?",
            (int(schedule_id),),
        )
        return cur.fetchone()

    def update(
        self,
        schedule_id: int,
        station_id: int,
        track_id: int,
        play_at: str,
        window_end: str | None = None,
        event_name: str = "",
    ) -> bool:
        cur = self.conn.cursor()
        cur.execute(
            "UPDATE schedule_items SET station_id=?, track_id=?, play_at=?, "
            "window_end=?, event_name=? WHERE id=?",
            (
                int(station_id),
                int(track_id),
                str(play_at),
                window_end,
                str(event_name or ""),
                int(schedule_id),
            ),
        )
        self.conn.commit()
        return cur.rowcount > 0

    def delete(self, schedule_id: int) -> bool:
        cur = self.conn.cursor()
        cur.execute("DELETE FROM schedule_items WHERE id=?", (int(schedule_id),))
        self.conn.commit()
        return cur.rowcount > 0

    def mark_playing(self, item_id: int) -> None:
        cur = self.conn.cursor()
        cur.execute("UPDATE schedule_items SET status='playing' WHERE id=?", (item_id,))
        self.conn.commit()

    def mark_done(self, item_id: int) -> None:
        cur = self.conn.cursor()
        cur.execute("UPDATE schedule_items SET status='done' WHERE id=?", (item_id,))
        self.conn.commit()

    def mark_failed(self, item_id: int) -> None:
        cur = self.conn.cursor()
        cur.execute("UPDATE schedule_items SET status='failed' WHERE id=?", (item_id,))
        self.conn.commit()
