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

---

# Downloaded Files Invisible to the User (Written to App-Private Storage)

## Problem

After a fully successful transfer (desktop `Completed`, Android Transfers
screen `Completed`, Files screen `Downloaded`), the downloaded file could
not be found anywhere on the Android device — not via search, not by
browsing to `/storage/emulated/0/Android/data/com.relay.mobile/`
("Access denied", expected on modern Android).

## Investigation

- Traced the write path: `TransferStreamManager.start()` (direction
  `send`) called `downloadFile()` (`android/src/streaming/blobUtil.ts`)
  with a destination built by `downloadDestinationPath()`:
  `` `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/Downloads/${fileName}` ``.
- Confirmed in `react-native-blob-util`'s native source
  (`ReactNativeBlobUtilFS.java`) that `DocumentDir` resolves to
  `ctx.getFilesDir()` — the app's **internal, private storage**
  (`/data/user/0/com.relay.mobile/files`), not the external
  `Android/data/com.relay.mobile/` directory the user tried to browse to.
  Internal storage is stricter than `Android/data`: it is inaccessible to
  any file manager, is never indexed by MediaStore/search, and cannot be
  reached even by the tester's manual browse attempt (which was hitting a
  *different*, less-restrictive location than where the file actually
  lived).
- Confirmed no `WRITE_EXTERNAL_STORAGE`/`MANAGE_EXTERNAL_STORAGE` permission
  was requested anywhere in the app, consistent with the app never having
  intentionally targeted public storage.
- Verified the "Completed" status is trustworthy, not a false positive:
  the backend (`transfer_stream_service.py`) only marks a transfer
  `COMPLETED` after its streaming generator fully sends the file body, and
  the Android side (`TransferStreamManager.start()`) only sets local status
  `completed` after `downloadFile()`'s promise resolves — which
  `react-native-blob-util` only does once the full HTTP response has been
  written to disk at the destination path. So a "Completed" transfer was
  never a phantom: the file genuinely existed on disk, just in a location
  no user-facing tool can reach.

## Solution

- Chose **MediaStore into a `Relay` subfolder of the public Downloads
  directory** over the alternatives:
  - *Continue with app-private storage* — rejected; this is the bug.
  - *Raw public Downloads path* (`Environment.DIRECTORY_DOWNLOADS`) —
    rejected; writing there directly requires either legacy
    `WRITE_EXTERNAL_STORAGE` (API < 29 only) or `MANAGE_EXTERNAL_STORAGE`
    on modern Android, neither of which this app should need to request
    for a single-file save.
  - *MediaStore, no subfolder* — works, but files from multiple different
    apps/sources mix together in one Downloads listing.
  - *MediaStore + `Relay` subfolder* (chosen) — no permission needed on
    API 29+ (`resolver.insert()` into `MediaStore.Downloads` is
    permission-free by design), visible immediately in the Downloads app
    and any file manager, and keeps Relay's files grouped together.
- Added `publishDownload()` (`android/src/streaming/blobUtil.ts`): after a
  download finishes at its (still app-private) staging path, copies it into
  `Downloads/Relay/<fileName>` via `react-native-blob-util`'s
  `MediaCollection.copyToMediaStore`, then deletes the staging copy.
  Deliberately best-effort/non-throwing — the transfer has already fully
  received its bytes by the time this runs, V1 has no retry, so a failure
  publishing to public storage must not turn an otherwise-successful
  transfer into a reported failure; worst case the file is left at its
  (pre-existing-behavior) private staging path instead.
- `TransferStreamManager.start()` now calls `publishDownload()` for
  `direction === 'send'` transfers after the stream completes and before
  setting local status `completed`. The staging path function was renamed
  `downloadStagingPath` to make clear it's no longer the final resting
  place.
- **Known V1 limitation**: `MediaStore.Downloads` requires Android 10
  (API 29); the app's `minSdkVersion` is 26. Below API 29,
  `publishDownload()` is a no-op and the file remains at its private
  staging path — unchanged from prior (broken) behavior, not a regression,
  but still not user-visible on Android 8/9. Given how small that install
  base is by 2026, this was deliberately left out of scope rather than
  adding legacy `WRITE_EXTERNAL_STORAGE` permission/runtime-request
  handling; flagging for the developer to decide whether to raise
  `minSdkVersion` to 29 or add legacy support later.

## Verification

- `android/__tests__/streaming/blobUtil.test.ts`: new `publishDownload`
  tests — copies into `Downloads/Relay` and deletes the staging file on
  success; no-ops below API 29; swallows a MediaStore failure without
  throwing.
- `android/__tests__/streaming/TransferStreamManager.test.ts`: asserts
  `publishDownload` is called for a `send` transfer and not for a
  `receive` transfer.
- Full Android suite: `npx jest` — 21 suites / 112 tests passing.
- `npx tsc --noEmit` and `npx eslint` clean on the changed files.
- Live device E2E (confirming the file now actually appears in the
  Downloads app / a file manager after a real transfer) was not re-run as
  part of this fix — no physical device/desktop pair was available in the
  environment the fix was made in. Recommended before closing this out.

---

# Download Flow Required Manual Desktop Approval, Manual Transfers-Tab Visit, and Gave No Completion Feedback

## Problem

