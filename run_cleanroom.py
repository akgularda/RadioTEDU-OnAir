import os
import sys
from threading import Thread

import uvicorn

from app.launcher import open_panel, wait_for_health
from app.main import app


def _panel_host(host: str) -> str:
    if host in {"0.0.0.0", "::"}:
        return "127.0.0.1"
    return host


def _should_auto_open_panel() -> bool:
    raw = os.getenv("CLEANROOM_OPEN_PANEL", "").strip().lower()
    if raw:
        return raw in {"1", "true", "yes", "on"}
    return bool(getattr(sys, "frozen", False))


def _launch_panel_when_ready(host: str, port: int) -> None:
    base_url = f"http://{_panel_host(host)}:{port}"
    if wait_for_health(f"{base_url}/api/health"):
        open_panel(base_url)


def main() -> None:
    host = os.getenv("CLEANROOM_HOST", "127.0.0.1")
    port = int(os.getenv("CLEANROOM_PORT", "8100"))
    if _should_auto_open_panel():
        Thread(target=_launch_panel_when_ready, args=(host, port), daemon=True).start()
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
