from pathlib import Path


def test_frontend_raw_fetch_calls_are_whitelisted():
    js_path = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "static"
        / "js"
        / "app.js"
    )
    lines = js_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    raw_fetch_lines = [
        line.strip()
        for line in lines
        if "fetch(" in line and "return fetch(url, { ...requestOptions, headers });" not in line
    ]

    assert len(raw_fetch_lines) == 8

    allowed_tokens = (
        "await fetch(modernUrl",
        "await fetch(legacyUrl",
        "/api/auth/login",
        "/api/auth/refresh",
        "/api/health?",
        "await fetch(mediaUrl)",
        "/api/audio/live/settings",
        "/api/audio/live/status",
    )

    for line in raw_fetch_lines:
        assert any(token in line for token in allowed_tokens), line


def test_queue_polling_starts_inside_init_polling_only():
    js_path = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "static"
        / "js"
        / "app.js"
    )
    lines = js_path.read_text(encoding="utf-8", errors="ignore").splitlines()

    init_polling_index = next(
        index for index, line in enumerate(lines) if line.startswith("function initPolling(")
    )
    refresh_all_index = next(
        index for index, line in enumerate(lines) if line.startswith("async function refreshAll(")
    )
    interval_indices = [
        index for index, line in enumerate(lines) if "setInterval(loadQueue, 3000);" in line
    ]
    sync_polling_indices = [
        index for index, line in enumerate(lines) if "PanelRegistry.syncPolling();" in line
    ]

    assert len(interval_indices) == 1
    assert len(sync_polling_indices) >= 1
    assert init_polling_index < interval_indices[0] < refresh_all_index
    assert any(
        init_polling_index < index < refresh_all_index
        for index in sync_polling_indices
    )


def test_download_queue_polling_is_not_initialized_inside_download_ui_bootstrap():
    js_path = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "static"
        / "js"
        / "app.js"
    )
    lines = js_path.read_text(encoding="utf-8", errors="ignore").splitlines()

    init_downloads_index = next(
        index for index, line in enumerate(lines) if line.startswith("function initYtDlpImportUi()")
    )
    load_settings_index = next(
        index for index, line in enumerate(lines) if line.startswith("async function loadYtDlpSettings(")
    )
    downloads_bootstrap_lines = lines[init_downloads_index:load_settings_index]

    assert not any("setInterval(" in line for line in downloads_bootstrap_lines)


def test_app_bootstrap_defers_hidden_panel_initializers():
    js_path = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "static"
        / "js"
        / "app.js"
    )
    lines = js_path.read_text(encoding="utf-8", errors="ignore").splitlines()

    dom_ready_index = next(
        index
        for index, line in enumerate(lines)
        if line.startswith("document.addEventListener('DOMContentLoaded'")
    )
    init_clock_index = next(
        index for index, line in enumerate(lines) if line.startswith("function initClock()")
    )
    bootstrap_lines = lines[dom_ready_index:init_clock_index]
    bootstrap_source = "\n".join(bootstrap_lines)

    assert "await PanelRegistry.initOnce(currentState.panel);" in bootstrap_source
    assert "await refreshVisiblePanel({ force: true, stationId: currentState.currentStationId });" in bootstrap_source
    assert "initUserModalUi();" not in bootstrap_source
    assert "initRoleTemplateModalUi();" not in bootstrap_source
    assert "initProgramAssignmentsPanel();" not in bootstrap_source
    assert "initAdCampaignEditModalUi();" not in bootstrap_source
    assert "initAdsPricingUi();" not in bootstrap_source
    assert "initYtDlpImportUi();" not in bootstrap_source
    assert "initUploadImportUi();" not in bootstrap_source


def test_studio_frontend_rest_calls_use_api_fetch_only():
    js_path = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "static"
        / "js"
        / "studio.js"
    )
    lines = js_path.read_text(encoding="utf-8", errors="ignore").splitlines()

    raw_fetch_lines = [
        line.strip()
        for line in lines
        if "fetch(" in line and "apiFetch(" not in line and "getApiFetch" not in line
    ]

    assert raw_fetch_lines == []
    assert any(
        token in js_path.read_text(encoding="utf-8", errors="ignore")
        for token in ("getApiFetch()", "globalThis.apiFetch", "apiFetch =")
    )
