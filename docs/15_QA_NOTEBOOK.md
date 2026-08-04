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

---

# Milestone P1 — Upload Workflow Still Required Manual Desktop Approval

## Problem

The download flow's manual-approval friction (see the entry above) was
already removed, but the mirror-image upload flow was not: proposing an
upload from Android still left it sitting under the desktop's "Incoming
Transfer Requests" panel until someone clicked Accept, even though the
desktop had already paired with that device — the only decision that
actually matters for whether it should be allowed to send bytes at all.

## Root Cause

- `TransferService.request_transfer` (`app/services/transfer_service.py`)
  special-cased `direction=send`: only a download's `Transfer` row was
  created in the same call that proposed it. A `receive` (upload) proposal
  was still stored `PENDING` in `TransferManager`, requiring a separate
  desktop-initiated `POST /transfers/requests/{id}/accept` call
  (`TransferService.accept_request`) before it became a `Transfer` row.
- `desktop/src/renderer/views/transfers.js` rendered that `PENDING` list as
  the "Incoming Transfer Requests" table with Accept/Reject buttons — the
  only reason that table (and the corresponding "Requests" section in
  Android's `TransferListScreen`) ever had anything to show.
- `TransferListScreen.handleUpload` (Android) proposed the transfer and
  navigated to `TransferRequestDetail`, a screen dedicated to watching a
  still-pending request and letting the user withdraw it — infrastructure
  that only existed to support this now-redundant approval step.

## Solution

- **Backend:** `request_transfer` now creates the `Transfer` row
  immediately for *both* directions — the `send`/`receive` branch only
  decides how the file/size snapshot is resolved, not whether a decision
  step happens afterward. `accept_request`, `reject_request`, and
  `withdraw_request` were deleted from `TransferService` (nothing is ever
  left `PENDING` for them to act on), along with their routes
  (`POST /transfers/requests/{id}/accept|reject`,
  `DELETE /transfers/requests/{id}`) in `app/api/v1/transfers.py`.
  `GET /transfers/requests` and `GET /transfers/requests/{id}` were kept
  unchanged — Android's download-status derivation already polls the
  former defensively, and the latter still lets a caller look up a request
  it just made.
- **Desktop:** `transfers.js` dropped the `/transfers/requests` fetch and
  the "Incoming Transfer Requests" table/Accept/Reject wiring entirely —
  the view now only ever renders the `Transfers` list, which already
  showed both directions once a `Transfer` row existed.
- **Android:** `TransferListScreen.handleUpload` now mirrors
  `FilesScreen.handleDownload` exactly: since the auto-accepted proposal's
  response already carries a `transfer_id`, it registers the picked file's
  local content URI under that id (`registerUploadSource`, simplified to
  take a `transfer_id` directly instead of a request-id-to-transfer-id
  promotion dance that no longer had a reason to exist), fetches the
  `Transfer`, and hands it straight to `TransferStreamManager.start()` —
  no navigation to a pending-request screen in between.
  `TransferRequestDetail.tsx` and `useTransferRequest.ts` were deleted
  (nothing is ever left pending to view or withdraw), and
  `TransferDetailScreen`'s route param collapsed from a
  `{kind: 'request'|'transfer'}` union to a plain `{transferId: number}`,
  since only the persisted-transfer view is ever reachable now.

## Verification

- Backend: `backend/tests/services/test_transfer_service.py` and
  `backend/tests/api/test_transfers.py` rewritten for the upload
  auto-accept path (mirroring the existing download coverage), plus
  updated fixture helpers in `backend/tests/api/test_transfer_streaming.py`
  and `backend/tests/services/test_transfer_stream_service.py` that
  previously drove a transfer into existence via the now-deleted
  `accept_request`. Full backend suite: `python -m pytest` — 286 passed, 2
  skipped. `ruff check app tests` clean.
- Android: `android/__tests__/streaming/uploadSourceRegistry.test.ts`
  updated for the simplified by-`transfer_id` API;
  `android/__tests__/transfers/useTransferRequest.test.tsx` deleted (its
  subject no longer exists). Full suite: `npx jest` — 21 suites / 118 tests
  passing. `npx tsc --noEmit` and `npx eslint` clean.
- Desktop: no automated test suite exists for the plain-JS renderer
  (unchanged from T1); `transfers.js` was syntax-checked
  (`node --check`) and traced by hand against the `/transfers`-only
  response shape it now consumes.
- Live device E2E (confirming a file picked on Android starts uploading
  immediately with no desktop interaction, and that the desktop's
  Transfers view shows it in progress without ever presenting an
  accept/reject prompt) was not re-run as part of this fix — no physical
  device/desktop pair was available in the environment the fix was made
  in. Recommended before closing this out, mirroring the same caveat noted
  for the download-side fix above.

---

# Milestone P2 — Shared Files Screen Never Re-Validated What It Displayed

## Problem

Three separate issues were raised against the Android Files screen, all
scoped to `FilesScreen.tsx`/`android/src/files/`:

1. A file downloaded once kept showing "Downloaded" even after the user
   deleted it, cleared the `Relay` Downloads subfolder, or reinstalled the
   app.
2. Every download briefly showed a bare `'...'` button state between
   tapping Download and the button settling into "Downloading...".
3. A file newly shared from the desktop did not appear on Android until
   the user manually pulled to refresh.

## Investigation

- **Issue 1.** Traced `deriveDownloadStatus()`
  (`android/src/files/downloadStatus.ts`) — it maps a shared file straight
  to `{ kind: 'completed' }` whenever the most recent matching `Transfer`
  has `status === 'completed'`. That backend status is written once, when
  `TransferStreamService`'s download stream finishes, and never revisited
  afterward (by design — V1 has no resume/retry). Nothing on the Android
  side ever asked "is the file this status implies actually still there?"
  — the check plainly did not exist. Confirmed this is a genuinely
  different condition from the transfer's own state: the `Transfer` row
  and its `status='completed'` are both *correct* — the file really was
  downloaded successfully — the staleness is entirely in what the file
  *system* looks like now, which the backend's database has no way to
  know about (the download happens entirely on the Android side, after
  the backend has already finished streaming its bytes).
- **Issue 2.** Traced the button's label function,
  `downloadButtonLabel()` in `FilesScreen.tsx`: it returns `'...'`
  whenever the screen's local `requesting` flag is true, which spans
  `handleDownload`'s `proposeTransfer()` → `refreshRequests()`/
  `refreshTransfers()` → `getTransfer()` round trip. Cross-referenced
  against `backend/app/services/transfer_service.py`'s
  `_create_transfer()`: a download's `Transfer` row is created with
  `status=TransferStatus.IN_PROGRESS` synchronously, in the very same
  `POST /transfers/requests` call `proposeTransfer()` makes — i.e. by the
  time `requesting` even becomes true, the eventual "Downloading..."
  state is already a foregone conclusion sitting in the response Android
  is about to receive. The "..." wasn't covering genuine uncertainty; it
  was just a slower way of saying "Downloading...".
- **Issue 3.** Traced `useSharedFiles()` — `getAvailableFiles()` is called
  once on mount (`useEffect`) and again only via `refresh()`, which is
  wired to `FilesScreen`'s `<RefreshControl onRefresh={refresh}>` (a
  manual pull gesture) and nothing else. Compared against
  `FilesScreen`'s own handling of transfer state, which already polls
  `useTransferRequests`/`useTransfers` every 2 seconds via a
  `useFocusEffect` — the shared-file list had no equivalent. Considered
  three options: (a) a real push channel (WebSockets/SSE) from desktop to
  Android — rejected, explicitly deferred per `docs/11_File_Transfer.md`
  §16 and disproportionate to a UX-polish milestone; (b) polling at the
  same 2-second cadence already used for transfers — rejected as
  unnecessarily chatty, since the shared-file list changes only when a
  human on the desktop clicks "Share," nowhere near as often as an active
  transfer's byte-level progress; (c) refresh-on-focus plus a slower,
  screen-scoped poll — chosen, since it reuses the exact
  `useFocusEffect` pattern already in this file and costs one extra
  `GET /files` every few seconds only while a user is actually looking at
  the Files screen.

