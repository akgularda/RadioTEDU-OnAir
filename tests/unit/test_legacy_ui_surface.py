from pathlib import Path


def test_cleanroom_ui_has_legacy_panels():
    root = Path(__file__).resolve().parents[2] / "app" / "static"
    html = (root / "index.html").read_text(encoding="utf-8")
    assert "On Air" in html
    assert "Library" in html
    assert "Downloads" in html
    assert "Playlists" in html
    assert "Schedule" in html
    assert "Ads" in html
    assert "Logs" in html
    assert "Settings" in html
    assert 'id="autoPlaylistModal"' in html
    assert "Create Auto Playlist" in html
