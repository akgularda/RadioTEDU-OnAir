# RadioTEDU `/lofi` upstream recovery

## Current boundary

OnAir now requires listener-delivered audio bytes before it reports a station as live. The local scheduler, engine, queue, credential handoff, and output processes have been repaired and tested, but the public endpoint still returns HTTP 404 with no payload:

- source target: `stream.radiotedu.com:443/lofi` over TLS
- public listener: `https://stream.radiotedu.com/lofi`
- direct internal candidate `10.98.98.75:11154`: resets both modern `PUT` and legacy `SOURCE`
- local public status: station 2 is `degraded`

Do not weaken OnAir's listener verification to hide this condition. Repair the server path.

## Server-side audit order

Run these checks on the Nginx/Icecast hosts with administrator access. Keep credentials out of command history and logs.

1. Confirm the Icecast service and listening sockets:

   ```sh
   systemctl status icecast2 --no-pager
   ss -ltnp
   journalctl -u icecast2 --since "30 minutes ago" --no-pager
   ```

2. Inspect the effective Icecast configuration and verify that the intended source username, mount policy, listener socket, and source password apply to `/lofi`. Icecast 2.4 and later supports HTTP `PUT`; legacy `SOURCE` is not the default fix.

3. Bypass Nginx from the server itself. Send a short generated source to the actual Icecast socket and verify the same mount with `ffprobe`. If this fails, repair Icecast/authentication first. If it works, the defect is in the Nginx/TLS proxy path.

4. Inspect the complete Nginx configuration and logs:

   ```sh
   nginx -T
   nginx -t
   journalctl -u nginx --since "30 minutes ago" --no-pager
   ```

5. For a live source request proxied to Icecast, verify all of the following in the matching `location`:

   ```nginx
   proxy_http_version 1.1;
   proxy_request_buffering off;
   proxy_buffering off;
   proxy_set_header Authorization $http_authorization;
   proxy_set_header Connection "";
   proxy_read_timeout 1h;
   proxy_send_timeout 1h;
   ```

   These are audit requirements, not a complete drop-in virtual host. Preserve the existing TLS, hostname, access controls, and correct `proxy_pass` destination. In particular, confirm that source `PUT /lofi` and listener `GET /lofi` reach the same Icecast instance and mount.

6. Reload only after `nginx -t` succeeds. Then start OnAir and require all three signals before declaring recovery:

   - Icecast statistics show one source on `/lofi`.
   - `https://stream.radiotedu.com/lofi` returns `200` or `206`, an `audio/*` content type, and non-empty bytes for at least 60 seconds.
   - `/api/public/stations` reports RadioTEDU Lo-Fi as `live`, not merely a running FFmpeg process.

## Why these checks matter

Icecast defines a mountpoint as the shared resource used by both source clients and listeners, and Icecast 2.4 added HTTP/1.1 `PUT` for source connections. Nginx buffers request bodies and proxied responses by default; an endless live source must be forwarded as it arrives, and listener audio must be delivered synchronously.

Primary references:

- [Icecast basic setup](https://icecast.org/docs/icecast-latest/basic_setup/)
- [Icecast 2.4 changes (`PUT` source support)](https://icecast.org/docs/icecast-2.4.1/changes.html)
- [Nginx proxy buffering and request buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [FFmpeg Icecast protocol options](https://ffmpeg.org/ffmpeg-protocols.html#Icecast)
