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
        "testCurrentOutputButton",
        "libraryFolderForm",
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
        "timelineRemaining",
        "forecastList",
    }
    ids = set(re.findall(r'\bid="([A-Za-z][A-Za-z0-9_-]*)"', html))
    assert required_ids.issubset(ids)
    assert len(ids) == len(re.findall(r'\bid="([A-Za-z][A-Za-z0-9_-]*)"', html))


def test_operator_mutations_use_read_back_verification_and_safe_retry():
    javascript = (WALL / "app.js").read_text(encoding="utf-8")
    assert "async function verifiedMutation" in javascript
    assert "idempotent: true" in javascript
    assert "async function saveCurrentOutput" in javascript
    assert "async function saveAiConfiguration" in javascript
    assert "async function syncJingleFolder" in javascript
    assert "async function changePassword" in javascript
    assert "async function startEmergency" in javascript
    assert "async function addTrackToQueue" in javascript
    assert "async function startBroadcast" in javascript
    assert "async function stopBroadcast" in javascript
    assert "/operator-stop" in javascript
    assert "/operator-start-track" in javascript
    assert "/operator-supervise" in javascript
    assert "interval_unit: 'tracks'" in javascript
    assert "'sweeperEnabled', 'sweeperInterval', 'sweeperMode'" in javascript
    assert "setCleanChecked('sweeperEnabled'" in javascript
    assert "setCleanValue('sweeperMode'" in javascript
    assert "settings.library_active_files" in javascript
    assert "serviceControlState" in javascript
    assert "https://stream.radiotedu.com/lofi" in javascript
    assert "/api/operator/pick-file" in javascript
    assert "data-service-path=" in javascript
    assert "database.last_update_at" in javascript
    assert "Stop stream — keep playlist" in (WALL / "index.html").read_text(encoding="utf-8")
    assert "AI is content-only" in (WALL / "index.html").read_text(encoding="utf-8")
