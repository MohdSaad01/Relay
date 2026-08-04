# Validation & Testing Plan

Version: 1.0

---

# 1. Purpose

This document defines the validation phase for Relay Version 1.

All planned implementation milestones (M1–M15) are considered complete.

From this point onward, the project's focus changes from feature development to validation, integration, testing, packaging, and release preparation.

The objective is to verify that every implemented component behaves correctly when integrated into the complete system.

---

# 2. Validation Principles

Validation follows these principles:

- No new features unless required to fix a verified defect.
- No architectural redesign unless an implementation bug exposes a genuine flaw.
- Every issue must be reproduced before being fixed.
- Every fix must include validation.
- Every validation milestone must end with a testing checklist.
- Never continue automatically to the next validation milestone.

---

# 3. Validation Milestones

## T1 — Environment & Build Validation

### Status

**Completed**

### Summary

Validated that every major Relay component can be installed, built,
started, and shut down successfully in a development environment.

Validated components:

- Backend
- Electron Desktop
- Android

Validation included dependency installation, startup, shutdown, build
verification where possible, and development tooling.

### Issues Found

No implementation defects were found.

The following documentation/environment observations were recorded:

- Root README.md is missing.
- CLAUDE.md contains milestone information that is behind the current project state.
- Android native build could not be validated because the required Android
  SDK, JDK, and adb tooling were unavailable in the validation environment.

No source code changes were required.

### Result

Environment and build validation completed successfully.

Verified:

- Backend installs and starts correctly.
- Electron starts correctly and launches the backend.
- Android JavaScript toolchain validates successfully.
- Existing automated test suites pass.

Native Android compilation remains pending a machine with the Android SDK
installed.

---

## T2 — Backend Validation

### Status

**Completed**

### Summary

Validated the backend as an independent system using complete end-to-end
workflow testing rather than isolated endpoint testing.

Validated workflows included:

- Pairing
- Authentication
- Device Discovery
- Shared Files
- Transfer orchestration
- Streaming
- Database lifecycle
- Error handling
- Security validation

### Issues Found

Four verified defects were identified and corrected:

1. Upload path traversal vulnerability
2. Streaming race condition returning HTTP 200 instead of HTTP 409
3. Discovery initialization failure on a fresh database
4. Expired session deletion rolled back during request teardown

All fixes were covered by new regression tests.

### Result

Backend validation completed successfully.

Regression status:

- 276 tests passed
- 2 skipped
- Ruff clean

No remaining blocking backend defects were identified.

---

## T3 — Electron Desktop Validation

### Status

**Completed**

### Summary

Validated the Electron desktop application against the implemented backend
using real application execution rather than static inspection.

Validated areas included:

- Backend lifecycle
- Window lifecycle
- Tray behavior
- Single-instance enforcement
- Renderer
- IPC
- Context isolation
- Content Security Policy
- Devices
- Pairing
- Shared Files
- Transfers
- Settings
- Backend communication
- Backend recovery

### Issues Found

One verified defect was identified and corrected.

Root cause:

- Backend timestamps are serialized as naive UTC while the renderer parsed
  them as local time.

User-visible impact:

- Pairing attempts could remain on an expired QR indefinitely.
- Incorrect timestamps throughout the desktop application.

The renderer now consistently interprets backend timestamps as UTC and
correctly detects pairing expiration.

### Result

Desktop validation completed successfully.

No remaining blocking Electron defects were identified.

Note:

The desktop currently has no automated UI test framework. Validation for
this milestone was performed against the live application using Electron
and Chrome DevTools Protocol.

---

## T4 — Android Validation

### Status

**Completed**

### Summary

Validated the Android application as an independent product via full
source review of every layer under `android/src/` (session, pairing,
discovery, API client, shared files, transfers, streaming, foreground
service, navigation) cross-checked against `backend/README.md` and the
approved M15 design notes embedded in the code's own module comments, plus
manifest/permission inspection and the existing Jest suite (96 tests, 20
suites).

Validated workflows and areas included:

- Discovery (UDP listener lifecycle, staleness eviction, focus-scoped
  start/stop)
- Pairing (QR decode/validation, submit, poll-for-result, session commit)
- Secure session storage (Keychain-backed, corrupted-entry handling,
  restore-on-launch)
- Authentication (bearer token attachment, 401 → automatic session clear
  → navigation back to pairing)
- Shared files (list/refresh, sanitized Android view)
- Transfers (propose/withdraw/cancel, request/transfer list polling,
  upload-source registration and promotion across app screens)
- Streaming (download/upload via react-native-blob-util, progress
  reporting, cancellation, filename-conflict/oversized/undersized handling)
- Foreground service (notification lifecycle tied to stream start/stop,
  manifest service declarations, `POST_NOTIFICATIONS` best-effort request)
- Background behavior (module-level singletons for session/discovery/
  stream state, independent of screen mount/focus)
- Navigation (root auth-state switch, per-tab stacks, back-navigation
  reset on pairing failure)
- Permissions (camera, notifications, manifest merging from third-party
  libraries)
- Session recovery / state restoration (restore-before-render gate in
  `RootNavigator`, in-memory-only upload-source and stream state
  deliberately not surviving an app restart, matching V1's "no resume"
  scope)

### Issues Found

One verified defect was identified and corrected.

