# RadioTEDU OnAir 1.0.0 Verification Report

Date: 2026-07-30  
Platform: Windows 10 22H2 (10.0.19045), x64  
Python: 3.12  
.NET SDK: repo-local 8.0.415  
Installer compiler: Inno Setup 6.7.3

## Automated verification

- Python collection: 763 unique tests covered with no failures.
  - The primary run completed 748 tests without a failure, then the test
    process stopped advancing during the final WebSocket group.
  - The remaining WebSocket files were rerun in a clean process: 16 passed in
    32.65 seconds. One test overlaps the primary run, so unique coverage is
    763/763.
- JavaScript UI/PWA contracts: 118 passed, 0 failed.
- Windows desktop tests: 30 passed, 0 failed.
- Packaged desktop bundle smoke: passed on an automatically allocated,
  isolated loopback port. The packaged backend, agent, shell, and installer
  marker were all resolved.
- Final targeted runtime, health, public-status, identity, metadata, and
  operator-authorization regression slices passed after their respective
  fixes.

## Visible mouse and keyboard verification

The final operator workflow was exercised in a visible Microsoft Edge window.
Functional state changes were made with real mouse and keyboard events. API
reads were used only to confirm state after the visible interaction.

- RadioTEDU OnAir branding, program logo, RadioTEDU logo, and RTAI logo
  rendered correctly.
- The controlling station was RadioTEDU Lo-Fi (`/lofi`).
- Broadcast Stop required two mouse clicks, stopped the scheduler, engine, and
  output, and preserved all 19 queued items in order.
- Broadcast Start was clicked with the mouse after a backend restart and
  verified scheduler, engine, and output feed recovery.
- Final visible state: `ON AIR`, engine running, scheduler running, Icecast
  connected, AI disabled, emergency source off, restart policy disabled.
- Read-back verification showed station 2 (`/lofi`) running with its worker,
  program, feed, and Icecast sink active. Stations 1, 4, 5, 7, 8, and 9 were
  all stopped.
- The only established encoder connection was the `/lofi` Icecast output.
- Stop/resume, station selection, output save/test, station create/delete,
  queue reload/reorder/remove, library search/filter/pagination, folder
  selection/cancel, AI enable/disable, integrations, self-check, repair,
  password mismatch handling, activity clearing, and shared-brand settings
  were exercised from the UI.
- Microphone authorization, live input, music modes, and console controls were
  exercised from the full control surface.
- Emergency takeover opened a browser audio source, verified captured audio
  frames on `/lofi`, then stopped and restored scheduled playout.
- Automatic jingles were disabled and re-enabled, changed from every 2 songs
  to every 3 songs and back to 2, and switched between ordered and random
  selection. Final setting: enabled, every 2 completed songs, random.

Rendered evidence:

- `docs/assets/onair-console-verified.png`
- `docs/assets/jingle-control-verified.png`

The Codex in-app browser connector failed during its own initialization. The
same visible workflow was completed by attaching Playwright to a normal,
foreground Microsoft Edge window and sending mouse/keyboard input to it.

## Legacy Broadcast Wall isolation

- The three legacy Broadcast Wall scheduled tasks were disabled.
- Unattended legacy `/start`, `/tick`, `/supervise`, and `/loop/start` calls
  now return `409` unless explicit unattended-start authorization is enabled.
- A detached SYSTEM-owned legacy Python process could not be terminated from
  the current non-elevated session. It was functionally quarantined by the
  endpoint guards and cannot start a station. Because its scheduled tasks are
  disabled, it will not return after the next Windows restart.

## Legacy-data safety check

The installed legacy SQLite database was opened read-only and copied through a
consistent SQLite snapshot into temporary staging. The dry run succeeded
without replacing a target database:

- Stations: 7
- Tracks: 15,106
- System settings: 36
- Station settings: 317
- Station outputs: 8
- Ad break sets: 5
- Ad campaigns: 5
- Target replaced: no
- Source snapshot used: yes

The only warning was the absence of the optional legacy `schedule` table.

## Release artifact

- Installer: `release/setup/RadioTEDU-OnAir-Setup-1.0.0.exe`
- Size: 315,131,119 bytes (300.5 MiB)
- SHA-256:
  `AD8143A9A3D65BD4A4332A05FB2FA74A963C04324DB7C8FAD8F7A1954D60FCDA`
- Checksum sidecar:
  `release/setup/RadioTEDU-OnAir-Setup-1.0.0.sha256`
- Checksum comparison: matched
- Authenticode status: `NotSigned`

An organizational Authenticode certificate is still required to remove the
Windows unknown-publisher warning.

## Isolated installer/uninstaller cycle

The final installer was exercised twice against empty repository-local
targets with icons, restart, and post-install launch suppressed.

Final measured cycle:

- Installer exit code: 0
- Backend present: yes
- Desktop agent present: yes
- Desktop shell present: yes
- Uninstaller present: yes
- Uninstaller exit code: 0
- Residual package files after uninstall: zero

The first cycle also installed and uninstalled successfully. Its verifier
looked for the shell at the target root instead of the documented `shell`
subdirectory; the install log confirmed the correct destination. The corrected
second cycle produced the measurements above.

## RadioTEDU repository integration verification

Verified on 2026-07-30 against the pinned RadioTEDU AI, Voting, and Juke
repositories:

- OnAir broad suite: 769 passed, 3 skipped; the only first-run failure was the
  Windows process-fingerprint timeout under concurrent packaging load.
- Current OnAir control-plane regression after replacing that slow WMI lookup:
  19 passed, including fixed service commands, signed Juke health, protected
  handoff provisioning, database guards, and deterministic wall contracts.
- AI Radio: 422 backend tests passed, 1 skipped; 14 frontend tests passed; the
  production frontend build completed.
- Voting: 364 backend tests passed with 2 skipped; 74 local-agent tests passed;
  both managed packages compiled.
- Juke: 285 backend tests and 9 media-agent tests passed; the backend compiled
  after repairing its reproducible lockfile.
- Visible Edge mouse run: 6 of 6 cards loaded with repository, protected config,
  and health paths; Check All completed; the database two-click guard worked;
  settings saved; zero browser console errors; all autostart switches remained
  off.
- Exact-value scan: none of the private handoff's credential values occur in
  tracked source across OnAir, AI, Voting, or Juke.

The verification did not start any AI, Voting, or Juke service and did not
touch the live `/lofi` broadcast. AI speech remains intentionally blocked by
the upstream approval gate until commissioned RadioTEDU voice references are
supplied.

## Release limitations

- The public installer is not Authenticode-signed.
- No claim is made that software testing can establish military or NATO
  certification. The evidence in this report is the reproducible reliability
  basis for this release.
