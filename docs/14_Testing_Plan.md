# Validation & Testing Plan

Version: 1.2 — condensed 2026-08-17. This document tracks validation
*status and outcomes*. Full investigation detail (root-cause tracing,
live-device verification transcripts, code-level "gotchas") lives in
`docs/15_QA_NOTEBOOK.md`; each entry below names the milestone so the two
documents cross-reference by ID.

---

# 1. Purpose

This document defines the validation phase for Relay Version 1.

All planned implementation milestones (M1–M15) are complete. From T9
onward, the project was a Release Candidate; the `P`-numbered milestones
that followed were product-polish, defect-fix, and packaging/release passes
layered on top of a feature-complete system. Relay `v1.0.0` has now shipped
— see §3.

---

# 2. Validation Principles

- No new features unless required to fix a verified defect.
- No architectural redesign unless an implementation bug exposes a genuine flaw.
- Every issue must be reproduced before being fixed.
- Every fix must include validation.
- Every validation milestone must end with a testing checklist.
- Never continue automatically to the next validation milestone.

---

# 3. Current Status Snapshot

- **Relay `v1.0.0` has shipped.** Feature-complete since T9; product-polish
  (P19–P36), further defect fixes (P29/P37), and packaging/release
  (P38–P53) are all complete. The GitHub Release is published with all
  three assets, and the website is live — see
  `docs/12_Packaging_Deployment.md` §15–16.
- **Backend:** 376 tests passed, 2 skipped (`pytest`, last recorded at
  P43.1); `ruff check` clean.
- **Android:** 367 tests passed (`npx jest`, last recorded at P43.1);
  `tsc --noEmit` clean; `eslint` clean (a handful of pre-existing,
  unrelated warnings — see P35).
- **Desktop:** no automated test suite exists for the plain-JS renderer
  (unchanged since T1) — verified throughout by manual/live testing and
  `node --check`.
- **Packaging and signing are both finalized.** A PyInstaller backend
  bundle (P38), an NSIS Electron installer (P39), and a release APK (P40)
  exist, were verified together end-to-end (P41), rebuilt through every
  fix (P45, P48), and now carry the real production Android signing
  identity (P50) and unified `1.0.0` version (P51). The Windows installer
  remains unsigned by deliberate choice — see
  `docs/12_Packaging_Deployment.md` §12.
- **Outstanding:** a handful of accepted V1-scope limitations — see §6.

All live-device verification in this document and in the QA notebook was
performed primarily on a single physical device, a realme C65 5G (model
RMX3997, ColorOS/RealmeUI, Android 16/API 36). Several defects found were
specific to this OEM's native library behavior (`react-native-saf-x`,
`react-native-blob-util`) — behavior on other devices/OEMs is not
independently verified.

---

# 4. Validation Milestones (T1–T9)

All nine are **Completed**. Each found at most a handful of defects, all
fixed and regression-tested.

### T1 — Environment & Build Validation
Installed, built, started, and shut down the backend, Electron desktop,
and Android app. No implementation defects. Doc/environment gaps noted at
the time (since addressed): root `README.md` was missing, CLAUDE.md
milestone history was behind the project state, and native Android
compilation couldn't be validated (no Android SDK in the validation
environment).

### T2 — Backend Validation
End-to-end workflow testing (pairing, auth, discovery, shared files,
transfer orchestration, streaming, DB lifecycle, error handling, security).
**4 defects fixed:** upload path-traversal vulnerability; a streaming race
returning HTTP 200 instead of 409; discovery init failure on a fresh
database; an expired session's delete rolled back during request teardown.
Result: 276 passed, 2 skipped; `ruff` clean.

### T3 — Electron Desktop Validation
Live application testing (Electron + Chrome DevTools Protocol) across
lifecycle, tray, IPC, CSP, and every resource view. **1 defect fixed:**
backend timestamps are naive UTC; the renderer parsed them as local time,
so pairing attempts could appear not to expire. The renderer now always
interprets backend timestamps as UTC (`parseApiDateTime`).

### T4 — Android Validation
Full source review of every `android/src/` layer against
`backend/README.md`, plus the existing Jest suite (96 tests, 20 suites).
**1 defect fixed:** a race in `TransferStreamManager.start()` — two calls
fired back-to-back before the `POST_NOTIFICATIONS` await resolved could
both begin streaming, breaking the one-active-stream invariant. Fixed with
a synchronous `starting` guard set before the first `await`.