**Race condition in `TransferStreamManager.start()` (High — broken
transfer):**

`start()` guarded against a second concurrent stream using the
module-level `state` singleton, but `state` was only marked `'streaming'`
*after* `await`ing the `POST_NOTIFICATIONS` permission request. Two
`start()` calls fired back-to-back — e.g. two `TransferProgressDetail`
screens mounting in quick succession for two different in-progress
transfers — both passed the guard checks before either had committed
`state`, so both began streaming concurrently. This broke the
module's documented one-active-stream-at-a-time invariant: the second
call's `activeTask` silently overwrote the first's, making the first
stream impossible to cancel through the UI (`cancelActive()` only ever
acts on the current `activeTask`), while both streams' notifications and
progress updates raced against each other.

Reproduced by calling `TransferStreamManager.start()` twice back-to-back
in a unit test and observing `downloadFile` invoked twice instead of
once.

**Fix:** added a synchronous `starting` guard flag, set immediately after
`start()`'s existing guard checks (before the first `await`) and cleared
once `state` itself is committed to `'streaming'`. This closes the race
without changing the existing timing of when `state.status` becomes
`'streaming'` relative to the actual `downloadFile`/`uploadFile` call —
preserving the behavior several other existing tests (and `cancelActive()`
itself) already depend on.

A regression test (`start() calls fired back-to-back do not both begin
streaming`) was added to `TransferStreamManager.test.ts`, verifying
`downloadFile` is invoked exactly once when two `start()` calls race.

No other verified defects were found. Two areas were reviewed and judged
to be deliberate, documented design choices rather than defects:
`TransferProgressDetail` briefly showing `'streaming'` before failing an
upload whose local file source didn't survive an app restart (V1 has no
resume support, per the module's own comments), and Android's lack of a
proactive client-side `session_expires_at` check (the backend has no
renewal endpoint, so any 401 is already treated as a dead session).

### Result

Android validation completed successfully.

Regression status:

- 97 tests passed (96 existing + 1 new regression test), across 20 suites
- `tsc --noEmit` clean
- `eslint` clean on the changed files

No remaining blocking Android defects were identified.

---

## T5 — End-to-End Integration

### Status

**Completed**

### Summary

Validated Relay as a complete integrated system across Backend,
Electron Desktop, and Android.

Validated complete workflows including:

- Discovery
- Pairing
- Authentication
- Session restoration
- Shared Files
- Transfer proposal
- Desktop approval and rejection
- Streaming
- Cancellation
- Device removal
- Backend restart
- Cross-component state consistency

The focus was validating interaction between components rather than
individual features.

### Issues Found

One verified integration defect was identified and corrected.

Root cause:

- Starting a new pairing attempt discarded an already-approved pairing
  result before Android collected its one-time credentials.

User-visible impact:

- The device became permanently paired in the database but could never
  receive its session credentials.
- Re-pairing was blocked because the device was already registered,
  leaving the workflow in a dead-end state.

The pairing manager now preserves approved and rejected pairing attempts
until they are either collected by the Android client or naturally expire.

Regression tests were added to cover both the manager behavior and the
complete API workflow.

### Result

End-to-end integration validation completed successfully.

Regression status:

- 280 tests passed
- 2 skipped
- Ruff clean

No remaining blocking end-to-end integration defects were identified.

### Follow-up

One usability gap was identified but intentionally left unchanged:

- Android currently has no in-app recovery flow after the desktop's
  network address changes. Resolving this requires new UI behavior
  rather than a defect fix and is therefore outside the scope of T5.

---

## T6 — Cross-Platform Validation

### Status

**Completed**

### Summary

Validated Backend, Electron Desktop, and Android as independent
implementations of one shared protocol, checking for drift rather than
internal correctness (already covered by T2-T5). For every endpoint and
payload documented in `backend/README.md`, the actual field names, enum
values, status codes, and constants used by the Electron and Android
clients were traced directly against the backend's Pydantic schemas
(`app/schemas/`), enums (`app/models/enums.py`,
`app/services/transfer_manager.py`), and configuration
(`app/core/config.py`) — not inferred from documentation.

Validated:

- API contract consistency (all REST endpoints, request/response bodies)
- `ApiResponse` envelope parsing (`{success, message, data}`) on both clients
- Pairing flow field names (`POST /pairing/start` through
  `GET /pairing/result/{token}`)
- QR payload compatibility (`PairingQrPayload`: `desktop_ip`, `port`,
  `pairing_token`, `protocol_version`, `relay_version`)
- Discovery packet compatibility (`DiscoveryAnnouncePayload`, UDP port
  `40890`, `type` literal `relay_discovery_announce`)
