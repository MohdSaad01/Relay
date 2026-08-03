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