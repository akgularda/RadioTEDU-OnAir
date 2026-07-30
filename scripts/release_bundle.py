from __future__ import annotations

import json
import sys
from typing import Any

BACKEND_DIR = "dist/backend"
DESKTOP_DIR = "dist/desktop"
DESKTOP_SHELL_DIR = f"{DESKTOP_DIR}/shell"

RELEASE_ARTIFACTS = (
    (
        "RadioTEDU-OnAir-Backend.exe",
        f"{BACKEND_DIR}/RadioTEDU-OnAir-Backend.exe",
    ),
    (
        "RadioTEDU-OnAir-Agent.exe",
        f"{DESKTOP_DIR}/RadioTEDU-OnAir-Agent.exe",
    ),
    (
        "RadioTEDU-OnAir.exe",
        f"{DESKTOP_SHELL_DIR}/RadioTEDU-OnAir.exe",
    ),
)


def build_release_manifest(version: str) -> dict[str, Any]:
    return {
        "version": version,
        "layout": {
            "backend_dir": BACKEND_DIR,
            "desktop_dir": DESKTOP_DIR,
            "desktop_shell_dir": DESKTOP_SHELL_DIR,
        },
        "artifacts": [
            {"name": name, "path": path}
            for name, path in RELEASE_ARTIFACTS
        ],
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    version = args[0] if args else ""
    json.dump(build_release_manifest(version), sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