- Protocol version enforcement (`PAIRING_PROTOCOL_VERSION = 1`, checked by
  Android's QR decoder)
- Authentication flow (`Authorization: Bearer` header, loopback-trust
  exemption on desktop, 401 handling on Android)
- Session lifecycle (no renewal endpoint on either side — both clients
  correctly treat any 401 as a dead session rather than assuming renewal)
- Transfer lifecycle and streaming (`TransferDirection`: `send`/`receive`;
  `TransferRequestStatus`: `pending`/`accepted`/`rejected`; `TransferStatus`:
  `in_progress`/`completed`/`failed`/`cancelled`; download/upload headers
  and error codes)
- Error-response consistency (400/401/404/409/422/500 handling on both
  clients)
- Date/time handling (Electron's UTC-aware `parseApiDateTime`, confirming
  the T3 fix remains correct; Android performs no client-side date parsing
  at all, so it has no equivalent bug surface today)
- Shared constants: default port `8000`, API prefix `/api/v1`, discovery
  port `40890`, pairing protocol version `1`

### Issues Found

No verified cross-platform compatibility defects were found.

Every field name, enum value, status code, and shared constant used by the
Electron and Android clients was traced against the backend's actual
schemas and matched exactly — no mismatched field names, diverged
constants, or protocol drift was identified.

Two observations were noted but are **not defects** and require no code
change:

- Android's discovery listener (`DiscoveryService.ts`) validates that
  `protocol_version` is a number but does not check it equals the expected
  value, unlike the QR pairing flow which does enforce equality. This is
  inconsequential: `DiscoveryScreen` is purely informational (device list
  only) and pairing itself always goes through the QR flow, which already
  enforces the version check independently.
- Android has no client-side date-parsing code path at all today (every
  ISO timestamp field is stored/passed through as an opaque string, never
  rendered). This means the naive-UTC-string-parsed-as-local-time bug class
  that T3 found and fixed on Electron cannot currently occur on Android —
  but nothing would prevent it if a future screen added `new Date(iso)`
  without UTC normalization. No fix is applicable now since there is no
  current defect and no existing code path to correct.

### Result

Cross-platform validation completed successfully.

No source code changes were required.

No remaining blocking cross-platform defects were identified.

---

## T7 — Reliability & Stress Testing

### Status

**Completed**

### Summary

Evaluated Relay's backend robustness under sustained use, concurrency, and
failure scenarios, using real multi-threaded stress harnesses and a real
`uvicorn` server process rather than sequential simulated calls — the
previous milestones (T1-T6) validated correctness of individual call
sequences; this milestone specifically targeted behavior only genuine
concurrency or process-level failure can expose.

Validated:

- Concurrent transfer-request accept/reject races (20-way concurrency
  against a single pending request)
- Concurrent duplicate downloads of the same transfer (`ActiveStreamRegistry`
  under real thread contention, not simulated sequential calls)
- Concurrent writes under SQLite (300 concurrent `PATCH /devices/{id}` calls
  against the production `QueuePool` configuration)
- 200 concurrent small transfer proposals (`TransferManager` under load)
- Repeated pairing cycles without Android ever collecting the result
  (`PairingManager` growth bounded by `PAIRING_TOKEN_TTL_SECONDS`, self-heals
  via the sweep every `get`/`submit_request`/`claim_for_approval`/
  `collect_result` call already performs)
- Large-file download code path (chunked disk reads, no server-side
  buffering) by code inspection of `TransferStreamService._generate_download`
- Backend restart / process recovery: an `in_progress` transfer and an
  orphaned upload temp file surviving a hard-killed server process,
  reproduced against a real `uvicorn` subprocess and a real SQLite file

### Issues Found

Two verified reliability defects were identified and corrected. Both share
the same root cause: nothing in the codebase reconciled runtime state after
an unclean backend shutdown, contradicting `docs/09_Networking.md` §9's
requirement that Relay "gracefully handle... backend restarts."

**1. Transfers left `IN_PROGRESS` by an unclean shutdown never reach a
terminal state (Medium — stale database state):**

`ActiveStreamRegistry` and `TransferManager` are in-memory and reset on
every process start, by design. But a `Transfer` row already in
`IN_PROGRESS` is persisted, and nothing ever swept it back to a terminal
status on the next startup. Reproduced by accepting a `receive` transfer
request (creating an `IN_PROGRESS` row), killing the server process before
any bytes were uploaded, and restarting it against the same database: the
transfer's status remained `in_progress` indefinitely, with no way for it to
ever change, since V1 has no resume support (`docs/11_File_Transfer.md`
§16) and no client would retry a request it never itself sent.

**Fix:** `TransferService.reconcile_interrupted_transfers()`
(`app/services/transfer_service.py`) marks every `IN_PROGRESS` transfer
`FAILED` with `failure_reason="Interrupted by backend restart."`, reusing
the existing `TransferRepository.list_by_status` query. Called once at
startup from `app/main.py`'s `lifespan`, in its own short-lived session (the
same pattern `DiscoveryService` already uses for its background ticks,
since this runs outside any request scope).

**2. Orphaned upload temp files survive a crash indefinitely (Low —
temporary-file leak):**

`TransferStreamService.receive_upload`'s `finally` block already discards
its temp file on every *clean* failure path (oversized/undersized upload,
client disconnect, `OSError`) — all already covered by existing tests. A
hard process kill skips that `finally` block entirely, so a
`.relay-upload-*` file mid-write at the moment of a crash is left in
`app_settings.download_directory` forever, since a completed upload only
ever renames it away via `os.replace`.

**Fix:** `TransferStreamService.cleanup_orphaned_upload_temp_files()`
(`app/services/transfer_stream_service.py`) removes any file matching the
(now-named-constant) `_UPLOAD_TEMP_FILE_PREFIX` still present in the
download directory at startup — by construction, any such survivor can only
be an interrupted upload. Best-effort (never raises on a missing/unreadable
directory), matching the existing `_discard_temp_file` policy. Called from
the same startup step as fix 1 above.

