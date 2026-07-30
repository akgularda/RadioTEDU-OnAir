from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_manifest_file_exists():
    assert (ROOT / "app" / "static" / "manifest.json").exists()


def test_service_worker_file_exists():
    assert (ROOT / "app" / "static" / "sw.js").exists()


def test_html_shells_include_pwa_metadata():
    index_html = (ROOT / "app" / "static" / "index.html").read_text(encoding="utf-8")
    login_html = (ROOT / "app" / "static" / "login.html").read_text(encoding="utf-8")
    manifest = (ROOT / "app" / "static" / "manifest.json").read_text(encoding="utf-8")
    assert '"src": "/static/icons/icon-192.png"' in manifest
    assert '"sizes": "192x192"' in manifest
    assert '"src": "/static/icons/icon-512.png"' in manifest
    assert '"sizes": "512x512"' in manifest

    for html in (index_html, login_html):
        assert 'rel="manifest"' in html
        assert "theme-color" in html
        assert "viewport-fit=cover" in html
        assert "navigator.serviceWorker.register('/sw.js', { scope: '/' })" in html


def test_login_shell_explains_fresh_install_credentials():
    login_html = (ROOT / "app" / "static" / "login.html").read_text(encoding="utf-8")

    assert "initial-admin-password.txt" in login_html
    assert "%ProgramData%\\RadioTEDU\\OnAir" in login_html
