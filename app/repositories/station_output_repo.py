from app.security.credential_vault import (
    is_credential_reference,
    resolve_station_icecast_password,
    store_station_icecast_password,
)


class StationOutputRepository:
    def __init__(self, conn):
        self.conn = conn

    def upsert(
        self,
        station_id: int,
        local_output_enabled: bool,
        output_device_id: str,
        icecast_enabled: bool,
        icecast_host: str,
        icecast_port: int,
        icecast_mount: str,
        icecast_user: str,
        icecast_password: str,
        output_gain_db: float = 0.0,
        stream_codec_profile: str = "aac_plus_196",
        stream_bitrate_kbps: int = 196,
    ) -> None:
        existing = self.get_raw(station_id)
        stored_password = str(icecast_password or "")
        if not stored_password and existing is not None:
            stored_password = str(existing["icecast_password"] or "")
        if stored_password and not is_credential_reference(stored_password):
            stored_password = store_station_icecast_password(
                station_id, stored_password
            )
        cur = self.conn.cursor()
        cur.execute(
            "INSERT INTO station_outputs (station_id, local_output_enabled, output_device_id, icecast_enabled, icecast_host, icecast_port, icecast_mount, icecast_user, icecast_password, output_gain_db, stream_codec_profile, stream_bitrate_kbps) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(station_id) DO UPDATE SET "
            "local_output_enabled=excluded.local_output_enabled, "
            "output_device_id=excluded.output_device_id, "
            "icecast_enabled=excluded.icecast_enabled, "
            "icecast_host=excluded.icecast_host, "
            "icecast_port=excluded.icecast_port, "
            "icecast_mount=excluded.icecast_mount, "
            "icecast_user=excluded.icecast_user, "
            "icecast_password=excluded.icecast_password, "
            "output_gain_db=excluded.output_gain_db, "
            "stream_codec_profile=excluded.stream_codec_profile, "
            "stream_bitrate_kbps=excluded.stream_bitrate_kbps",
            (
                station_id,
                int(local_output_enabled),
                output_device_id,
                int(icecast_enabled),
                icecast_host,
                icecast_port,
                icecast_mount,
                icecast_user,
                stored_password,
                output_gain_db,
                str(stream_codec_profile or "aac_plus_196"),
                int(stream_bitrate_kbps or 196),
            ),
        )
        self.conn.commit()

    def get_raw(self, station_id: int):
        cur = self.conn.cursor()
        cur.execute("SELECT * FROM station_outputs WHERE station_id=?", (station_id,))
        return cur.fetchone()

    def get(self, station_id: int):
        row = self.get_raw(station_id)
        if row is None:
            return None
        payload = dict(row)
        payload["icecast_password"] = resolve_station_icecast_password(
            station_id,
            str(row["icecast_password"] or ""),
        )
        return payload

    def list_active_local_output_assignments(
        self,
        exclude_station_id: int | None = None,
    ) -> list[dict[str, str | int]]:
        cur = self.conn.cursor()
        query = (
            "SELECT station_id, output_device_id FROM station_outputs "
            "WHERE local_output_enabled=1 AND TRIM(output_device_id) <> ''"
        )
        params: list[int] = []
        if exclude_station_id is not None:
            query += " AND station_id <> ?"
            params.append(int(exclude_station_id))
        query += " ORDER BY station_id ASC"
        cur.execute(query, tuple(params))
        return [
            {
                "station_id": int(row["station_id"]),
                "output_device_id": str(row["output_device_id"] or "").strip(),
            }
            for row in cur.fetchall()
        ]

    def count_active_local_outputs(self) -> int:
        return len(self.list_active_local_output_assignments())