Both fixes were verified against a real `uvicorn` subprocess: a transfer was
accepted and left `IN_PROGRESS`, an orphaned temp file was seeded, the
process was hard-killed (`SIGKILL`-equivalent, not a clean shutdown), and a
fresh process started against the same database and download directory —
confirming the transfer reconciles to `failed` and the orphaned temp file is
removed on the very next startup.

No other verified defects were found. Two observations were investigated
and judged not to be defects:

- An `AttributeError` surfaced during an early concurrency probe that used
  `tests/api/conftest.py`'s existing `StaticPool` + `sqlite:///:memory:`
  pattern with genuine multi-threaded requests. Root-caused to that pattern
  sharing one single physical SQLite connection object across every
  concurrent thread — safe for the existing sequential test suite, but not
  safe for true concurrent access. Re-running the same races against a
  file-based database with the production default `QueuePool` (a distinct
  real connection per session, exactly as `app/database/session.py`
  configures it) produced zero errors across all races. This is a test-only
  harness limitation, not a production code defect — no source change was
  made, and any future concurrency test should use a file-based database
  fixture rather than the shared-connection `StaticPool` pattern.
- Repeated pairing cycles that are approved but never collected by Android
  do accumulate in `PairingManager` within a single `PAIRING_TOKEN_TTL_SECONDS`
  (300s) window, since `start()` only evicts non-terminal attempts and
  terminal ones are swept only by their own expiry. In practice this
  self-heals: every `submit_request`/`claim_for_approval`/`collect_result`
  call already performs a full expiry sweep, so any real, continued pairing
  activity bounds the dict's size to TTL × request rate. Not a defect for
  Relay's single-desktop, single-user usage model; `cleanup_expired()` (on
  both `PairingManager` and `TransferManager`) remains unused dead code but
  is not a correctness issue.

### Result

Reliability and stress-testing validation completed successfully.

Regression status:

- 286 tests passed (280 existing + 6 new regression tests), 2 skipped
- Ruff clean

No remaining Critical or High reliability defects were identified.

---

## T8 — Packaging & Installation

### Status

**Completed**

### Summary

Validated Relay's production packaging and installation posture. Unlike
T1-T7, this milestone found that no production packaging pipeline exists
yet to validate end-to-end:

- Backend: no PyInstaller (or equivalent) spec or entrypoint script, and no
  such dependency declared in `requirements.txt`/`requirements-dev.txt`.
  `desktop/src/main/backend-manager.js`'s `resolveCommand()` already
  documents this: the packaged executable path
  (`resources/backend/relay-backend.exe`) is a placeholder for a decision
  explicitly deferred to "the Packaging milestone" (`docs/12_Packaging_Deployment.md`
  §4).
- Electron: `desktop/package.json` has no `build` configuration and no
  `electron-builder`/`electron-forge` dependency — only a dev-mode
  `"start": "electron ."` script. No installer exists to inspect.
- Android: the release build type in `android/android/app/build.gradle`
  signs with the React Native template's default debug keystore, which is
  the template's own placeholder ("Caution! In production, you need to
  generate your own keystore file.") rather than a Relay-specific defect.

Because no build artifacts exist, most of this milestone's checklist
(installer validation, executable startup after installation, dependency
inclusion, clean uninstall behavior) has nothing to exercise yet. The parts
that could be validated without any packaging tool — production
configuration, relative paths, working directories, logging locations, and
database locations — were validated by tracing the already-shipped code
that will govern that behavior once packaging exists, and by reproducing
its effect directly (spawning the backend from a simulated packaged working
directory).

### Issues Found

One verified defect was identified and corrected.

**Packaged backend would write user data inside its own install directory
(High — packaging failure):**

`backend/app/core/config.py` defaulted `DATABASE_URL` to
`sqlite:///./relay.db` and `LOG_DIR` to `logs` — both resolved relative to
the process's current working directory. `backend-manager.js`'s
`resolveCommand()` (already-shipped code, independent of whether the
packaged executable itself exists yet) sets the packaged backend's working
directory to `path.dirname(exe)`, i.e. inside the application's own
`resources/backend/` folder.

Reproduced by invoking `app.core.config.get_settings()` with the process's
working directory set to a location standing in for the packaged install
directory: the SQLite database and `logs/` directory resolved inside that
same directory rather than a user-writable, install-independent location.

This contradicts `docs/12_Packaging_Deployment.md`'s "Windows Data Storage"
requirement that user data (database, configuration, logs) live in the
local application data directory, separate from application binaries.
Concretely, once packaging exists this would risk: a startup failure on a
per-machine install to `Program Files` (unwritable without elevation), and
loss of the transfer/pairing database and logs on uninstall or upgrade even
for a per-user install, since both replace the `resources/` tree.

**Fix:** `config.py`'s `DATABASE_URL`/`LOG_DIR` defaults now resolve under
a `RELAY_DATA_DIR` environment variable when it is set, falling back to
today's relative paths when it is not — so local development (which never
sets it) is unaffected. `backend-manager.js` now launches the packaged
backend with `RELAY_DATA_DIR` set to Electron's own `app.getPath("userData")`,
the same directory its own `Logger` already uses. An explicit `DATABASE_URL`
or `LOG_DIR` (env var or `.env`) continues to take priority over both, so
existing override behavior is unchanged.

