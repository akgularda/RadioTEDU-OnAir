# Delivery Requirements and Evidence

This checklist is the completion contract for RadioTEDU-OnAir. An item is not
complete until the named evidence exists and has been inspected.

| Requirement | Required evidence | Status |
| --- | --- | --- |
| Original installation preserved | Read-only audit plus successful replacement acceptance report | **Verified locally.** Installed-tree Git status remained 7 tracked changes/17 untracked files before and after; no replacement, deletion, or write was performed. |
| Clean independent repository | Git root outside installed path; secret scan; reproducible build manifests | **Verified pre-publication.** Repository is under `Documents`, transient artifacts are ignored, source secret scan is clear, and the installer checksum is reproducible. |
| Program Files / ProgramData / user-profile separation | Runtime-path tests and installed-machine inspection | **Verified by source, tests, packaged smoke, and a real isolated administrative install/uninstall cycle.** The final cycle used an empty repository-local binary target while exercising the real ProgramData and uninstall-registry contracts; a separate clean-host run remains release-operations work. |
| Existing station/data migration | Backup, dry-run report, station counts, credential-vault migration test | **Verified dry run.** Consistent read-only snapshot imported 7 stations and 15,106 tracks into staging; target replacement was false; credential-vault migration tests passed. |
| Deterministic playout and explicit seeded shuffle | Unit/property tests and persisted transition log | **Verified.** Deterministic queue, generation, shuffle, event, and transition tests passed. |
| No silent failures | Structured error contract, log assertions, fault-injection report | **Verified.** Structured API/runtime errors, bounded recovery, and fault-path tests passed. |
| Media validation and managed folders | Songs/jingles/IDs/ads/shows folder tests and dashboard screenshots | **Verified.** Media validation/import summaries, managed-folder APIs, and dashboard controls passed automated and rendered checks. |
| Automatic ingestion | File-watcher integration tests including changes, duplicates, long names, and malformed files | **Verified.** Stable-file, duplicate, recursive, malformed, and rescan watcher tests passed. |
| Playlist and jingle automation | Rule-engine tests for every-N-songs, time, priority, cooldown, and conflicts | **Verified.** Playlist, queue, jingle, advertisement, schedule, priority, and conflict tests passed. |
| Live microphone | Device selection, permission, meter, gain, PTT/live, ducking, and disconnect tests | **Automated verification complete; live transmission permission-gated.** Python/JavaScript mic and disconnect tests passed; no production microphone stream was opened. |
| Multi-station onboarding | RadioTEDU safe connection test plus independent generic station test | **Generic station verified; RadioTEDU live connection permission-gated.** The GUI created, selected, refreshed, and switched to/from `Independent Test FM` with Icecast disabled. |
| Complete dashboard control | Real mouse/keyboard end-to-end control inventory | **Safe controls verified; live/destructive actions not actuated.** Rendered login, refresh, station creation, selection, and switching completed with zero post-login console/page errors. |
| Voting | Compatible API adapter, operator controls, validation, failure/degraded-state tests | **Verified.** Adapter, dashboard, validation, and degraded-state tests passed. |
| Study/mobile integration | Documented adapter or intentionally scoped link with degraded-state tests | **Verified.** Optional adapter is documented and fails closed without affecting playout. |
| Optional AI | Local provider controls, no-core-dependency proof, outage tests | **Verified.** AI controls, cache/readiness, disabled mode, timeout, and outage behavior passed; core playout remains independent. |
| Recovery | Network loss, encoder exit, restart, wrong credentials, and crash-state tests | **Verified.** Runtime/recovery regression and hardening suites passed. |
| Installer/uninstaller | Built installer, clean install, upgrade, uninstall, and data-retention report | **Verified through an actual isolated administrative install/uninstall cycle.** Install and uninstall succeeded without restart, required files and registry records were validated, extracted binaries matched the health-tested distribution, optional .NET/Ollama installers were not requested, the uninstall entry was removed, and pre-existing OnAir ProgramData test state was restored. No upgrade was attempted over the legacy product because the replacement uses an independent AppId and must not overwrite it. |
| Operator documentation | Operator guide, troubleshooting guide, configuration reference | **Verified.** Dedicated operator, troubleshooting, configuration, release, and test-report documents are linked from the README. |
| Branded delivery | RadioTEDU/RTAI assets with provenance and rendered README/app screenshots | **Verified.** RadioTEDU/RTAI branding is rendered in the app and `docs/assets/onair-dashboard.png` is embedded in the README. |
| GitHub publication | Visibility decision, license approval, clean secret scan, successful push | **Permission-gated.** Secret scan passed; visibility choice, initial commit, repository creation, and push remain. |

## Remaining external decisions

1. Choose `public` or `private` visibility for
   `akgularda/RadioTEDU-OnAir`.
2. Keep RadioTEDU live output disabled, or explicitly authorize a controlled
   test with a station/mount, time window, and permitted content.
3. Provide an organizational Authenticode certificate before describing the
   installer as production-signed or publishing it as a signed binary.
