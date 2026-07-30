import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WALL = ROOT / "app" / "static" / "deterministic-wall"


def test_operator_wall_exposes_every_self_service_control():
    html = (WALL / "index.html").read_text(encoding="utf-8")
    required_ids = {
        "startBroadcastButton",
        "stopBroadcastButton",
        "broadcastAutostartEnabled",
        "stationForm",
        "currentOutputForm",
        "currentIcecastTlsEnabled",
        "testCurrentOutputButton",
        "libraryFolderForm",
        "librarySkipUnplayable",
        "browseLibraryFolderButton",
        "librarySearchForm",
        "queueList",
        "jingleUploadForm",
        "jingleFolderForm",
        "browseJingleFolderButton",
        "sweeperForm",
        "sweeperInterval",
        "sweeperMode",
        "aiConfigForm",
        "testAiButton",
        "refreshReadinessButton",
        "repairDependenciesButton",
        "passwordForm",
        "startEmergencyButton",
        "emergencyPreset",
        "previewEmergencyButton",
        "operatorNavigation",
        "timelineRemaining",
        "forecastList",
    }
    ids = set(re.findall(r'\bid="([A-Za-z][A-Za-z0-9_-]*)"', html))
    assert required_ids.issubset(ids)
    assert len(ids) == len(re.findall(r'\bid="([A-Za-z][A-Za-z0-9_-]*)"', html))


def test_operator_mutations_use_read_back_verification_and_safe_retry():
    javascript = (WALL / "app.js").read_text(encoding="utf-8")
    stylesheet = (WALL / "styles.css").read_text(encoding="utf-8")
    assert "async function verifiedMutation" in javascript
    assert "idempotent: true" in javascript
    assert "async function saveCurrentOutput" in javascript
    assert "icecast_tls_enabled: $('currentIcecastTlsEnabled').checked" in javascript
    assert "state.setupState?.blocking_reasons" in javascript
    assert "check.required === false" in javascript
    assert "readiness-list li.optional::before" in stylesheet
    assert ".file-drop { position: relative; overflow: hidden;" in stylesheet
    assert ".file-drop input { position: absolute; inset: 0;" in stylesheet
    assert "node.type !== 'checkbox'" in javascript
    assert "async function saveAiConfiguration" in javascript
    assert "async function syncJingleFolder" in javascript
    assert "async function changePassword" in javascript
    assert "async function startEmergency" in javascript
    assert "async function addTrackToQueue" in javascript
    assert "async function startBroadcast" in javascript
    assert "async function updateBroadcastAutostartFromControl" in javascript
    assert "addEventListener('change', updateBroadcastAutostartFromControl)" in javascript
    assert "async function stopBroadcast" in javascript
    assert "/operator-stop" in javascript
    assert "/operator-start-track" in javascript
    assert "/operator-supervise" in javascript
    assert "interval_unit: 'tracks'" in javascript
    assert "'sweeperEnabled', 'sweeperInterval', 'sweeperMode'" in javascript
    assert "setCleanChecked('sweeperEnabled'" in javascript
    assert "setCleanValue('sweeperMode'" in javascript
    assert "settings.library_active_files" in javascript
    assert "skip_unplayable: $('librarySkipUnplayable').checked" in javascript
    assert "user = await api('/api/auth/me')" in javascript
    assert "!live || state.emergency.starting || state.emergency.stopping" in javascript
    assert "serviceControlState" in javascript
    html = (WALL / "index.html").read_text(encoding="utf-8")
    assert "https://radyo.trt.net.tr/kanallar/radyo-1" in html
    assert "https://stream.radiotedu.com/lofi" not in html
    assert "activateOperatorView" in javascript
    assert "pull_model" in javascript
    assert "update_repository" in javascript
    assert "/api/operator/pick-file" in javascript
    assert "data-service-path=" in javascript
    assert "database.last_update_at" in javascript
    assert "if (!state.stationId || (state.busy && !silent)) return;" in javascript
    assert "Stop stream — keep playlist" in html
    assert "AI is content-only" in html