Regression tests were added in `backend/tests/core/test_config.py` covering
the default with and without `RELAY_DATA_DIR` set, and confirming an
explicit `DATABASE_URL`/`LOG_DIR` still overrides it.

### Result

Packaging validation completed with one defect found and corrected.

Regression status:

- 293 tests passed (286 existing + 7 new), 2 skipped
- Ruff clean

Not yet validated, and out of scope for this validation-only milestone
(no implementation exists to exercise):

- Backend packaging (PyInstaller or equivalent), including the
  `--port`-parsing entrypoint `resolveCommand()` already assumes
- Electron production build/installer (`electron-builder`/`electron-forge`
  configuration)
- Android release signing (currently the RN template's debug keystore)
- Installer behavior, clean uninstall, and upgrade path
- Dependency inclusion in a packaged build

These remain open work for a future packaging implementation milestone,
separate from this validation phase.

---

## T9 — Release Candidate

### Status

**Completed**

### Summary

Performed the final Release Candidate review across the complete Relay
Version 1 codebase.

The review covered:

- Backend
- Electron desktop
- Android client
- Documentation
- Repository structure
- Dependency management
- Configuration
- Security
- Logging
- Test coverage
- Version consistency
- Repository hygiene
- Release readiness

The entire project was evaluated as a single product rather than
individual components.

### Issues Found

No Release Blocking defects were identified.

No High severity defects were identified.

The review found only release-process items:

- T7/T8 validated fixes remain uncommitted.
- Backend dependencies should be version-pinned.
- LICENSE has not been chosen.
- Root README.md is missing.
- CLAUDE.md milestone history is outdated.
- Version numbers differ between backend, desktop, and Android.

None of these require architectural or feature changes.

### Result

Relay Version 1 is suitable to become a Release Candidate.

Regression status:

- 293 tests passed
- 2 skipped
- Ruff clean

No additional implementation work is required before declaring the codebase
feature complete.

Future work consists of release engineering, documentation,
packaging, UI polish, and user testing.

---

## P1 — Workflow Simplification (Automatic Uploads)

### Status

**Completed**

### Summary

Product-polish follow-up to T9's Release Candidate: simplified the upload
workflow to match the download workflow, removing a manual desktop
approval step that added friction without adding real protection.

Previously: Android proposes an upload → desktop sees it under "Incoming
Transfer Requests" → desktop user explicitly accepts or rejects it → only
then does the `Transfer` row exist and streaming become possible. A
download had already been auto-accepted since T3/T4 (see
`docs/15_QA_NOTEBOOK.md`'s "Download Flow Required Manual Desktop Approval..."
entry); uploads were the one remaining case still requiring a decision.

Since the desktop already explicitly approved the pairing that let a device
propose anything at all, a second manual per-upload approval was redundant
— identical reasoning to why downloads were auto-accepted.

### Changes

- **Backend:** `TransferService.request_transfer` (`app/services/transfer_service.py`)
  now creates the `Transfer` row immediately for both directions instead of
  only for `send`; `accept_request`, `reject_request`, and
  `withdraw_request` were removed, since nothing is ever left `PENDING` for
  them to act on anymore. The corresponding routes
  (`POST /transfers/requests/{id}/accept`, `POST .../reject`,
  `DELETE /transfers/requests/{id}`) were removed from
  `app/api/v1/transfers.py`. `GET /transfers/requests` and
  `GET /transfers/requests/{id}` are unchanged and kept — the first is
  still polled defensively by Android's download-status derivation, the
  second still lets a caller look up a request it just made.
- **Desktop:** `desktop/src/renderer/views/transfers.js` no longer fetches
  `/transfers/requests` or renders the "Incoming Transfer Requests"
  table/accept/reject buttons — the view is just the `Transfers` list now.
- **Android:** `TransferListScreen`'s upload flow now mirrors
  `FilesScreen`'s download flow exactly: `handleUpload` registers the
  picked file's local URI under the `transfer_id` the auto-accepted
  proposal already returns, fetches the `Transfer`, and hands it directly
  to `TransferStreamManager.start()`, rather than navigating to a
  now-nonexistent pending-request screen. `TransferRequestDetail.tsx` and
  `useTransferRequest.ts` were deleted (unreachable — nothing is ever
  pending to view or withdraw), `TransferDetailScreen`'s route param
  collapsed from a `{kind: 'request'|'transfer'}` discriminated union to a
  plain `{transferId: number}`, and `uploadSourceRegistry.ts` dropped its
  two-phase request-id-to-transfer-id promotion (`registerUploadSource` now
  takes the `transfer_id` directly, since it's known synchronously the
  moment the proposal resolves).

### Issues Found

No defects — this was a scoped workflow simplification, not a bug fix.

### Result

Workflow simplification completed successfully.

Regression status:

- Backend: 286 tests passed, 2 skipped (`python -m pytest`); `ruff check`
  clean.
- Android: 21 suites / 118 tests passed (`npx jest`); `npx tsc --noEmit`
  and `npx eslint` clean.
- Desktop: no test suite exists for the plain-JS renderer (unchanged from
  T1); the edited view was syntax-checked and manually traced against the
  simplified `/transfers` response shape.

### Known Limitations

- Live device E2E (confirming an upload picked on Android starts streaming
  immediately with no desktop interaction, and that the desktop's
  Transfers view shows it without ever showing an accept/reject prompt)
  was not re-run as part of this change — no physical device/desktop pair
  was available in the environment the change was made in. Recommended
  before closing this out, consistent with prior milestones' own
  live-device caveats.

---

## P2 — Shared Files UX & Synchronization

### Status

**Completed**

### Summary

Product-polish follow-up, scoped entirely to Android's Files screen
(`android/src/screens/files/FilesScreen.tsx` and `android/src/files/`).
Three issues raised against the current Files UX, all rooted in the same
theme: the screen's per-file status display trusted state it never
re-validated. No transfer, streaming, notification, pairing, discovery, or
authentication code was touched.

### Issues Found

**1. A deleted download still showed "Downloaded" (Medium — incorrect UI
behavior):**

`deriveDownloadStatus()` (`android/src/files/downloadStatus.ts`) mapped a
file straight to `'completed'` whenever its most recent `Transfer` row had
`status === 'completed'`. That status is written once by the backend when
the stream finishes and never changes again — it says nothing about
whether the saved file is still on the device afterward. Deleting the file
manually, clearing the `Relay` Downloads subfolder, or reinstalling the app
all left the `Transfer` row (and therefore the label) exactly as
"Downloaded" forever, since nothing ever re-checked the actual filesystem.

**2. A meaningless "..." button state appeared before every download
(Low — minor workflow issue):**

`FilesScreen.handleDownload` set a local `requesting` flag for the
duration of the `propose → refresh → getTransfer` round trip, and the
button rendered a bare `'...'` for that whole window before flipping to
"Downloading...". Investigation traced this back to
`TransferService._create_transfer` (`backend/app/services/transfer_service.py`):
a download's `Transfer` row is created with `status=IN_PROGRESS` in the
very same call that proposes it (see the "Download Flow Required Manual
Desktop Approval..." entry in `docs/15_QA_NOTEBOOK.md`), so the true state
of the request is already known — "this is now downloading" — for the
entire duration `requesting` was true. The "..." added a step that
communicated nothing the app didn't already know.

**3. Newly shared files did not appear without a manual pull-to-refresh
(Medium — minor workflow issue):**

`useSharedFiles()` fetched the shared-file list once on mount and only
again on an explicit pull-to-refresh gesture. There is no push channel
from desktop to Android for this list (unlike transfers, which Android
already polls — see `TransferListScreen`/`FilesScreen`'s existing
`useTransferRequests`/`useTransfers` polling), so a file shared while the
Android user was already sitting on the Files screen stayed invisible
until they manually pulled down.

### Root Cause

All three trace to the same pattern: FilesScreen's UI reflected a single
snapshot of remote/persisted state (a `Transfer` row's terminal status, or
whatever the shared-file list looked like at last fetch) without a
mechanism to notice that snapshot had gone stale — either because the
on-device world changed independently (the file was deleted) or because
the desktop's world changed and nothing told Android (a new share).

### Changes

- **Issue 1 — on-device existence verification, not a new status enum.**
  `android/src/files/downloadExistence.ts` (new) exports
  `downloadedFileExists(fileName)`, which checks the file's actual save
  location: `Downloads/Relay/<fileName>` under the public Downloads
  directory on API 29+ (where `streaming/blobUtil.ts`'s `publishDownload`
  actually publishes it), or the private staging path below API 29 (where
  `publishDownload` is a no-op and the file never moves). This
  deliberately duplicates those two path constants rather than importing
  them, since `android/src/streaming/**` is out of scope for this
  milestone. `android/src/files/useDownloadExistence.ts` (new) is a small
  hook holding an existence cache keyed by file name, with `verify()` safe
  to call repeatedly (in-flight calls for the same file are deduped, but
  results are never cached forever, since the file can be deleted at any
  time after a prior check found it present). `deriveDownloadStatus()`
  gained a 4th, optional `fileExists` parameter that only matters for the
  `'completed'` case: `false` downgrades the status to `'idle'` (so the
  file can be downloaded again); `true` or the default `undefined`
  ("not checked yet") keeps it `'completed'`, so the UI doesn't flash
  "Download" while a check is still in flight. This is a gate on the
  existing state machine, not a second, duplicate status — `Transfer.status`
  from the backend remains the single source of truth for
  pending/in_progress/failed, and the existence cache only ever narrows
  the terminal `'completed'` case.
- **Issue 2 — show the real state instead of a placeholder.** In
  `FilesScreen.tsx`, `downloadButtonLabel()`'s `requesting` branch now
  returns `'Downloading...'` (the same label as `'in_progress'`) instead
  of `'...'`. No state was removed — `requesting` still exists and still
  disables the button and drives the propose-call error message — only
  its *label* changed, since the underlying transfer is already known to
  be starting a download for that entire window.
- **Issue 3 — focus refresh + a slow, screen-scoped poll, not a push
  channel.** `useSharedFiles()` gained `refreshSilently()` alongside the
  existing `refresh()`: both re-fetch through the same `load()` core, but
  `refreshSilently()` never toggles `loading`/`refreshing`, so it doesn't
  flash the pull-to-refresh spinner. `FilesScreen` calls it once whenever
  the screen regains focus and then every 5 seconds while it stays
  focused (`FILES_POLL_INTERVAL_MS`), via its own `useFocusEffect` —
  deliberately a separate, slower interval from the existing 2-second
  transfer-progress poll on the same screen, since the shared-file list
  changes far less often than an active transfer's byte-level progress. A
  real push channel (WebSockets) was considered and rejected as
  disproportionate to a UX-polish milestone and explicitly out of scope
  per `docs/11_File_Transfer.md` §16's list of deferred enhancements; a
  short, screen-scoped poll (only running while Files is the focused
  screen) was judged the smallest change that fits the existing
  polling-based architecture already used for transfers.

### Result

Shared Files UX validation completed with three issues found and fixed.

Regression status:

- Android: 23 suites / 134 tests passed (`npx jest`), including new
  suites `downloadExistence.test.ts`, `useDownloadExistence.test.tsx`, and
  new cases in `downloadStatus.test.ts` / `useSharedFiles.test.tsx`.
  `npx tsc --noEmit` and `npx eslint` clean on all changed/added files.
- Backend, Desktop: untouched by this milestone.

### Known Limitations

- `downloadedFileExists()`'s API 29+ check relies on this app being able
  to read, via a raw filesystem path, a file it published into MediaStore
  itself. This is the standard behavior scoped storage grants an app for
  its own MediaStore-owned entries, but it was validated by tracing the
  library's native implementation (`react-native-blob-util`'s
  `ReactNativeBlobUtilFS.exists()`, `File(path).exists()`), not on a
  physical device — no device was available in the environment this
  change was made in. Recommended before closing this out, consistent
  with prior milestones' live-device caveats.
- The existence check duplicates two small constants
  (`MEDIASTORE_MIN_SDK`, the `Relay` subfolder name) already defined in
  `android/src/streaming/blobUtil.ts`, instead of importing them, because
  that module was out of scope to modify for this milestone. If
  `publishDownload`'s destination ever changes, `downloadExistence.ts`
  must be updated to match by hand.
- The 5-second shared-files poll only runs while the Files screen is
  focused (matching the existing transfer-poll pattern) — a file shared
  while Android is fully backgrounded still requires the user to return
  to the Files screen (which refreshes immediately on focus) rather than
  appearing via a background/push notification. Consistent with V1's
  existing no-push-channel design.

---

## P3 — Transfer State Consistency & Download Reliability

### Status

**Completed**

### Summary

Product-polish follow-up investigating three reported inconsistencies
between backend `Transfer` state, Android's local streaming state, and
Android's UI. All three were root-caused by full code tracing (backend
`TransferService`/`TransferStreamService`, Android's focus-driven polling
hooks, `TransferStreamManager`, and `react-native-blob-util`'s MediaStore
implementation) rather than treated as independent symptoms, per this
document's own validation principles. See `docs/15_QA_NOTEBOOK.md`'s
Milestone P3 entry for the full investigation notes.