Confirmed on physical hardware (full pair → discover → share → download
flow otherwise working end-to-end): downloading a shared file required three
manual steps that added no real value for V1 — (1) the desktop user had to
open the Electron app and click Accept on every single download, even though
they had already chosen to share the file; (2) after that, the Android user
had to separately open the Transfers tab and tap into the transfer's detail
screen before its bytes actually started moving; (3) once a download
finished, nothing on Android told the user it had completed.

## Root Cause

- **(1) Manual accept.** `TransferService.request_transfer` always created a
  `PENDING` `PendingTransferRequest` regardless of direction, requiring a
  separate desktop-initiated `POST /transfers/requests/{id}/accept` call
  (`TransferService.accept_request`) before a `Transfer` row — and therefore
  the download itself — could exist. For `direction=send` (a download), that
  second decision is redundant: the desktop already made the only decision
  that matters (sharing the file) when it called `POST /files`.
- **(2) Manual stream start.** `TransferStreamManager.start()` was only ever
  called from `TransferProgressDetail`'s `useEffect`, which only runs once
  that specific detail screen mounts and observes an `in_progress` transfer.
  `FilesScreen.handleDownload` only proposed the transfer and left the user
  to separately navigate to Transfers → tap the row to actually start moving
  bytes.
- **(3) No completion feedback.** `TransferStreamManager.start()`'s success
  path tore down the in-progress foreground-service notification
  (`stopTransferNotification()`) but never posted anything in its place —
  `@supersami/rn-foreground-service`'s notification is tied to that
  foreground service's own lifecycle and cannot outlive it or carry a real
  tap-to-open action.

## Solution

- **Backend:** `TransferService.request_transfer` now auto-accepts a `send`
  request in the same call that proposes it — `_create_transfer` (extracted
  from what was `accept_request`'s body, now shared by both) creates the
  `Transfer` row immediately, and the returned request already carries
  `status=ACCEPTED`/`transfer_id`. A `receive` (upload) proposal is
  untouched: it still only lives in `TransferManager`, `PENDING`, until the
  desktop explicitly accepts or rejects it, since the desktop hasn't seen
  that file before and still needs to decide. `accept_request`/
  `reject_request`/`withdraw_request` now 404 for a download's request id,
  since it's never left `PENDING` for them to claim.
- **Android, auto-start:** `FilesScreen.handleDownload` now fetches the
  accepted `Transfer` (`getTransfer(request.transfer_id)`) right after
  `proposeTransfer()` resolves and hands it directly to
  `TransferStreamManager.start()`, instead of waiting for the user to visit
  the Transfers tab. `TransferProgressDetail`'s own start-on-observe effect
  is kept as a resume/fallback path (e.g. viewing a transfer this app
  instance didn't start streaming itself), and `start()`'s existing
  already-streaming/already-terminal guards make calling it from either site
  redundantly safe.
- **Android, completion notification:** added `@notifee/react-native` (the
  only notification-capable dependency already present,
  `@supersami/rn-foreground-service`, is scoped to the transfer's foreground
  service and can't show a standalone notification after that service stops,
  nor does it support a real tap-to-open intent — decided with the
  developer rather than stretching that library beyond its purpose).
  `publishDownload()` (`android/src/streaming/blobUtil.ts`) now returns the
  `content://` MediaStore URI it publishes to (`null` below API 29 or on
  failure) instead of discarding it. New
  `android/src/streaming/downloadNotification.ts` shows
  "✓ `<fileName>` downloaded successfully" once a `send` transfer completes;
  when a content URI is available its press action opens that file directly
  via `Linking.openURL`, otherwise it falls back to just opening the app.

## Verification

- Backend: `backend/tests/services/test_transfer_service.py` and
  `backend/tests/api/test_transfers.py` — new/updated coverage for
  auto-accept (`request_transfer` for `send` returns `status=accepted` with
  a working `transfer_id`; the request never appears in `list_requests`;
  `accept_request`/`reject_request`/`withdraw_request` all 404 for it), plus
  `backend/tests/api/test_transfer_streaming.py` and
  `backend/tests/services/test_transfer_stream_service.py` fixture helpers
  updated for the new propose-is-accept flow. Full backend suite:
  `pytest` — 298 passed, 2 skipped. `ruff check` clean.
- Android: `android/__tests__/streaming/TransferStreamManager.test.ts` — new
  cases asserting a completion notification fires with the published content
  URI (or `null` when publishing failed) for a `send` transfer, and never
  for a `receive` transfer. `android/__tests__/streaming/blobUtil.test.ts`
  updated for `publishDownload`'s new `Promise<string | null>` return. New
  `android/__tests__/streaming/downloadNotification.test.ts` covers channel
  creation, notification content/press-action shape with and without a
  content URI, and both the foreground and background press-event handlers
  opening the URI via `Linking`. Full Android suite: `npx jest` — 22 suites
  / 121 tests passing. `npx tsc --noEmit` and `npx eslint` clean.
- Live device E2E (confirming the desktop no longer shows an Accept step for
  downloads, a tap on Download starts streaming immediately, and the
  completion notification appears and opens the file on tap) was not re-run
  as part of this fix — no physical device/desktop pair was available in the
  environment the fix was made in. Recommended before closing this out,
  particularly the notification's tap-to-open behavior, which cannot be
  exercised by the Jest suite (no real Android notification tray/intent
  system).