## Solution

- **Issue 1:** Added `android/src/files/downloadExistence.ts`
  (`downloadedFileExists(fileName)`) and
  `android/src/files/useDownloadExistence.ts` (a small existence-cache
  hook, `{ existence, verify }`). `deriveDownloadStatus()` gained an
  optional 4th parameter, `fileExists`: when the derived status would be
  `'completed'` and `fileExists === false`, it downgrades to `'idle'`
  instead — an explicit `true`, or the default `undefined` (not checked
  yet), leaves `'completed'` alone. `FilesScreen` now verifies existence
  for every file its polled data reports as completed, on every focus
  tick, via a small `useEffect` — not a one-time check, since a file can
  be deleted at any point after a prior check found it present.
  `downloadedFileExists()` mirrors (rather than imports) the destination
  logic from `streaming/blobUtil.ts`'s `publishDownload()` — `Relay`
  subfolder of the public Downloads directory on API 29+, private staging
  path below it — since `android/src/streaming/**` was out of scope to
  modify for this milestone.
- **Issue 2:** `downloadButtonLabel()`'s `requesting` branch now returns
  `'Downloading...'` instead of `'...'`. `requesting` itself is unchanged
  — it still exists, still disables the button for the duration of the
  propose call, and still drives the error message on failure — only the
  label shown while it's true changed, since the state it represents was
  never actually ambiguous.
- **Issue 3:** `useSharedFiles()` gained `refreshSilently()`, sharing the
  same `load()` core as the existing `refresh()` but never touching
  `loading`/`refreshing` (so it can't flash the pull-to-refresh spinner).
  `FilesScreen` calls it immediately on focus and then every 5 seconds
  while focused, via its own `useFocusEffect` — separate from, and
  slower than, the screen's existing 2-second transfer-progress poll.

## Verification

- New/updated Android tests: `__tests__/files/downloadExistence.test.ts`
  (path resolution on and below API 29, missing-file and error cases),
  `__tests__/files/useDownloadExistence.test.tsx` (records a check's
  result, dedupes a concurrent in-flight check for the same file, re-checks
  on a later call rather than caching forever, tracks multiple files
  independently), new cases in `__tests__/files/downloadStatus.test.ts`
  (completed stays completed when `fileExists` is omitted/`true`,
  downgrades to idle when explicitly `false`, ignored for non-completed
  statuses), and new cases in `__tests__/files/useSharedFiles.test.tsx`
  (`refreshSilently()` re-fetches without ever setting
  `loading`/`refreshing`, still surfaces a failure message).
- Full Android suite: `npx jest` — 23 suites / 134 tests passing.
  `npx tsc --noEmit` and `npx eslint` clean on all changed/added files.
- Live device E2E (confirming a deleted download reverts to "Download" the
  next time Files regains focus, a tap on Download shows "Downloading..."
  immediately with no visible "..." step, and a file shared from the
  desktop appears on Android without a manual pull) was not re-run as part
  of this fix — no physical device/desktop pair was available in the
  environment the fix was made in. Recommended before closing this out,
  mirroring the same caveat noted throughout this notebook.