### Issues Found

**1. Transfer appears late on the Transfers tab (Medium — minor workflow
issue):**

Not a backend or API delay: `TransferService._create_transfer`
(`backend/app/services/transfer_service.py`) commits the `Transfer` row
synchronously inside `POST /transfers/requests`, so it already exists in
the database by the time Android's `proposeTransfer()` call resolves.

Root cause was entirely in Android's own polling: `TransferListScreen`'s
and `FilesScreen`'s `useFocusEffect` blocks for transfer/request polling
started a `setInterval` on regaining focus but never called the refresh
function immediately — the first refresh only happened on the interval's
first tick, up to `POLL_INTERVAL_MS` (2000ms) later. Because
`createBottomTabNavigator` keeps tab screens mounted after their first
visit (`unmountOnBlur` is not set), switching from Files to Transfers
after starting a download does not remount `TransferListScreen`, so
nothing forced an immediate re-fetch. This is the same class of staleness
Milestone P2 already fixed for the shared-file list (`refreshSilently()`
called on focus, before the interval starts) — that fix was never applied
to the transfer/request polling in either screen.

**2. Transfer detail screen briefly shows stale progress after Overview
already shows Completed (Medium — incorrect UI behavior):**

`TransferProgressDetail` merges two sources of truth: the server-polled
`Transfer` (`useTransfer`) and, when this app instance is the one actively
streaming, `TransferStreamManager`'s live state (`useTransferStream`). It
preferred the live stream (`useLiveStream = stream?.transferId ===
transferId`) unconditionally, with no check on whether that local state was
actually caught up.

