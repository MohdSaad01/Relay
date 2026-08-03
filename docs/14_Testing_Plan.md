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

Objective

Validate complete Relay workflows across the entire system.

Includes:

- Discovery
- Pairing
- Authentication
- Shared files
- Transfer requests
- Uploads
- Downloads
- Cancellation
- Session expiration
- Device removal
- Recovery after failures

---

## T6 — Cross-Platform Validation

Objective

Validate interaction between all Relay components.

Includes:

- Backend ↔ Electron
- Backend ↔ Android
- Electron ↔ Android
- Multi-device behavior
- Network interoperability
- State consistency
- Cross-platform workflows

---

## T7 — Reliability & Stress Testing

Objective

Evaluate long-term stability and robustness.

Includes:

- Large files
- Many small files
- Long-running transfers
- Network interruptions
- Process restarts
- Concurrent requests
- Resource cleanup
- Memory usage

---

## T8 — Packaging & Installation

Objective

Prepare Relay for distribution.

Includes:

- Backend packaging
- Electron packaging
- Android release build
- Installer validation
- Data directories
- Logging
- Upgrade path

---

## T9 — Release Candidate

Objective

Prepare Relay Version 1 for public release.

Includes:

- Final documentation review
- README verification
- Security review
- Dependency review
- License review
- Regression testing
- Versioning
- Changelog
- Final release checklist

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