from app.services.managed_library_watcher import (
    ManagedLibraryProfile,
    ManagedLibraryWatcher,
)


def test_watcher_waits_for_stable_copy_then_syncs_supported_audio(tmp_path):
    folder = tmp_path / "Songs"
    folder.mkdir()
    # Long enough to catch fixed-size filename assumptions while keeping the
    # complete temporary path below legacy Windows MAX_PATH on CI hosts that
    # have not enabled long-path support.
    long_name = ("a" * 120) + ".mp3"
    (folder / long_name).write_bytes(b"audio")
    calls = []
    profile = ManagedLibraryProfile(
        station_id=7,
        track_type="music",
        folder=str(folder),
    )
    watcher = ManagedLibraryWatcher(
        profile_provider=lambda: [profile],
        sync_callback=lambda item: calls.append(item) or {"verified": True},
        required_stable_polls=2,
    )

    watcher.poll_once(now=1)
    assert calls == []
    assert watcher.snapshot()["profiles"][0]["status"] == "settling"

    watcher.poll_once(now=2)
    assert calls == [profile]
    assert watcher.snapshot()["profiles"][0]["status"] == "watching"

    (folder / "notes.txt").write_text("ignored", encoding="utf-8")
    watcher.poll_once(now=3)
    assert calls == [profile]


def test_watcher_detects_changed_audio_and_uses_bounded_retry(tmp_path):
    folder = tmp_path / "Jingles"
    folder.mkdir()
    media = folder / "id.ogg"
    media.write_bytes(b"first")
    attempts = []
    profile = ManagedLibraryProfile(
        station_id=1,
        track_type="jingle",
        folder=str(folder),
    )

    def failing_sync(item):
        attempts.append(item)
        raise RuntimeError("malformed media")

    watcher = ManagedLibraryWatcher(
        profile_provider=lambda: [profile],
        sync_callback=failing_sync,
        required_stable_polls=2,
        max_retries=1,
    )
    watcher.poll_once(now=1)
    watcher.poll_once(now=2)
    assert len(attempts) == 1
    assert watcher.snapshot()["profiles"][0]["status"] == "retry_wait"

    watcher.poll_once(now=2.5)
    assert len(attempts) == 1
    watcher.poll_once(now=3)
    assert len(attempts) == 2
    watcher.poll_once(now=10)
    assert len(attempts) == 2
    assert watcher.snapshot()["profiles"][0]["status"] == "failed"

    media.write_bytes(b"changed")
    watcher.poll_once(now=11)
    assert watcher.snapshot()["profiles"][0]["status"] == "settling"
