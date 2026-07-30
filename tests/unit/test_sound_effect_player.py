import struct
import threading
import time
from collections import deque
from unittest.mock import MagicMock, patch

from app.audio.sound_effect_player import SoundEffectSlot, SoundEffectPlayer


def test_slot_init_sets_fields():
    with patch("app.audio.sound_effect_player.subprocess") as mock_sub:
        mock_proc = MagicMock()
        mock_proc.stdout = MagicMock()
        mock_proc.poll.return_value = None
        mock_sub.Popen.return_value = mock_proc
        slot = SoundEffectSlot(item_id=1, name="Test", file_path="/test.mp3", gain_db=0.0)
        slot.stop()
    assert slot.item_id == 1
    assert slot.name == "Test"


def test_slot_gain_applied():
    slot = SoundEffectSlot.__new__(SoundEffectSlot)
    slot.item_id = 1
    slot.name = "Test"
    slot.gain_db = -6.0
    slot._gain_linear = 10 ** (-6.0 / 20)
    slot._lock = threading.Lock()
    slot._buffer = deque()
    slot._buffer_bytes = 0
    slot._finished = False
    slot._started_at = time.monotonic()
    # Inject PCM: a single sample of 10000
    pcm = struct.pack("<h", 10000)
    slot._buffer.append(pcm)
    slot._buffer_bytes = len(pcm)
    result = slot.read_pcm(2)
    sample = struct.unpack("<h", result)[0]
    # -6dB ≈ 0.5012, so 10000 * 0.5012 ≈ 5012
    assert 4900 < sample < 5200


def test_slot_finished_when_buffer_drained():
    slot = SoundEffectSlot.__new__(SoundEffectSlot)
    slot.item_id = 1
    slot.name = "Test"
    slot._lock = threading.Lock()
    slot._buffer = deque()
    slot._buffer_bytes = 0
    slot._finished = False
    slot._process = None
    slot._reader_thread = None
    slot._gain_linear = 1.0
    slot._started_at = time.monotonic()
    # No process, empty buffer → finished
    slot._process_exited = True
    assert slot.finished is True


def test_slot_elapsed_s():
    slot = SoundEffectSlot.__new__(SoundEffectSlot)
    slot._started_at = time.monotonic() - 2.5
    elapsed = slot.elapsed_s
    assert 2.4 < elapsed < 3.0


def test_player_play_and_read_pcm():
    player = SoundEffectPlayer(station_id=1)
    # Create a mock slot
    mock_slot = MagicMock()
    mock_slot.finished = False
    mock_slot.item_id = 42
    mock_slot.read_pcm.return_value = struct.pack("<2h", 100, -100)
    with patch.object(player, "_create_slot", return_value=mock_slot):
        player.play({"id": 42, "name": "Test", "file_path": "/t.mp3", "gain_db": 0.0})
    assert player.active_count == 1
    result = player.read_pcm(4)
    assert result == struct.pack("<2h", 100, -100)


def test_player_premix_multiple_slots():
    player = SoundEffectPlayer(station_id=1)
    slot_a = MagicMock()
    slot_a.finished = False
    slot_a.item_id = 1
    slot_a.read_pcm.return_value = struct.pack("<2h", 10000, -10000)
    slot_b = MagicMock()
    slot_b.finished = False
    slot_b.item_id = 2
    slot_b.read_pcm.return_value = struct.pack("<2h", 5000, -5000)
    player._slots = [slot_a, slot_b]
    result = player.read_pcm(4)
    samples = struct.unpack("<2h", result)
    assert samples[0] == 15000
    assert samples[1] == -15000


def test_player_premix_clamps():
    player = SoundEffectPlayer(station_id=1)
    slot_a = MagicMock()
    slot_a.finished = False
    slot_a.item_id = 1
    slot_a.read_pcm.return_value = struct.pack("<h", 30000)
    slot_b = MagicMock()
    slot_b.finished = False
    slot_b.item_id = 2
    slot_b.read_pcm.return_value = struct.pack("<h", 20000)
    player._slots = [slot_a, slot_b]
    result = player.read_pcm(2)
    sample = struct.unpack("<h", result)[0]
    assert sample == 32767  # clamped


def test_player_removes_finished_slots():
    player = SoundEffectPlayer(station_id=1)
    slot = MagicMock()
    slot.finished = True
    slot.item_id = 1
    slot.read_pcm.return_value = b"\x00\x00"
    player._slots = [slot]
    player.read_pcm(2)
    assert player.active_count == 0


def test_player_stop_specific():
    player = SoundEffectPlayer(station_id=1)
    slot = MagicMock()
    slot.item_id = 42
    slot.finished = False
    player._slots = [slot]
    player.stop(item_id=42)
    slot.stop.assert_called_once()


def test_player_stop_all():
    player = SoundEffectPlayer(station_id=1)
    s1 = MagicMock()
    s1.item_id = 1
    s2 = MagicMock()
    s2.item_id = 2
    player._slots = [s1, s2]
    player.stop()
    s1.stop.assert_called_once()
    s2.stop.assert_called_once()
    assert player._slots == []


def test_player_snapshot():
    player = SoundEffectPlayer(station_id=1)
    slot = MagicMock()
    slot.item_id = 5
    slot.name = "Jingle"
    slot.elapsed_s = 1.2
    slot.finished = False
    player._slots = [slot]
    snap = player.snapshot()
    assert snap["count"] == 1
    assert snap["active_items"][0]["item_id"] == 5
    assert snap["active_items"][0]["name"] == "Jingle"


def test_player_read_pcm_returns_silence_when_empty():
    player = SoundEffectPlayer(station_id=1)
    result = player.read_pcm(4)
    assert result == b"\x00" * 4
