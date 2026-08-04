# QA Notebook

Version: 1.0

Practical notes from real issues hit during Relay development — not a
specification. See `docs/08_Architecture_Decisions.md` for architectural
decisions and `CLAUDE.md` for milestone history.

---

# Android Build - CMake/Ninja Path Length Issue

## Problem

On Windows, building the Android app failed with:

```
npx react-native run-android
...
> Task :app:buildCMakeDebug[arm64-v8a] FAILED
ninja: error: Filename longer than 260 characters
```

Both `configureCMakeDebug` and `buildCMakeDebug` were affected. Gradle kept
resolving to `cmake/3.22.1/bin/ninja.exe`, and re-installed CMake 3.22.1 on
every sync even after it was manually uninstalled.

## Investigation

- Installed Android Studio and the Android SDK.
- Fixed `JAVA_HOME`, which was pointing at JDK 25 — switched to JDK 17.
- Ran `npx react-native doctor` to confirm the environment was otherwise
  clean (it reported no errors).
- Enabled Windows Long Paths (registry `LongPathsEnabled`).
- None of the above resolved the error, so investigated why CMake 3.22.1
  specifically kept getting reinstalled.
- Found that AGP (Android Gradle Plugin) silently falls back to its own
  bundled default CMake (3.22.1) for any native module that doesn't
  explicitly pin `externalNativeBuild.cmake.version` — which is exactly the
  case here. Confirmed no version was pinned in any project file.

## Solution

- Installed CMake 4.1.2 via the SDK Manager (alongside 3.22.1).
- Pinned `externalNativeBuild.cmake.version = "4.1.2"` in the app module's
  own `android { }` block, in `android/android/app/build.gradle`.
- Did **not** modify anything under `node_modules`.
- Did **not** manually replace `ninja.exe` in the SDK's CMake folder.
- Rebuilt: `assembleDebug` completed successfully, with the native build
  now running on CMake 4.1.2's `ninja.exe`, and no path-length errors.

## Notes

- Use JDK 17 for this project — newer JDKs (e.g. 25) are not supported by
  the AGP version in use.
- Run `npx react-native doctor` early when debugging build issues — it
  quickly rules out the environment as the cause.
- If this error reappears, check which CMake version Gradle is actually
  invoking (look for `cmake\<version>\bin\ninja.exe` in the build log)
  before trying anything else.
- Prefer fixing this at the project-config level (a `build.gradle` you own)
  over patching SDK files or `node_modules` — those changes don't survive
  a clean SDK install or `npm install` and aren't visible to other
  developers or CI.

---

# Android FilesScreen Stuck on "Requested" After a Completed Download

## Problem

After a full pair → discover → propose → accept → stream flow completed
successfully (desktop and the Android Transfers screen both correctly showed
the transfer as `Completed`), the Android **Files** screen kept showing that
file's Download button as "Requested" indefinitely.

## Investigation

- Traced the button's state from `FilesScreen.handleDownload` forward:
  `downloadStatus` was a local `useState<Record<number, DownloadStatus>>`
  that was set to `'requested'` once `proposeTransfer()` resolved — and
  never touched again.
- `FilesScreen` had no subscription to the actual transfer lifecycle
  (`TransferRequestStatus` accepted → `Transfer.status` in_progress →
  completed). That lifecycle is tracked server-side by `TransferManager`
  (pending requests) and the `transfers` table, and is already surfaced to
  `TransferListScreen` via `useTransferRequests`/`useTransfers`, polled on a
  focus-driven interval.
- Root cause: `FilesScreen` owned a parallel, disconnected status enum that
  only ever reflected the outcome of the `POST /transfers/requests` call
  itself, instead of deriving its label from the real request/transfer
  state. Nothing on that screen fetched, polled, or otherwise learned that
  the request had since been accepted, streamed, and completed.

## Solution

- Added `android/src/files/downloadStatus.ts` — a pure function,
  `deriveDownloadStatus(fileId, requests, transfers)`, that maps a shared
  file to `idle | pending | in_progress | completed | failed` by matching
  `shared_file_id` against the same `TransferRequestResponse[]` /
  `TransferResponse[]` lists `TransferListScreen` already polls (a
  persisted `Transfer` supersedes the pending request that spawned it; the
  most recent `Transfer` wins if a file was downloaded more than once).
- `FilesScreen` now calls `useTransferRequests`/`useTransfers` and polls
  them on the same focus-driven interval as `TransferListScreen`, deriving
  each row's button label/enabled state from `deriveDownloadStatus` instead
  of a local flag. The only state `FilesScreen` still owns locally is the
  transient `requesting`/propose-call-failed feedback for the button press
  itself, which isn't tracked anywhere server-side.

## Verification

- `android/__tests__/files/downloadStatus.test.ts` (new): covers idle,
  pending, in_progress, completed (the case that previously stayed stuck
  on "Requested"), failed, cancelled-falls-back-to-idle, a transfer
  superseding a stale pending request, most-recent-transfer-wins, and
  cross-file/cross-direction isolation.
- Full Android suite: `npx jest` — 21 suites / 108 tests passing.
- `npx tsc --noEmit` and `npx eslint` clean on the changed files.
- Live device E2E (pair → discover → propose → accept → stream, watching
  Files screen transition Download → Requested → Downloaded) was not
  re-run as part of this fix — no physical device/desktop pair was
  available in the environment the fix was made in. Recommended before
  closing this out.