### T5 — End-to-End Integration
Validated complete cross-component workflows (discovery → pairing → auth
→ session restore → shared files → transfer → stream → cancel → device
removal → backend restart). **1 defect fixed:** starting a new pairing
attempt discarded an already-approved-but-uncollected pairing result,
leaving a device permanently paired in the database with no way to ever
receive its session credentials. The pairing manager now preserves
approved/rejected attempts until collected or naturally expired.
**Follow-up (not a defect, later resolved by P47):** Android had no in-app
recovery flow if the desktop's network address changed.

### T6 — Cross-Platform Contract Validation
Traced every endpoint, field name, enum value, status code, and shared
constant actually used by the Electron and Android clients against the
backend's real Pydantic schemas/enums/config — not against documentation.
**No drift found.** Two non-defects noted: Android's discovery listener
checks `protocol_version` is numeric but not that it matches (harmless —
pairing's own QR flow enforces the real check); Android has no client-side
date-parsing code path today, so T3's naive-UTC bug class can't currently
occur there (but nothing prevents a future screen from reintroducing it).

### T7 — Reliability & Stress Testing
Multi-threaded stress harnesses against a real `uvicorn` process (not
simulated sequential calls): concurrent accept/reject races, concurrent
duplicate downloads, 300 concurrent `PATCH /devices/{id}` writes under the
production `QueuePool`, 200 concurrent transfer proposals, and a
hard-killed backend process/database. **2 defects fixed, both from the
same root cause** — nothing reconciled runtime state after an unclean
shutdown:
1. A `Transfer` left `IN_PROGRESS` by a crash never reached a terminal
   state. Fixed: `TransferService.reconcile_interrupted_transfers()`,
   called once at startup, marks any `IN_PROGRESS` row `FAILED`
   (`"Interrupted by backend restart."`).
2. Orphaned upload temp files (`.relay-upload-*`) survived a crash
   indefinitely. Fixed: `TransferStreamService.cleanup_orphaned_upload_temp_files()`,
   also called at startup.

Both are called from `app/main.py`'s `lifespan`. A test-harness-only
`AttributeError` from SQLite's `StaticPool` + shared in-memory connection
under genuine multi-threading was identified as a *test fixture*
limitation, not a production defect — any future concurrency test should
use a file-based DB fixture instead. Result: 286 passed (+6), 2 skipped.

### T8 — Packaging & Installation
Validated packaging *posture*, since no packaging pipeline existed yet to
exercise end-to-end. **1 defect fixed:** the packaged backend would
default to writing its SQLite database and logs inside its own
(potentially unwritable, upgrade-destroyed) install directory. Fixed: a
`RELAY_DATA_DIR` env var (defaulting `DATABASE_URL`/`LOG_DIR` under it when
set); `backend-manager.js` sets it to Electron's `app.getPath("userData")`
in a packaged build; an explicit `DATABASE_URL`/`LOG_DIR` still overrides
it. Result: 293 passed (+7), 2 skipped. (Backend/Desktop/Android packaging
itself was implemented and verified later, in P38–P41 — see §5a.)

### T9 — Release Candidate
Full-codebase review (backend, Electron, Android, docs, deps, config,
security, logging, test coverage, versioning, repo hygiene) as one
product. **No Critical or High defects.** Process-only items noted: T7/T8
fixes were uncommitted at review time, backend deps were unpinned, no
LICENSE chosen, no root README, CLAUDE.md milestone history outdated,
version numbers differed across components. **Relay V1 declared
feature-complete / a Release Candidate.** Result: 293 passed, 2 skipped.

---

# 5. Product-Polish & Reliability Milestones (P1–P18)

Scoped, targeted passes after T9 — mostly Android UX/reliability, some
backend-only. Sub-milestones (`P8.1`, `P9.1`, `P13.1`–`P13.3` + its
correction, `P14.1`–`P14.4`) are numbered continuations of their parent.
All are **Completed**. Full investigation/verification detail for every
row lives in `docs/15_QA_NOTEBOOK.md`'s same-numbered entry.

| # | Area | Outcome |
|---|---|---|
| P1 | Backend/Android/Desktop | Upload auto-accept — mirrored the download flow; removed the desktop's manual accept/reject step and the now-dead endpoints/screens. |
| P2 | Android | Fixed three Shared Files staleness bugs (stale "Downloaded" state, meaningless button state, invisible new shares until manual refresh). |
| P3 | Android | Fixed transfer-tab first-focus staleness, a stale-progress flash after server-side completion, and same-filename download collisions (`name (1).ext`). |
| P4 | Android | Fixed a silently-broken completion notification and a cached failed-channel promise; added an "Open" action. |
| P5 | Android | Removed a redundant duplicate fetch on mount, decoupled stream start from list refresh, closed a reverse staleness gap from P3. |
| P6 | Android | Fixed a dead-end "Downloaded" pill, a mislabeled retry button, and a stale open-failure error message. |
| P7 | Android | Mitigated large-file download truncation (byte-count check false-negative) — symptom fix; true root cause found later in P10. |
| P8 | Backend | Fixed an unbounded client-disconnect detection window (added `STREAM_WRITE_TIMEOUT_SECONDS`) and a SQLite write-lock contributor in `AuthService.authenticate()`. |
| P8.1 | Android | Verified P8's fix held; fixed a false-positive publish-success report and a missing notification sound. |
| P9 | Android | Fixed a stale local-state trailing error text on the transfer detail screen (now gated on the merged, server-wins status). |
| P9.1 | Android | Fixed a wrong-directory existence check, and `Intent.createChooser` breaking "Open"; identified the true native root cause of ongoing download truncations (fixed in P10). |
| P10 | Android (native dep) | Root cause of P7/P8/P9/P9.1's truncations: `react-native-blob-util` violated Okio's `Source` contract. Fixed via a `patch-package` patch. Full writeup: `docs/upstream/react-native-blob-util-okio-read-contract.md`. Re-verify this patch's necessity on any future library upgrade. |
| P11 | Android | Fixed concurrent downloads silently stalling past the first — added a real FIFO queue in `TransferStreamManager`. |
| P13 | Backend/Desktop/Android (feature) | Added whole-folder sharing/download/upload (`shared_folders` table, `/folders` API, `UploadBatchRegistry`) on top of the existing single-file pipeline. Fixed 3 live-only defects (non-Latin-1 filename header crash, two `react-native-saf-x`/`react-native-blob-util` SAF quirks). Protocol: `docs/11_File_Transfer.md` §6. |
| P13.1 | Android | Added folder Open + a folder-specific completion notification; found (not yet fixed) that two same-named shared folders merge on-device. |
| P13.2 | Android | Fixed P13.1's gap: `folderIdentity.ts`, an id-keyed local registry for on-device folder-name disambiguation and content-change detection. |
| P13.3 | Android | Full-lifecycle audit; fixed 4 bugs from 5 independently-polled, non-cross-notified status sources (missing existence check, a naming race, a reconciliation-notify gap, a wrong-id-space queue-label bug). |
| P13.3 correction | Android | Fixed a regression the P13.3 queue-label fix introduced (a lone download briefly showing "Queued" during its own async startup window). |
| P14.1 | Android | Added a long-press context menu (`FileActionMenu.tsx`, RN `Modal`) with Open/Details. |
| P14.2 | Android | Made a discovered device tappable, jumping straight into the QR scanner with a best-effort IP/port match check and a full camera-permission state machine. |
| P14.3 | Android (feature) | Added a Settings screen to pick a custom SAF download folder instead of the default `Downloads/Relay`; fixed an "Invalid root Uri" defect on custom-location folders. |
| P14.4 | Android | Added Transfers "Clear History" (Android-local filter only, never a backend delete); fixed a naive-timestamp UTC-interpretation bug found during verification. |
| P15 | Backend | Fixed a `Transfer` row left `IN_PROGRESS` forever when its source file disappeared mid-request — now finalized `FAILED` before the exception propagates. |
| P16 | Android | Fixed a same-basename download-identity collision (existence checks/Open keyed on `file_name` instead of `shared_file_id`) — see `CLAUDE.md`'s "Android Download Identity (P16)" convention. |
| P17 | Android | Fixed `shared_folder_id` reuse after SQLite id-recycling — `folderIdentity.ts` now also validates `shared_at`. See `CLAUDE.md`'s "Backend ID Reuse (P17)" convention. |
| P18 | All | Stabilization checkpoint (not a fix pass) confirming V1 was ready to leave stabilization for UI/UX finishing. Identified two backlog items (`fileIdentity.ts`'s own id-reuse gap; `[QR-DEBUG]` logging, later removed in P31.1) without fixing them, per this milestone's scope. |

---

# 5a. Product-Polish, UI/UX & Packaging Milestones (P19–P53)

P18 closed stabilization; everything from here on is UI/UX finishing work
(`docs/issues/New_Issues.txt`, implemented across P19–P36), a further
defect-fix pass (P29/P37), packaging/release (P38–P51,
`docs/12_Packaging_Deployment.md`), and public distribution setup
(P52–P53). All are **Completed**. Full investigation/verification detail
lives in `docs/15_QA_NOTEBOOK.md`'s same-numbered entry.

| # | Area | Outcome |
|---|---|---|
| P19 | Desktop | Visual foundation: shared header/empty-state primitives, CSS design tokens, nav underline, pairing-aware startup routing. |
| P20 | Desktop | Redesigned every Pairing-tab state with icon badges, a two-column QR layout, and outcome-aware styling. |
| P21 | Desktop | Added Clear History (client-side marker), human-readable file-type display, a received-item view in Shared Files, and Delete semantics. |
| P21.1 | Android | Fixed a folder-status flicker and added folder-level grouping to the Transfers tab. |
| P21.2 | Android | Fixed a folder download-button flicker at 100-file scale (treat "underway" from the first completed/active child). |
| P22 | Android | Added per-state long-press file actions, real `ACTION_SEND` sharing (`react-native-share`), and a shared `metadataFormat.ts`. |
| P23 | Android | Added an editable device display name, hand-drawn SVG nav icons, a real launcher icon, moved Clear History into the header. |
| P24 | Android | Made a discovered device tappable into the QR scanner; added a camera-permission state machine. |
| P25 | Desktop | Removed the user-facing session-token-lifetime control, added a matching app icon, removed the default Electron menu bar. |
| P26 | Android | Added an upload-confirmation bottom sheet between picking a file/folder and proposing the transfer. |
| P27 | Desktop | Re-verified several already-fixed items; added icon-led empty states and an inline icon-badge card variant. |
| P28 | Desktop/Android | Unified Shared Files'/Android Files' own "Clear History" onto the same marker/cutoff as each platform's Transfers history. |
| P29 | Desktop | Fixed `shell:deleteItem` to treat an already-missing target as success; added inline device rename. |
| P29.1 | Desktop | Fixed P29's rename fix (CSP silently blocks `element.style`) with a CSS class toggle — the durable pattern for any future dynamic style change. |
| P30 | Desktop/Android | Added one confirmation-dialog primitive per platform (`confirmDialog()` / `AppDialog`), replacing native `confirm`/`Alert.alert`. |
| P31 | All | Full UI/UX audit against `New_Issues.txt`, producing the P32–P36 backlog. |
| P31.1 | Android | Removed leftover `[QR-DEBUG]` logging that surfaced as a Console Error overlay on an already-handled failure. |
| P32 | Desktop | Fixed an unbounded-width table column (`table-layout: fixed` + widths) and made a row action failure fail into a row-scoped error. |
| P33 | Desktop | Replaced the CSP-blocked transfer progress bar with a native `<progress>` element. |
| P34 | Desktop | Replaced a raw folder emoji with the app's SVG icon; matched Android's destructive-red Clear History button. |
| P35 | Android | Replaced folder-row emoji with the SVG icon; standardized the destructive/error color to `#dc2626`. |
| P36 | All | Widened the gap between the app icon's two-arrows glyph tips across every asset. |
| P37 | Backend/Desktop/Android | Audit-only. Found two real packaging blockers (cleartext LAN traffic blocked on release builds; debug-keystore signing fallback); recommended PyInstaller + electron-builder/NSIS. |
| P38 | Backend | Built a verified, self-contained `relay-backend.exe` (PyInstaller `--onedir`); pinned dependencies into a production/dev-test/build-only split. |
| P39 | Desktop | Added `electron-builder` (NSIS, per-user install); wired in P38's backend bundle; fixed `Settings.PORT` not reflecting the actual bound port. |
| P40 | Android | Fixed cleartext-LAN blocking and the debug-keystore signing fallback; produced a real (local-verification-signed) release APK. |
| P41 | All | Verified the packaged installer, bundled backend, and release APK together over a real LAN. No release blockers. |
| P42 | Repo/docs | Hygiene pass — no application behavior changed. Removed two genuinely unused files; archived `New_Issues.txt` (still cited by section number). |
| P43 | Backend/Android | Fixed duplicate Desktop device rows for the same phone — `device_identifier` now persists once per install and reconciles onto the existing row. |
| P43.1 | Backend/Desktop | Resolved the name-collision case P43 left open (a reinstalled phone resubmitting its old name) with a Replace/Make-new choice. |
| P44 | Desktop | Fixed Open/Show in Folder on a received item deleted outside Relay — now existence-checked first. |
| P45 | Desktop/Android | Fixed shortcut/Control Panel metadata, missing Publisher/Company, the Android launcher name, and an installer progress-bar backward jump. |
| P46 | All | Release-candidate audit. Found one real gap (no in-app recovery when a paired Android device's stored desktop address goes stale) — deliberately left unfixed pending scoping. |
| P47 | Android | Fixed P46's gap: a Settings "Forget this desktop" action returns to pairing without uninstalling. |
| P48 | Backend/Desktop/Android | Final production rebuild and sign-off from `main` HEAD, physically re-verified on real hardware. **Verdict: SHIP.** |
| P49 | Process/architecture | Investigation-only. Decided the $0 distribution architecture: GitHub Pages website, GitHub Releases as sole artifact host, unify on version `1.0.0`, production Android signing required before public release, Windows ships unsigned. |
| P50 | Android | Generated a real production signing keystore (stored outside the repo) and rebuilt/verified the release APK with it, including a same-key update-continuity test. |
| P51 | Backend/Desktop/Android | Applied the `1.0.0` version convention across all three components; rebuilt and re-verified every artifact. |
| P52 | Website | Built the GitHub Pages site (`web/`) — overview, features, download section, requirements, GitHub link. |
| P53 | Release | Verified P51's artifacts still matched HEAD, prepared release notes, wired the website to the real GitHub Release asset URLs. **The GitHub Release itself was subsequently published** (tag `v1.0.0`, all three assets, live) — see `docs/12_Packaging_Deployment.md` §16. |

---

# 6. Current Known Open Items

The following are the genuinely unresolved or deliberately accepted V1
limitations as of `v1.0.0`'s release — everything else found during
T1–P53 has been fixed and verified. See the named milestone in
`docs/15_QA_NOTEBOOK.md` for full detail on any entry.

- **The Windows installer is not code-signed** (out of scope for V1,
  deliberate — no genuinely free option puts Relay's own name on the
  certificate; see `docs/12_Packaging_Deployment.md` §12). Android, by
  contrast, now ships with a real production signing identity (P50).
- **Windows Firewall's first-run consent prompt has never appeared** in
  this development environment (P39, P41, re-confirmed working regardless
  on a Public network profile in P46) — unconfirmed on a genuinely fresh
  end-user machine, not known to be broken.
- **Android's Files and Transfers screens share one Clear History marker
  but don't live-sync it** — clearing history from Files doesn't
  retroactively filter an already-mounted Transfers screen until it's
  cleared there too or the app restarts (P41).
- **`fileIdentity.ts` has the same `shared_files.id` reuse gap P17 fixed
  for `folderIdentity.ts`.** `shared_files.shared_at` is already available
  as the same independent signal; not yet wired in. Reachable only via an
  unshare-to-empty-then-reshare sequence, not normal use — technical debt,
  not a blocker (P18).
- **No checksum/content-change verification** — a byte-identical-size
  content edit inside a shared folder is undetectable (explicitly deferred
  for all of V1, not just folders).
- **Orphaned local files are not cleaned up** when a folder child is
  renamed/removed and later reconciled (P13.2), and folder-upload's
  materialize-to-cache temp files are never deleted (P13) — accepted V1
  trade-offs.
- **On-device identity/state registries** (`folderIdentity.ts`,
  `fileIdentity.ts`, the download-location marker, the history-reset
  marker) live in app-private storage and do not survive a reinstall.
- **No automatic Desktop-address rediscovery** if a paired Android
  device's network changes (switching Wi-Fi/hotspot) — P47 added a
  user-triggered "Forget this desktop" recovery path instead of automatic
  reconnection or network scanning.
- **`react-native-saf-x`'s folder picker intermittently fails** with
  "Unsupported Uri" on some devices (realme C65 5G, RMX3997) —
  self-recovers on retry, no data loss; an accepted library-level V1
  limitation (P48).
- **True SAF permission-grant revocation was never exercised live** — this
  device's OEM shell (ColorOS/RealmeUI) blocks the ADB commands that would
  otherwise force that state (P14.2, P14.3).

**Resolved, not to be re-investigated:** packaging (P38–P41, P48);
Android `ACTION_SEND` sharing (P22); device lifecycle/re-pairing
duplication (P43, P43.1); stale received-item handling on Desktop (P44);
production Android signing (P50); backend/Desktop/Android version
unification at `1.0.0` (P51); the GitHub Pages website (P52); the
published GitHub Release (P53).

---

# 7. Bug Classification

**Critical** — Data loss, security vulnerability, crash, corrupted
transfer, authentication bypass.

**High** — Major feature unusable, broken pairing, broken transfer,
packaging failure.

**Medium** — Incorrect UI behavior, minor workflow issue, performance issue.

**Low** — Cosmetic issue, documentation issue, logging improvement.

---

# 8. Completion Criteria

Relay Version 1 is considered complete when:

- All validation milestones are complete.
- No Critical defects remain.
- No High defects remain.
- Documentation matches implementation.
- Packaging succeeds.
- End-to-end workflows pass.
- Installation works on a clean machine.

---

# 9. Scope

This phase validates the existing implementation. New features are outside
the scope of this document unless required to resolve verified defects
discovered during testing.