`TransferStreamManager.start()`'s local state does not flip to `'completed'`
(with `bytesTransferred` reset to the full total) until *after* two
awaited, I/O-bound steps that run once the bytes have already fully
arrived: `publishDownload()`'s MediaStore copy and
`notifyDownloadComplete()`'s notification post. Until that finishes, the
local stream state can still report `'streaming'` with whatever partial
byte count its last progress tick observed — even though the backend has
already committed the transfer as `completed` and the Overview list (a
fresh `GET /transfers`) already reflects that. Opening the detail screen
during that window showed the stale, partial local state instead of the
already-accurate server data.

**3. Some downloaded files never appear in `Downloads/Relay` despite their
transfer reporting Completed (High — broken transfer/data-loss-adjacent):**

`publishDownload()` (`android/src/streaming/blobUtil.ts`) asked
`copyToMediaStore` to insert the file's display name verbatim, every time,
with no conflict handling. Unlike the backend's own upload path
(`resolve_available_path`, "name (1).ext" pattern), nothing on the Android
download-publish side accounted for two downloads landing on the same file
name — a genuinely reachable case given Milestone P2's own
existence-check-driven re-download flow (a file whose local copy was
deleted reverts to re-downloadable), or simply two different shared files
that happen to share a basename. A MediaStore insert failing against an
already-taken name is swallowed by `publishDownload`'s deliberately
best-effort error handling (by design, so a publish failure never turns an
otherwise-successful byte transfer into a reported failure), leaving that
download's file stranded at its private, invisible staging path while both
the backend `Transfer` and the local stream state still correctly reported
`completed` — the transfer genuinely succeeded, but the file it produced
was never surfaced to the user.

