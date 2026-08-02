import sys
from pathlib import Path

from app import dependency_bootstrap


def test_frozen_managed_tools_follow_selected_data_root(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("CLEANROOM_TOOLS_DIR", raising=False)
    monkeypatch.setenv("CLEANROOM_DB_PATH", str(tmp_path / "cleanroom.db"))
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    assert dependency_bootstrap.managed_tools_dir() == tmp_path / "tools"