### Solution

- **Issue 1:** `TransferListScreen`'s `useFocusEffect` and `FilesScreen`'s
  request/transfer `useFocusEffect` now call their refresh function(s)
  immediately on regaining focus, before starting the polling interval —
  the same pattern Milestone P2 already established for
  `useSharedFiles().refreshSilently()`.
- **Issue 2:** `TransferProgressDetail`'s `useLiveStream` now additionally
  requires the freshly-polled `transfer.status` to still be `'in_progress'`
  (`stream?.transferId === transferId && transfer.status === 'in_progress'`).
  Once the server-side transfer reaches a terminal status, it is by
  definition at least as fresh as anything `TransferStreamManager` can
  report, so it wins outright instead of being second-guessed by a
  lagging local view. While the server transfer is genuinely in progress,
  behavior is unchanged — the live stream is still preferred for its
  finer-grained, poll-independent updates.
- **Issue 3:** Added `resolveAvailableMediaStoreName()` in
  `android/src/streaming/blobUtil.ts`, mirroring the backend's
  `resolve_available_path` naming convention ("name (1).ext", "name
  (2).ext", ...). `publishDownload()` now resolves a conflict-free display
  name (checked via a raw filesystem read under the public Downloads
  directory, the same technique — and the same unverified-on-a-physical-
  device caveat — `files/downloadExistence.ts` already relies on) before
  calling `copyToMediaStore`, instead of handing it the requested name
  unconditionally.

### Result

Transfer state consistency validation completed with three issues found
and fixed.

Regression status:

- Android: 23 suites / 137 tests passed (`npx jest`), including three new
  `publishDownload` conflict-resolution cases in `blobUtil.test.ts`.
  `npx tsc --noEmit` and `npx eslint` clean on all changed files.
- Backend: untouched by this milestone (confirmed by code trace that
  `Transfer` persistence is synchronous and not the source of Issue 1) —
  286 passed, 2 skipped (`python -m pytest`); `ruff check app tests` clean.
- Desktop: untouched by this milestone.

### Known Limitations

- None of the three issues could be reproduced live end-to-end — no
  physical Android device/desktop pair was available in the environment
  this change was made in, consistent with every prior milestone's own
  caveat. Issues 1 and 2 were root-caused entirely from Android's own
  JS-level polling/state-merge logic, which is directly exercisable and
  covered by the existing hook/manager test suites; the fixes follow
  directly from that code trace. Issue 3's precise trigger (whether
  `MediaStore.Downloads.insert()` silently fails, reuses an existing row,
  or auto-renames on a `DISPLAY_NAME` collision) is native platform
  behavior that could not be verified without a device — the fix removes
  the collision entirely rather than depending on knowing how the platform
  would have handled it, so it holds regardless of that answer.
- `resolveAvailableMediaStoreName()`'s existence check shares
  `downloadedFileExists()`'s existing, already-documented limitation
  (Milestone P2): it relies on a raw filesystem read being able to see a
  file this app previously published into MediaStore. If that assumption
  ever proves wrong on a real device, the conflict check would under-detect
  (treat a taken name as free) rather than over-detect, which is at worst
  the pre-fix behavior, not a new failure mode.
- Recommended before closing this out: a live-device pass repeating the
  three original scenarios (auto-download from Files while watching the
  Transfers tab; opening a transfer's detail screen immediately after
  Overview shows it Completed; downloading the same file name twice) to
  confirm the fixes hold outside of code tracing and unit tests.

---

# 4. Bug Classification

Critical

- Data loss
- Security vulnerability
- Crash
- Corrupted transfer
- Authentication bypass

High

- Major feature unusable
- Broken pairing
- Broken transfer
- Packaging failure

Medium

- Incorrect UI behavior
- Minor workflow issue
- Performance issue

Low

- Cosmetic issue
- Documentation issue
- Logging improvement

---

# 5. Completion Criteria

Relay Version 1 is considered complete when:

- All validation milestones are complete.
- No Critical defects remain.
- No High defects remain.
- Documentation matches implementation.
- Packaging succeeds.
- End-to-end workflows pass.
- Installation works on a clean machine.

---

# 6. Scope

This phase validates the existing implementation.

New features are outside the scope of this document unless required to resolve verified defects discovered during testing.