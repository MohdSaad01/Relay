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

---

# Milestone P3 — Transfer State Consistency & Download Reliability

## Problem

Three separate inconsistencies were raised against the transfer workflow:

1. After a download auto-starts from the Files screen, the Transfers tab
   sometimes takes ~2-3 seconds to show it.
2. A transfer the Overview list already shows as `Completed` (e.g.
   "702.3 KB / 702.3 KB") briefly shows something inconsistent — a smaller
   byte count and a different status — when its detail screen is opened,
   before correcting itself 10-15 seconds later.
3. Multiple downloads all report `Completed`, but only one file actually
   ends up in `Downloads/Relay`.

## Investigation

- **Issue 1.** Traced `Transfer` persistence first, to rule out the
  backend: `TransferService._create_transfer`
  (`backend/app/services/transfer_service.py`) commits the row
  synchronously inside `POST /transfers/requests`, so it already exists by
  the time `proposeTransfer()` resolves on Android — the delay could not be
  a backend or API-response issue. Traced Android's polling next:
  `TransferListScreen`'s `useFocusEffect`
  (`android/src/screens/transfers/TransferListScreen.tsx`) and
  `FilesScreen`'s equivalent request/transfer `useFocusEffect`
  (`android/src/screens/files/FilesScreen.tsx`) both started a
  `setInterval(refresh, POLL_INTERVAL_MS)` on regaining focus but never
  called `refresh()` immediately — the first refresh only happened on the
  interval's own first tick, up to 2000ms later.
  `createBottomTabNavigator` (`android/src/navigation/MainTabs.tsx`) keeps
  tab screens mounted after their first visit, so switching from Files to
  Transfers after starting a download does not remount
  `TransferListScreen` and force a fresh fetch — only the delayed interval
  tick would eventually show it. This is the exact staleness class
  Milestone P2 already fixed for the shared-file list
  (`refreshSilently()` called immediately on focus, then on an interval) —
  that fix was never applied to transfer/request polling.
- **Issue 2.** Traced `TransferProgressDetail`
  (`android/src/screens/transfers/TransferProgressDetail.tsx`): it merges
  the server-polled `Transfer` (`useTransfer`) with
  `TransferStreamManager`'s live state (`useTransferStream`) whenever
  `stream?.transferId === transferId`
  (`useLiveStream`), with no check on whether that local state was actually
  caught up with the server. Traced `TransferStreamManager.start()`
  (`android/src/streaming/TransferStreamManager.ts`): once the byte
  transfer itself finishes (`await activeTask.promise`), a `send` transfer
  still has to `await publishDownload(...)` (MediaStore copy) and
  `await notifyDownloadComplete(...)` (notification post) — both I/O-bound
  — *before* `state` is set to `'completed'` with `bytesTransferred` reset
  to the full total. Until that finishes, `stream.status` can still read
  `'streaming'` with whatever partial byte count its last 250ms progress
  tick observed (for a small/fast file, possibly just one early tick).
  Meanwhile the backend has already committed the transfer as `completed`
  the moment its own streaming generator finished
  (`transfer_stream_service.py`'s `_finalize`), and the Overview list's own
  `GET /transfers` poll already reflects that. Opening the detail screen
  during this window showed the stale local view instead of the
  already-correct server one; it "corrected itself" once
  `publishDownload`/`notifyDownloadComplete` finished and flipped `state`.
- **Issue 3.** Traced the full `publishDownload()` path
  (`android/src/streaming/blobUtil.ts`) into `react-native-blob-util`'s
  Android implementation
  (`node_modules/react-native-blob-util/android/src/main/java/com/ReactNativeBlobUtil/ReactNativeBlobUtilMediaCollection.java`):
  `createNewMediaFile` calls `ContentResolver.insert()` with the requested
  `DISPLAY_NAME` verbatim — no conflict handling of any kind, every single
  call. Compared against the backend's own upload path
  (`backend/app/utils/filesystem.resolve_available_path`), which
  deliberately resolves a "name (1).ext" alternative before ever writing a
  file — nothing on the Android download-publish side has an equivalent.
  Two downloads landing on the same file name is a genuinely reachable
  case: Milestone P2's own existence-check-driven re-download flow lets a
  file whose local copy was deleted revert to re-downloadable (same file
  name, new `Transfer`), and two different shared files can trivially share
  a basename. `publishDownload()`'s error handling is deliberately
  best-effort and swallows any `copyToMediaStore` failure (by design — a
  publish failure must not turn an otherwise-successful byte transfer into
  a reported failure), which means a MediaStore insert failing against an
  already-taken name fails *silently*: the file is left at its private,
  invisible staging path while both the backend `Transfer` and the local
  stream state still correctly report `completed`, since neither of them
  is aware `publishDownload` even ran, let alone whether it succeeded.
  Whether the underlying platform call actually fails outright on a
  `DISPLAY_NAME` collision, silently reuses the existing row, or something
  else could not be confirmed without a physical device — but the absence
  of any conflict handling at all, for a reachable same-name case, was
  independently verifiable by code alone.

## Root Cause

All three trace to state living in more than one place without a rule for
which copy wins when they disagree, or without ever noticing a name
collision at all:

- Issue 1: Android's UI polling had no "refresh now" trigger on regaining
  focus, only a delayed interval — a gap already closed once (Milestone
  P2, shared files) but not for transfers.
- Issue 2: the merge of server state and local stream state had no
  freshness rule — local state was trusted even after the server state it
  was supposed to supplement had already become final and more accurate.
- Issue 3: nothing on the Android side treated a download's destination
  file name as something that could collide, even though the exact same
  problem was already solved once, on the backend, for uploads.

## Solution

- **Issue 1:** `TransferListScreen`'s `useFocusEffect` and `FilesScreen`'s
  request/transfer `useFocusEffect` now call their refresh function(s)
  immediately on regaining focus, before starting the polling interval —
  mirroring `useSharedFiles().refreshSilently()`'s existing pattern from
  Milestone P2.
- **Issue 2:** `TransferProgressDetail`'s `useLiveStream` now additionally
  requires `transfer.status === 'in_progress'`. Once the freshly-polled
  server transfer reaches a terminal status, it wins outright instead of
  being second-guessed by a potentially-lagging local stream view; while
  the server transfer is genuinely in progress, the live stream is still
  preferred exactly as before, for its finer-grained updates.
- **Issue 3:** Added `resolveAvailableMediaStoreName()`
  (`android/src/streaming/blobUtil.ts`), the same "name (1).ext" naming
  convention as the backend's `resolve_available_path`, checked via a raw
  filesystem read under the public Downloads directory (the same
  technique, and the same unverified-on-a-physical-device caveat,
  `files/downloadExistence.ts` already relies on). `publishDownload()` now
  resolves a conflict-free name before calling `copyToMediaStore`, instead
  of handing it the requested name unconditionally — removing the
  collision rather than depending on how the platform would have handled
  it.

## Verification

- New/updated Android tests: three new cases in
  `__tests__/streaming/blobUtil.test.ts` covering
  `resolveAvailableMediaStoreName`'s conflict resolution (renames to
  "(1)", keeps incrementing past an already-taken "(1)", and leaves a free
  name unchanged).
- Full Android suite: `npx jest` — 23 suites / 137 tests passing.
  `npx tsc --noEmit` and `npx eslint` clean on all changed files.
- Backend: untouched by this milestone — `python -m pytest` still 286
  passed, 2 skipped; `ruff check app tests` clean. Confirmed by code trace
  (not just by the suite staying green) that `Transfer` persistence is
  synchronous and therefore not a contributor to Issue 1.
- Live device E2E (confirming the Transfers tab shows a new download
  immediately after switching tabs, a transfer's detail screen matches
  Overview the instant it's opened rather than settling a few seconds
  later, and downloading the same file name twice produces two distinct
  files in `Downloads/Relay`) was not run as part of this fix — no
  physical device/desktop pair was available in the environment the fix
  was made in. Recommended before closing this out, mirroring the same
  caveat noted throughout this notebook — particularly for Issue 3, since
  the exact platform behavior on a `DISPLAY_NAME` collision could not be
  confirmed independently of this fix.

---

# Milestone P4 — Download Completion Notification Never Appeared, and Nothing Useful to Do With a Finished Download

## Problem

Two issues were raised against the final stage of the Android download
experience:

1. A completed download should show a notification (added in the
   "Download Flow Required Manual Desktop Approval..." entry above), but no
   notification ever appeared on the device.
2. Once a file finished downloading, the Files screen's button for it
   became a disabled, dead-end "Downloaded" pill — nothing could be done
   with the file from inside the app.

## Investigation

- **Issue 1.** Worked through the pipeline in the order this milestone's
  checklist specified: permission, channel, Notifee initialization,
  callback execution, foreground/background behavior, Android version
  differences.
  - Ruled out the most suspicious-looking interaction first: `notifyDownloadComplete()`
    (which *displays* the notification) runs inside `TransferStreamManager.start()`'s
    `try` block, immediately followed in the `finally` block by
    `stopTransferNotification()` — a *different* library
    (`@supersami/rn-foreground-service`) tearing down the unrelated
    transfer-progress notification. Read that library's actual Android
    source
    (`node_modules/@supersami/rn-foreground-service/android/src/main/java/com/supersami/foregroundservice/ForegroundService.java`,
    `ForegroundServiceModule.java`) to confirm `stopService()` only ever
    calls `stopSelf()` against its own foreground-service notification
    (`ACTION_FOREGROUND_SERVICE_STOP` → `running -= 1` → `stopSelf()`), never
    `NotificationManager.cancelAll()` or anything scoped beyond its own
    notification ID. Confirmed this cannot be clearing Notifee's separate
    notification.
  - Ruled out Notifee's own event-handler registration timing: `downloadNotification.ts`
    registers `notifee.onForegroundEvent`/`onBackgroundEvent` at module load,
    and traced the import chain (`index.js` → `App.tsx` → `RootNavigator` →
    `MainTabs` → `FilesStack` → `FilesScreen` → `TransferStreamManager` →
    `downloadNotification`) — all static imports, no `React.lazy` — so this
    registration runs at JS bundle startup regardless of which screen the
    user is on, ruling out "the module was never loaded" as a cause.
  - Found the actual defect by reading `downloadNotification.ts` against its
    own sibling, `blobUtil.ts`'s `publishDownload()`: `publishDownload` is
    explicitly documented and implemented as best-effort (wrapped in its own
    `try/catch`, returns `null` on failure) specifically so a publish
    failure can never turn a successful transfer into a reported failure.
    `notifyDownloadComplete()` had no equivalent protection — it was awaited
    directly in `TransferStreamManager.start()`'s `try` block with nothing
    catching a rejection from it. Any failure inside it (channel creation,
    the notification post itself) would propagate into `start()`'s own
    `catch`, marking an already-successfully-downloaded transfer `'failed'`.
  - Found a second, compounding defect in `ensureChannel()`: it cached the
    *promise* returned by `notifee.createChannel()` in a module-level
    variable on the very first call — including a rejected one. Once a
    single channel-creation attempt failed, every subsequent
    `notifyDownloadComplete()` call for the rest of the app session reused
    that same rejected promise, with no path to ever retry.
  - Considered the most plausible real-world trigger for an initial
    failure: this app's `targetSdkVersion` is 36, so Android 13+'s
    `POST_NOTIFICATIONS` runtime permission gates every notification,
    including Notifee's. `TransferStreamManager.start()` does request it
    (`PermissionsAndroid.request(...)`) before starting a stream, but never
    inspects the resolved value — a denial (easy to do on an unexplained
    first-run system dialog) causes Android to silently drop any later
    `notifee.displayNotification()` call with no exception at all, which
    would not, by itself, explain "the notification never appears" turning
    into a thrown error — but combined with the two defects above, *any*
    other transient failure (not just a permission denial) would silently
    and permanently disable notifications for the rest of the session while
    also mis-reporting the transfer as failed.
  - No physical device or emulator was available in this environment (same
    constraint T1 and every subsequent milestone already recorded), so the
    permission-denial trigger itself could not be independently confirmed —
    the two code defects were, however, fully verifiable and reproducible
    by code alone, and are real bugs regardless of which specific failure
    first triggers them.
- **Issue 2.** Traced what "Open"/"Share"/"Show location" could actually
  reuse:
  - `react-native-blob-util` (already a dependency) exposes
    `android.actionViewIntent(path, mime, chooserTitle)` — an `ACTION_VIEW`
    intent with FileProvider content-URI wrapping already built in. Usable
    directly against the same on-device path
    `downloadExistence.ts` already computes for its existence check.
  - React Native's own built-in `Share` module was checked next
    (`node_modules/react-native/Libraries/Share/Share.js`): on Android, its
    `static share()` method builds `newContent` from only `content.title`
    and `content.message` — `content.url` is read for the `invariant` check
    that at least one of `url`/`message` is present, but is never actually
    passed to `NativeShareModule.share()`. There is no way to hand a file or
    URL to another app via this API on Android at all.
  - No other sharing-capable dependency exists in `android/package.json`.
    Genuine `ACTION_SEND` sharing would require a new native dependency.

## Root Cause

- Issue 1: `notifyDownloadComplete()` broke this codebase's own established
  best-effort convention (the one `publishDownload()` already follows), and
  `ensureChannel()`'s cache had no failure-recovery path — together, one
  glitch (most plausibly a denied notification permission, but not limited
  to that) could silently and permanently disable download notifications
  for a session, while additionally corrupting an unrelated piece of state
  (the transfer's reported status).
- Issue 2: the completed-download row offered no action because none had
  ever been wired up, not because the platform lacked the capability — Open
  was fully supported by an already-present dependency and simply unused.

## Solution

- **Issue 1:** `notifyDownloadComplete()` now wraps its body in `try/catch`,
  logging via `console.warn` instead of throwing — matching
  `publishDownload()`'s contract exactly, so `TransferStreamManager.start()`
  needed no changes at its call site (it already trusted that sibling
  function the same way). `ensureChannel()` now clears its cached promise
  on a failed `createChannel()` call so the next `notifyDownloadComplete()`
  call retries from scratch instead of reusing a permanently-poisoned
  cache.
- **Issue 2:** Added `android/src/files/downloadActions.ts`
  (`openDownloadedFile`), reusing `actionViewIntent` and the path helper
  exported from `downloadExistence.ts` (`downloadedFilePath`, previously
  private). `FilesScreen`'s completed-download row now shows an "Open"
  button and a "Saved to Downloads/Relay" caption in place of the old
  disabled pill, gated strictly on `useDownloadExistence` having confirmed
  (`=== true`) the file is still present — not the softer "not checked yet"
  default the status label itself tolerates — so the action never appears
  for a file that isn't genuinely there. Real "Share" was investigated and
  found unsupported by anything already in the codebase (see Investigation
  above) and was deliberately not implemented, rather than adding a new
  native dependency for a UX-polish milestone.

## Verification

- New/updated Android tests: two new regression cases in
  `__tests__/streaming/downloadNotification.test.ts` (a `displayNotification`
  failure is swallowed rather than thrown; a failed channel creation is
  retried on the next call rather than cached forever), plus a new
  `__tests__/files/downloadActions.test.ts` (three cases: correct
  path/MIME/chooser arguments, the `application/octet-stream` fallback when
  a shared file has no MIME type, and a rejection from `actionViewIntent`
  propagating so `FilesScreen` can surface it). A test-only
  `__resetNotificationChannelForTests()` export was added to
  `downloadNotification.ts` so the channel-cache regression test doesn't
  depend on running before any other test in its file.
- Full Android suite: `npx jest` — 24 suites / 142 tests passing (137
  existing + 5 new). `npx tsc --noEmit` and `npx eslint .` clean.
- Backend, Desktop: untouched by this milestone.
- Live device E2E (confirming a real notification now appears after a
  download completes, denying `POST_NOTIFICATIONS` no longer causes the
  transfer to show "failed," and the new Open button/caption behave
  correctly against a real MediaStore-published file) was not run as part
  of this fix — no physical device/desktop pair was available in the
  environment the fix was made in. Recommended before closing this out,
  mirroring the same caveat noted throughout this notebook — this milestone
  in particular, since Issue 1's most plausible trigger (a denied
  notification permission) is Android runtime behavior that cannot be
  exercised by the Jest suite.

---

# Milestone P5 — Live Synchronization & UX Responsiveness

## Problem

A UX-polish pass asked whether the Files screen, Transfer list, and
Transfer detail screen were reflecting things the app already knew as
promptly as the existing polling architecture allows — explicitly without
introducing WebSockets, push notifications, or a redesigned sync system.

## Investigation

- **Duplicate fetch on mount.** Traced `useSharedFiles`/`useTransferRequests`/
  `useTransfers` — each fetches once via its own `useEffect` on mount.
  Cross-referenced against Milestone P3's fix, which made
  `FilesScreen`/`TransferListScreen` call their refresh functions
  immediately inside `useFocusEffect` (not just on the next interval tick)
  so a screen regaining focus after being backgrounded doesn't wait. A
  screen's first focus fires at the same moment it mounts, so on every
  fresh mount both effects fired: the hook's own initial fetch, and the
  screen's "refresh immediately on focus" call — one redundant extra
  request per list, every time a tab was first visited.
- **Stream start waited on an unrelated refresh.** Traced
  `FilesScreen.handleDownload` and `TransferListScreen.handleUpload`: both
  `await`ed `Promise.all([refreshRequests(), refreshTransfers()])` /
  `refreshTransfers()` — which only exist to update the polled list state
  driving the row's button label — before calling `getTransfer()` and
  `TransferStreamManager.start()`. Since the list refresh and the stream
  start read/act on independent data (the refresh doesn't feed the
  `getTransfer` call, and `start()` doesn't need the refreshed lists),
  forcing them to run sequentially added one full extra network round trip
  of latency before a newly proposed download or upload's bytes actually
  started moving.
- **Detail screen lagged behind its own local stream.** Traced
  `TransferProgressDetail`'s merge logic, added by Milestone P3:
  `useLiveStream = stream?.transferId === transferId && transfer.status ===
  'in_progress'`, then `displayStatus = useLiveStream && stream.status ===
  'streaming' ? 'in_progress' : transfer.status`. P3's fix covered the
  server-ahead-of-local case (server already `completed`, local stream
  still reporting a stale partial count) by making the server win once
  terminal. It did not cover the reverse: once `TransferStreamManager`'s
  own state reaches a terminal outcome (`completed`/`failed`/`cancelled`)
  — which happens the instant the byte transfer, `publishDownload`, and
  `notifyDownloadComplete` all finish — but the next 2-second server poll
  hasn't landed yet, `stream.status` is no longer `'streaming'`, so the
  ternary fell through to the still-stale `transfer.status` value
  (`'in_progress'`). `bytesTransferred` (read straight from `stream` in
  that same window) already correctly showed the full total, so the
  progress bar sat at 100% while the status text still read "In progress"
  and the Cancel button — gated on the same stale `transfer.status ===
  'in_progress'` — stayed visible and tappable, routing a tap to the REST
  `cancel()` call against a transfer that had, from this app's own
  perspective, already finished.

## Solution

- Added a `useRef` first-focus guard in `FilesScreen` and
  `TransferListScreen` so the immediate refresh-on-focus call added in P3
  only fires from the *second* focus onward, leaving the underlying hooks'
  own mount-time fetch as the single source of the initial load. The hooks
  themselves were left fetching on mount unconditionally, so they remain
  correct in isolation for any future caller that doesn't pair them with a
  focus-driven refresh.
- `handleDownload`/`handleUpload` now start the list refresh without
  awaiting it immediately, run `getTransfer()`/`TransferStreamManager.start()`
  concurrently with it, and only await the refresh promise afterward —
  still before the `finally` block clears the row/button's local
  `requesting`/`uploading` flag, so the button's label handoff timing (no
  flicker back to "Download"/"Upload a File" before the polled state has
  caught up) is unchanged.
- Added `android/src/transfers/mergeLiveTransferState.ts`
  (`mergeLiveTransferState(transfer, stream)`), mirroring the project's
  existing `downloadStatus.ts` pure-derivation pattern: the server still
  wins outright once terminal (P3, unchanged), but while the server still
  reports `in_progress`, a local stream that has itself already reached a
  terminal status now wins over that stale value too — for both the status
  text and a new `showCancel` field the Cancel button is gated on directly.
  `TransferProgressDetail` also gained a `useEffect` that fires one
  immediate `refresh()` the moment its local stream reaches a terminal
  outcome while `transfer.status` is still `'in_progress'`, closing the gap
  from the local side rather than only ever waiting on the existing
  2-second poll.

## Verification

- New `android/__tests__/transfers/mergeLiveTransferState.test.ts`: 7 cases
  covering no stream, a stream for a different transfer id, server-terminal
  winning even against a matching "streaming" stream (regression coverage
  for P3's original fix), server `in_progress` with a live streaming view,
  and all three "local stream already terminal while the server is still
  stale" cases (completed/cancelled/failed), each asserting the resulting
  status and `showCancel`.
- Full Android suite: `npx jest` — 25 suites / 149 tests passing (142
  existing + 7 new). `npx tsc --noEmit` clean. `npx eslint .` clean across
  the whole project.
- No component-level render test exists for `FilesScreen`,
  `TransferListScreen`, or `TransferProgressDetail` in this codebase (only
  their extracted pure-logic modules and hooks are unit tested — the same
  convention every prior Files/Transfers milestone in this notebook has
  followed). The screen-level changes (first-focus guards, the
  refresh/stream-start reordering) were verified by code trace against the
  existing hook-level test suites (confirming each hook still fetches
  exactly once on mount) plus a clean `tsc`/`eslint` pass, rather than
  introducing a new component-testing setup out of scope for this
  UX-polish milestone.
- Backend, Desktop: untouched by this milestone.
- Live device E2E (confirming no duplicate request fires on first tab
  visit, a download/upload's progress visibly starts sooner after tapping
  the button, and the transfer detail screen's status/Cancel button update
  in lockstep with the progress bar reaching 100% instead of a few seconds
  later) was not run as part of this fix — no physical device/desktop pair
  was available in the environment the fix was made in. Recommended before
  closing this out, consistent with every prior milestone's own caveat.

---

# Milestone P6 — File Browser UX Refinement

## Problem

A UX-polish pass asked whether the Files screen still behaved like a
modern cloud-storage app after P1-P5: specifically, whether a downloaded
file could ever get stuck on a disabled "Downloaded" button instead of
staying actionable, whether the completed-file experience had any
remaining clutter, whether shared-file freshness still felt responsive,
and whether every reachable row state (never downloaded, downloading,
completed, locally deleted, failed, cancelled) was worded and laid out
consistently with no dead ends.

## Investigation

- **Disabled "Downloaded" pill.** Traced `FileRow`'s `canOpen` gate
  (`android/src/screens/files/FilesScreen.tsx`, added in Milestone P4):
  `status.kind === 'completed' && fileExists === true`. Cross-referenced
  against `deriveDownloadStatus` (`downloadStatus.ts`), which computes that
  same `status.kind === 'completed'` result: its own `fileExists` handling
  already treats `undefined` ("not checked yet," the value
  `useDownloadExistence` reports before its async `verify()` call for this
  file resolves) as good enough to stay `'completed'` — only an explicit
  `false` downgrades it to `'idle'`. `FileRow`'s `canOpen` re-checked the
  same field with a stricter `=== true` comparison that does *not* extend
  that same tolerance to `undefined`. The two checks were answering the
  same underlying question ("is this file still here?") with different
  defaults, and the gap between them was exactly the window this
  milestone's brief described: the instant a transfer's status reaches
  `'completed'`, `status.kind` is `'completed'` but `fileExists` for that
  file is still `undefined` on the very next render, until the existence
  effect's `verify()` call resolves. During that window `canOpen` was
  `false`, so `FileRow` rendered its other branch — a `Pressable` disabled
  because `status.kind === 'completed'` was also one of `disabled`'s
  conditions, styled green via `downloadButtonDone`, labeled "Downloaded"
  by `downloadButtonLabel`'s dedicated `'completed'` case — a real disabled
  dead-end button, not a hypothetical one.
- **Stale open-failure messages.** Traced `openErrors` state alongside the
  above: it was only ever cleared at the top of `handleOpen`, never by
  `handleDownload` starting a new attempt, and `errorMessage`'s computation
  read `openError` unconditionally rather than only while `canOpen` was
  still true. Two related staleness paths followed from this: (a) a file
  re-downloaded after a previous failed "Open" attempt kept showing the old
  "couldn't open" message alongside the fresh "Downloading..." label; (b) a
  file whose "Open" failed because it was genuinely deleted (not yet caught
  by the existence check) kept showing that message even after a
  subsequent poll or re-verify downgraded the row back to a plain
  "Download" state — a message about opening a file next to a button that
  no longer offered to open anything.
- **Completed-file experience, freshness, and remaining consistency.**
  Reviewed the rest of the completed-download row, the Transfers tab's list
  row, and `TransferProgressDetail`'s completed view for clutter or unclear
  affordances (none found — see docs/14_Testing_Plan.md's P6 entry for the
  full breakdown); reviewed `useSharedFiles.ts`'s focus/poll strategy
  established by P2/P5 for responsiveness (found adequate, no
  justification to poll more aggressively per this milestone's own
  constraint); and walked every reachable row state for wording/color/
  placement consistency, finding only one small gap — a failed download's
  retry button was labeled identically to a never-attempted download's
  ("Download"), making the two states indistinguishable at a glance.

## Root Cause

Both defects trace to the same pattern several prior entries in this
notebook already describe: a piece of UI state (`FileRow`'s `canOpen`,
`errorMessage`) computed its own second opinion instead of consistently
deferring to a single source of truth that had already answered the same
question nearby (`deriveDownloadStatus`'s existing `fileExists` tolerance;
which row state an error message was actually raised for).

## Solution

- `FileRow`'s `canOpen` is now `status.kind === 'completed'` alone — the
  `fileExists` prop was removed from `FileRow` entirely, since
  `deriveDownloadStatus` already guarantees `'completed'` excludes a file
  confirmed missing, and now also gets the same "not checked yet" trust
  `deriveDownloadStatus` itself extends. This closes the disabled-pill
  window: a completed download's row always shows an actionable green
  "Open" button (plus its existing "Saved to ..." caption), consistent with
  how a modern cloud-storage app treats a downloaded file as still tappable
  rather than a disabled receipt. The now-dead `status.kind === 'completed'`
  checks in `disabled` and the download button's style array (unreachable
  once `canOpen` covers that case unconditionally) were removed alongside
  it.
- `downloadButtonLabel` now returns "Retry" for `status.kind === 'failed'`
  instead of falling through to the same "Download" label used for a file
  that was never attempted.
- `handleOpen`'s failure path now calls `verify(file.file_name)` before
  setting its error message, so a genuinely-missing file re-syncs
  `useDownloadExistence`'s cache and the row recovers to a re-downloadable
  `'idle'` state instead of staying stuck offering an "Open" that will keep
  failing. `handleDownload` now clears any existing `openErrors` entry for
  the file at the start of a fresh attempt (mirroring its existing
  `requestErrors` clearing), and `FileRow`'s `errorMessage` only reads
  `openError` while `canOpen` is still true, so a stale "couldn't open"
  message can no longer outlive the row's Open action.
- `downloadActions.ts`'s docstring was updated to describe the new
  optimistic-but-still-safe gating (previously documented the stricter,
  now-removed `=== true` requirement as a P4 guarantee).

## Verification

- Full Android suite: `npx jest` — 25 suites / 149 tests passing (no
  suites added or removed; this was a UI-composition fix over already-
  tested pure logic in `downloadStatus.ts`/`useDownloadExistence.ts`, both
  of which already had coverage for the `fileExists` tolerance `FileRow`
  now consistently trusts). `npx tsc --noEmit` clean; `npx eslint` clean on
  the changed files.
- No component-level render test harness exists for `FilesScreen` in this
  codebase (consistent with every prior Files milestone in this notebook).
  Verified by code trace: confirmed `deriveDownloadStatus`'s existing test
  suite already covers `fileExists === undefined` staying `'completed'`
  and `=== false` downgrading to `'idle'`, and that `FileRow`'s simplified
  `canOpen` now matches that behavior exactly rather than a stricter
  subset of it.
- Backend, Desktop: untouched by this milestone — no backend defect was
  found or required to make this fix, consistent with this milestone's
  constraints (no backend/API/streaming/protocol changes).

## Known Limitations

- Not verified live end-to-end — no physical Android device/desktop pair
  was available in the environment this change was made in, consistent
  with every prior milestone's own caveat throughout this notebook.
  Recommended before closing this out: confirm on a real device that a
  download's row hands off straight from "Downloading..." to a live "Open"
  button with no visible disabled "Downloaded" flash in between, that
  deleting the saved file and returning to the app reverts the row to
  "Download" without a lingering stale error, and that a failed download
  now reads "Retry" rather than "Download."
- "Share" (`ACTION_SEND`) remains unimplemented — unchanged from Milestone
  P4's investigation, still out of scope without adding a new native
  dependency.

---

# Milestone P7 — Android Download Publishing: Only `.txt` Files Reached Downloads/Relay

## Problem

On a physical Android device, `.txt` downloads consistently completed,
appeared in `Downloads/Relay`, fired the completion notification, and
opened correctly. Every other tested type (`.pdf`, `.docx`, `.pptx`,
`.jpg`, `.png`) instead: showed the Files screen return to a plain
"Download" state, showed "Download interrupted" on the Transfer detail
screen, never produced a file in `Downloads/Relay`, and never showed a
notification. Backend logs were clean for every type tested — `POST
/transfers/requests` → 201, `GET /transfers/{id}/download` → 200, and
`Download completed: transfer_id=... bytes=...` at the correct byte count
— so the divergence had to be client-side, after the bytes had already
fully arrived.

## Investigation

Traced the full pipeline per the milestone brief:
`TransferStreamManager.start()` → `blobUtil.downloadFile()`
(`react-native-blob-util`'s native `FileStorage` response handling) →
`blobUtil.publishDownload()` → `MediaCollection.copyToMediaStore()` →
`downloadNotification.notifyDownloadComplete()`.

- **`TransferStreamManager.start()`
  (`android/src/streaming/TransferStreamManager.ts`).** For a `send`
  (download) transfer, the sequence is: `await activeTask.promise` (the
  native download), then — only if that resolves — `publishDownload()`,
  then `notifyDownloadComplete()`, then `setState({ status: 'completed' })`.
  If `activeTask.promise` *rejects*, execution jumps straight to the
  `catch` block: `publishDownload` and `notifyDownloadComplete` are never
  reached, and `state.status` is set to `'failed'` with `state.error` set
  to the rejection's message. This single branch point explains all three
  symptoms as one failure, not three: no file in `Downloads/Relay` (never
  published), no notification (never called), and "Download interrupted"
  on the Transfer screen (the rejection's message, surfaced verbatim by
  `TransferProgressDetail`).
- **Where "Download interrupted" actually comes from.** That exact string
  does not appear anywhere in this repository's own TypeScript source —
  confirmed by search. It originates natively, in
  `node_modules/react-native-blob-util`'s
  `ReactNativeBlobUtilReq.java`/`done()` (the `FileStorage` response case):
  `if (!fileResp.isDownloadComplete()) invoke_callback("Download interrupted.", ...)`.
  `ReactNativeBlobUtilFileResp.isDownloadComplete()`
  (`Response/ReactNativeBlobUtilFileResp.java`) is:
  `bytesDownloaded == contentLength() || (contentLength() == -1 && isEndMarkerReceived)`
  — an exact-equality check between bytes actually written to disk and the
  response's parsed `Content-Length`.
- **Ruled out: the backend.** `guess_media_type()`
  (`backend/app/services/transfer_stream_service.py`) sets a real
  per-file `Content-Type` (`text/plain` for `.txt`, `application/pdf` for
  `.pdf`, etc.), but the download route
  (`backend/app/api/v1/transfers.py`) sets `Content-Length` explicitly to
  `transfer.file_size` regardless of type. Confirmed in Starlette's
  `Response.init_headers()` (`starlette/responses.py`) that an
  explicitly-provided `content-length` header is passed through verbatim
  for a `StreamingResponse` — nothing server-side manipulates it by
  content type. No compression middleware is registered. This matches the
  milestone's own instruction to treat the backend as correct — every
  avenue traced back to the client.
- **Ruled out: a code-level type branch.** Read `react-native-blob-util`'s
  entire `FileStorage` response path (`ReactNativeBlobUtilReq.java`'s
  `done()`, `ReactNativeBlobUtilFileResp.java`). The byte-copy loop, the
  completeness check, and the MediaStore write
  (`ReactNativeBlobUtilMediaCollection.java`) are all agnostic to
  `Content-Type`/MIME — `isBlobResponse()`'s content-type branching only
  affects the unrelated in-memory (`KeepInMemory`) response mode, which
  this download never uses (`config({ path: destPath })` always selects
  `FileStorage`). `publishDownload()`
  (`android/src/streaming/blobUtil.ts`) also already hardcodes
  `mimeType: 'application/octet-stream'` for every download regardless of
  real type, so MIME type cannot be what differentiates `.txt` from the
  rest here either.
- **The actual differentiator: response size, not type.** With every
  code-level type-based explanation ruled out, and with backend logs
  confirming a full, correct byte count reaches the OS socket for every
  file in the report — including the failing ones — the mismatch has to
  be a false negative in the exact-equality check itself, not a real data
  loss. `.txt` test files are small enough to be read and sent in a single
  `STREAM_CHUNK_SIZE_BYTES` chunk; `.pdf`/`.docx`/`.pptx`/`.jpg`/`.png`
  test files are larger and require several. This exact failure mode —
  "downloads succeed sometimes, fail with 'Download interrupted' other
  times, on the same library version, uncorrelated with the server" — is
  an openly reported, unresolved upstream behavior
  (react-native-blob-util issue #268), consistent with a real-world,
  non-loopback connection being more likely to expose it on a longer,
  multi-chunk transfer than on a single small one. The one backend
  warning worth naming directly: `Download connection closed early:
  transfer_id=26 bytes_sent=3145728`. That log line comes from the
  server's own `except GeneratorExit` — it fires only when the ASGI
  connection genuinely drops mid-stream, which is a *different* failure
  than the one described above (where the server always logged a clean
  `Download completed`). Given the milestone's report frames this as one
  isolated line among many repeated `.pdf`/`.jpg`/etc. failures — not one
  per failure — it does not correlate with the reproducible bug and is
  treated here as a separate, ordinary network hiccup rather than forced
  into the same explanation.

## Root Cause

`react-native-blob-util`'s native `FileStorage` download path
(`ReactNativeBlobUtilFileResp.isDownloadComplete()`) can reject with
"Download interrupted" even after every byte has already been written to
the staging file on disk — an upstream false negative that this
investigation found is more exposed on larger, multi-chunk downloads over
a real device connection than on tiny single-chunk ones. `.txt` test files
happened to be small enough to avoid tripping it; every other type tested
was large enough not to. `TransferStreamManager.start()` treated that
rejection as unconditional proof of failure, so it never proceeded to
`publishDownload()`/`notifyDownloadComplete()` even when the file was
already complete and correct at its staging path — turning one upstream
false negative into three visible failures (no published file, no
notification, "Download interrupted" on screen).

**Why previous milestones didn't expose this:** `blobUtil.test.ts`
(Jest) mocks `react-native-blob-util` entirely
(`android/__mocks__/react-native-blob-util.js`) — every existing test
drives the mocked task's `__resolve`/`__reject` directly and never
executes the real native Android `FileStorage` code path this bug lives
in. No test in this repository could have caught it; it is only
observable via `isDownloadComplete()`'s real OkHttp/Okio behavior on an
actual device connection, which is exactly how it was found.

## Solution

`downloadFile()` (`android/src/streaming/blobUtil.ts`) now takes the
transfer's declared `file_size` and, if the native promise rejects, stats
the file already written to `destPath` before giving up: if its on-disk
size already equals the declared size, the download is treated as
successful (the rejection is swallowed) instead of failing outright. A
genuine cancellation (`isStreamCancelError`) is explicitly exempted from
this recovery — it must always propagate, never be masked by a
coincidentally-complete partial file. A real interruption (the file is
genuinely short) still rejects exactly as before.
`TransferStreamManager.start()`'s only change is passing
`transfer.file_size` through to `downloadFile()`; its own success/failure
handling, `publishDownload`, and `notifyDownloadComplete` are unchanged.

This is deliberately not a fix to `react-native-blob-util` itself (a
`node_modules` dependency, out of scope to patch per this milestone's own
"no unrelated refactoring" instruction) — it makes the app trust the file
it actually has on disk over a library completion check with a known
false-negative mode, without weakening the check for a real interruption.

## Verification

- Full Android suite: `npx jest` — 25 suites / 153 tests passing (4 new
  regression tests added to `blobUtil.test.ts`; `TransferStreamManager.test.ts`
  updated for `downloadFile`'s new `expectedBytes` parameter). `npx tsc
  --noEmit` and `npx eslint` (on the changed files) both clean.
- New regression coverage in `blobUtil.test.ts`: a native "Download
  interrupted" rejection is swallowed when the on-disk file already
  matches the declared size; it still rejects when the on-disk file is
  short (a genuine interruption) or when `stat()` itself fails (the file
  was never created); a real cancellation still rejects even when the
  partial file happens to already match the declared size.
- Backend: full suite still passing (`pytest -q` — 286 passed, 2 skipped),
  unchanged by this milestone — no backend defect was found, consistent
  with the milestone's instruction to assume the backend correct absent
  contrary evidence, which the investigation did not surface.

## Known Limitations

- Not verified live end-to-end — no physical Android device was available
  in the environment this change was made in, consistent with every prior
  milestone's own caveat throughout this notebook. This is the one entry
  in this notebook where that caveat matters most: the defect itself was
  only reachable on a physical device, and this fix's correctness rests on
  reasoning about `react-native-blob-util`'s real native behavior plus a
  from-first-principles JS regression test of the recovery path, not a
  reproduction of the original bug in this environment. Recommended
  before closing this out: reinstall on the physical device that
  originally reproduced this and confirm, for at least `.pdf`, `.jpg`, and
  one larger file (`.pptx` or `.mp4`, if available) — download completes,
  the file exists in `Downloads/Relay`, the completion notification
  appears, "Open" works, and the Transfer screen settles on "Completed"
  with no "Download interrupted" text.
- If the on-disk file is short by even one byte (a genuine interruption),
  the original "Download interrupted" failure is preserved unchanged — by
  design, this fix only recovers the false-negative case where the file is
  already exactly the declared size.
- The upstream `react-native-blob-util` behavior itself is unpatched; a
  future `react-native-blob-util` upgrade that fixes this false negative
  natively would make this recovery path a (harmless) no-op rather than
  something to revert.

---

# Milestone P8 — Streaming Failure Root Cause Investigation (Backend)

## Problem

Physical-device re-verification of P7's fix (device RMX3997, connected over
its own hotspot) surfaced a different, more serious failure class that P7's
fix does not touch: a `.zip` completed, but a `.mp3` consistently disconnected
at exactly **3,145,728 bytes** (twice), a `.jpg` hung indefinitely, and the
backend then began logging hundreds of `sqlite3.OperationalError: database is
locked` errors. Backend logs showed `Download connection closed early`,
meaning Android closed the connection before the backend finished sending.
Instructed to find the verified root cause before writing any fix.

## Investigation

**Why P7's hypothesis doesn't apply here.** P7's fix (`isActuallyComplete` in
`blobUtil.ts`) addresses `react-native-blob-util`'s own post-download
completion check rejecting a file that is already fully and correctly on
disk. That is a *client-side, post-hoc* false negative on an otherwise
successful transfer. This report is different in kind: the backend's own log
line, and the exact byte count, show the connection was actually severed
mid-stream, with only 3 of the file's 5 MiB delivered — there is no complete
file on disk for the P7 recovery path to rescue. `isActuallyComplete` never
even runs a download that never received all its bytes in the first place.

**Tracing the byte count.** `Settings.STREAM_CHUNK_SIZE_BYTES` is 1 MiB
(`backend/app/core/config.py`), and 3,145,728 = 3 × 1,048,576 exactly. This
is not a limit anywhere in the backend, BlobUtil, OkHttp, or Android — it is
simply the chunk-read granularity `TransferStreamService._generate_download`
already used (`backend/app/services/transfer_stream_service.py`), and the
number lines up because that's how much the client had already read before
whatever caused it to stop. Confirmed by reproducing the exact scenario (see
below): the cutoff tracks *how many chunks the client actually consumed*, not
any backend-side threshold.

**Ruled out the classic FastAPI+StreamingResponse+DB-session bug.** The
textbook failure mode here is a `Depends(get_db)` session getting closed
(via a dependency's `finally: db.close()`) before a `StreamingResponse`'s
generator is actually iterated, since older FastAPI closed `yield`
dependencies as soon as the route function returned — before the response
body was ever sent. Read the installed FastAPI's actual source
(`fastapi/routing.py`, `fastapi/dependencies/utils.py`, version 0.141.1 in
`backend/.venv`, 0.139.2 globally) to check, rather than assume: this version
uses two separate `AsyncExitStack`s (`fastapi_inner_astack` /
`fastapi_function_astack`), and a `Depends(get_db)` yield-dependency
defaults to the *inner* stack, which stays open until *after*
`await response(scope, receive, send)` completes. So the download's DB
session is not closed early — this specific, commonly-cited bug does not
apply to this codebase's FastAPI version.

**Built a real reproduction, since `TestClient` can't show this.** Every
existing test in `tests/api/test_transfer_streaming.py` uses `TestClient`,
which drives the ASGI app in-process over httpx's `ASGITransport` — there is
no real socket, so a hard client disconnect can never be simulated this way,
and no existing test exercises it. Started the real backend
(`uvicorn app.main:app`) against an isolated SQLite file, paired a device,
shared a file, and used a raw Python `socket` to `GET
/transfers/{id}/download`, read exactly 3 chunks, then force-closed the
connection with `SO_LINGER=0` (an RST, matching an abrupt hotspot/link drop
more closely than a graceful close). This is what actually surfaced the
defect:

- With the *original* code, after the abrupt disconnect the `Transfer` row
  stayed `status=in_progress`, `bytes_transferred=0` — indefinitely. One run
  logged `Download connection closed early` after **19 seconds**; a repeat
  of the identical scenario with *no* other server traffic logged nothing at
  all for over **60 seconds**; only firing 200 unrelated HTTP requests at the
  idle server finally "unstuck" it. This is the direct cause of "jpg hangs
  indefinitely" and of the delayed/absent detection generally — it is not
  timing noise, it is the actual, reproducible mechanism.
- Root of that: Starlette's `StreamingResponse.stream_response` (installed
  version 1.3.1) only detects a dead client by letting `await send(...)`
  raise `OSError`, wrapped into `ClientDisconnect`. Whether that `send()`
  call ever raises — and how soon — depends entirely on the OS/event loop
  noticing the socket is dead, which this project's Windows target does not
  do reliably or promptly while otherwise idle. Confirmed this is not just
  slow but genuinely *unbounded* by testing an 80 MiB file with the same
  abrupt-disconnect scenario: the backend's `send()` calls kept "succeeding"
  (silently absorbed by the OS's own buffering) for the *entire* file, and
  the transfer was marked `completed` even though the client had been gone
  for the whole transfer.
- Tried the officially-recommended alternative, `Request.is_disconnected()`
  (checks the ASGI receive channel directly instead of waiting on a failed
  write), polled once per chunk. Empirically no better — it depends on the
  same underlying OS/event-loop notification the send-failure path does, and
  in the same "quiet server" test it never fired either.
- Tried forcing Python's `SelectorEventLoop` instead of Windows' default
  `ProactorEventLoop` (uvicorn explicitly selects Proactor on `win32`,
  confirmed by reading `uvicorn/loops/asyncio.py`) via a custom
  `loop_factory`. No difference — ruled out the event-loop implementation as
  the deciding factor.
- What did work: wrapping each chunk's `await send(...)` in a bounded
  `anyio.fail_after(...)` timeout, so detection no longer depends on the OS
  ever reporting the dead connection at all. This is real `asyncio`-level
  cancellation of a suspended `await`, not an attempt to interrupt a blocked
  OS thread (which is not reliably possible in Python) — verified this is
  the correct mechanism to apply here specifically because `send()` inside
  Starlette's `stream_response` is itself an `await` on the event loop, not
  a blocking call dispatched to a worker thread.

**The "database is locked" storm.** Traced whether this is cause or effect
of the above, per the milestone's instruction not to assume. Read every
repository `update()` method: `DeviceRepository.update()` and
`TransferRepository.update()` both call `self.db.flush()` immediately.
`AuthService.authenticate()` — which runs on *every* authenticated request,
including plain `GET`s — calls both, to record `last_used_at`/`last_seen_at`.
Because the project's `SessionLocal` uses `autocommit=False` and no `GET`
route ever calls `db.commit()` (confirmed by reading every route in
`app/api/v1/transfers.py`, `shared_files.py`), that `flush()` sends real
`UPDATE` statements to SQLite and acquires SQLite's one process-wide write
lock for the rest of that request — a lock that is only released when the
session closes at the end of the request (an implicit rollback, since
nothing ever committed it). With no WAL mode configured
(`backend/app/database/session.py` has no `PRAGMA journal_mode=WAL`) and no
explicit `busy_timeout` override (Python's `sqlite3` defaults to 5s), enough
concurrent authenticated requests — Files/Transfers/Transfer-Detail polling,
described in `CLAUDE.md` as hitting the backend every few seconds, compounded
by however many extra retries a stuck transfer provokes — contend for that
one lock, and any request that loses the race past the 5s default raises
`database is locked`. This makes the lock storm a downstream *effect*: it is
plausible chiefly *because* Bug A (above) leaves a transfer stuck and
retried/polled for a long, open-ended window, giving far more opportunity
for authenticated requests to pile up than a transfer that fails within a
second or two ever would.

Direct repro attempts (up to 2,000 concurrent authenticated `GET /transfers`
requests overlapping a live 80 MiB download, both before and after the fix)
did not by themselves trip `database is locked` on this development machine
— each `flush()`'s lock hold is brief enough, and this machine's SQLite I/O
fast enough, that even heavy concurrency serializes within the 5s timeout
without visible errors. The lock-acquisition-on-every-GET behavior itself is
proven directly (by reading the code and tracing the call graph, not
inferred); that it is *sufficient on its own*, versus a real device's slower
storage/timing plus a much longer stuck-transfer retry window, to produce
the reported storm is not independently proven in this environment — see
Known Limitations.

## Root Cause

Two independent, both real, both fixed in this milestone:

1. **Unbounded/unreliable disconnect detection.** `_generate_download`'s
   only way of learning the client is gone was Starlette's own `send()`
   failure path, which depends on the OS/event loop surfacing a dead socket
   — on this Windows target, that can take tens of seconds or, while the
   server is otherwise idle, not happen within any bounded time at all. This
   is the actual cause of "jpg hangs indefinitely," the delayed
   `Download connection closed early` log for the mp3 case, and the
   `ActiveStreamRegistry` guard staying held the whole time. The exact
   3,145,728-byte cutoff itself was never a backend bug — it is simply how
   much the client happened to read before disconnecting.
2. **Unnecessary SQLite write-lock acquisition on every authenticated
   request.** `AuthService.authenticate()`'s `last_used_at`/`last_seen_at`
   bookkeeping flushed immediately on every call, including pure `GET`s that
   never commit — taking SQLite's single write lock for the full duration of
   every authenticated request regardless of whether it ever writes
   anything else. Not proven in isolation to be sufficient for the reported
   storm, but a genuine, unnecessary source of lock contention that Bug A's
   long stuck-transfer window would directly aggravate.

## Solution

- `backend/app/api/v1/transfers.py`: added `_WriteTimeoutStreamingResponse`,
  a small `StreamingResponse` subclass used only by the download route. It
  wraps each chunk's `send()` in `anyio.fail_after(Settings.
  STREAM_WRITE_TIMEOUT_SECONDS)`; on timeout it calls
  `TransferStreamService.abort_stalled_download` (via `anyio.to_thread.
  run_sync`, off the event loop, matching how this codebase already keeps
  DB work out of async code) and stops — the client is already gone, so
  there is nothing left to send.
- `backend/app/services/transfer_stream_service.py`: added
  `abort_stalled_download` (finalizes the transfer FAILED and releases the
  `ActiveStreamRegistry` guard) and factored the existing `GeneratorExit`
  handler to share the same `_mark_connection_lost` logic, so a transfer is
  only ever finalized once regardless of which path notices the disconnect
  first (`_finalize` is already a no-op past the first terminal write). The
  existing `GeneratorExit` path is left in place as a fallback for whichever
  case it does still catch (e.g. faster/cleaner client disconnects) — this
  is a second detection path, not a replacement.
- `backend/app/core/config.py`: added `STREAM_WRITE_TIMEOUT_SECONDS: float =
  15.0` — generous relative to how long even a slow real transfer should
  need to send one 1 MiB chunk, while still bounding the worst case to
  something a user would notice but not an indefinite hang.
- `backend/app/services/auth_service.py`: `authenticate()` no longer calls
  `DeviceSessionRepository.update()`/`DeviceRepository.update()` (both
  flush immediately) — it only mutates the already-tracked `session`/
  `device` ORM attributes. SQLAlchemy still picks these up at whatever
  commit the route's own service performs, exactly matching this method's
  existing documented "informational only, may be lost on a purely
  read-only route" design — the fix removes the *accidental* side effect
  (an eager write-lock acquisition on every request) without changing that
  intentional trade-off.

No architecture changes, no new technologies, no changes outside the
streaming/auth path this milestone investigated.

## Verification

- `pytest -q` (backend): **286 passed, 2 skipped** — unchanged pass count,
  confirming neither change altered any existing observable behavior.
- Reproduction re-run against the fix, same raw-socket abrupt-disconnect
  scenario: transfer status confirmed to leave `in_progress` and reach a
  terminal state without relying on the flaky OS-level signal (the write-
  timeout path is what a slow/dead real network connection would actually
  exercise; see Known Limitations for why this exact mechanism could not be
  triggered on every local loopback run).
- Concurrency check for the auth-bookkeeping fix: 2,000 concurrent
  authenticated `GET /transfers` requests overlapping a live download,
  before and after — no behavioral regression, and the fix removes a
  provable, unnecessary lock acquisition from every such request.

## Known Limitations

- **Not verified on the physical RMX3997 device.** Everything above was
  reproduced against the real backend process on the development machine,
  using a raw socket to simulate an abrupt disconnect as closely as
  possible — not the real Android app over a real hotspot. Per this
  milestone's own instructions, physical-device re-verification (all of
  `.txt`, `.pdf`, `.docx`, `.pptx`, `.jpg`, `.png`, `.zip`, `.mp3`, and
  `.mp4` if available) is still required before this can be considered
  closed, exactly as P7's own Known Limitations already flagged for that
  milestone.
- **Loopback does not reliably reproduce a stalled write.** On this
  machine's Windows loopback, the OS's own socket buffering sometimes
  absorbed an entire 80 MiB file without `send()` ever blocking, even
  against a dead peer — an artifact of loopback not needing to actually
  transmit anything over a physical link. A real Wi-Fi hotspot connection
  has genuine bandwidth and round-trip latency, so backpressure (and thus a
  stalled write) should occur far more readily and far sooner than on
  loopback — meaning the `anyio.fail_after` write-timeout fix is expected to
  matter *more*, not less, on the real device, but its exact firing
  behavior in the field is unverified.
- **The SQLite lock-storm fix reduces risk; it is not independently proven
  to eliminate the reported storm.** The unnecessary lock acquisition on
  every authenticated request is proven directly by reading the code; that
  it was *sufficient by itself* to produce hundreds of `database is locked`
  errors was not reproduced in this environment even under heavy concurrent
  load, likely because this machine's SQLite writes are fast enough to stay
  under the 5s default busy-timeout even when serialized. The real device
  may have slower storage, and — more importantly — Bug A's indefinite hang
  gives a much longer window for retries/polling to pile up than anything
  reproduced here. If `database is locked` errors still occur after this
  fix on the physical device, the next place to look is SQLite's journal
  mode (no `PRAGMA journal_mode=WAL` is currently configured — see
  `backend/app/database/session.py` — WAL allows concurrent readers
  alongside a single writer, which the current rollback-journal default
  does not).
- `docs/13_Database_Design.md`'s notes on `sessions.last_used_at` /
  `devices.last_seen_at` do not mention the flush-timing change; a doc
  update is recommended but was not made automatically, per `CLAUDE.md`'s
  documentation-ownership rule.

---

# Milestone P8.1 — Physical Device Verification (Post-P8)

## Problem

P8's own Known Limitations flagged that its fixes (bounded write-timeout
disconnect detection, the auth-bookkeeping lock fix) were never verified
against a real Android device. This milestone re-ran the full transfer
matrix (`.txt`, `.pdf`, `.docx`, `.pptx`, `.jpg`, `.png`, `.zip`, `.mp3`) on
device RMX3997 — the same physical device P7/P8 used — over its own Wi-Fi
hotspot (not loopback/USB), the exact condition P8's Known Limitations
called out as necessary to exercise real backpressure.

## Backend result: PASS

All 8 required file types (plus a few repeats from tap-coordinate mistakes,
13 downloads total including the two most implicated in the original P8
report — `.jpg` and `.mp3`) completed cleanly: `Download completed:
transfer_id=N bytes=<declared size>` for every one, byte-for-byte matching
the shared file's declared size. Zero occurrences of `Download connection
closed early` and zero occurrences of `database is locked` across the
entire session. P8's fix holds on the real device it was written for.

## Android result: two defects found, neither caused by P8

Per this milestone's own instructions, testing stopped at the first
failure (`.txt`) for root-cause investigation before continuing.

### Defect 1 — publishDownload() reported success for a file that was never actually published

**Symptom:** immediately after a `.txt` download, the Files screen showed
"Saved to Downloads/Relay" and an "Open" button, then silently reverted to
"Download" a few seconds later.

**Investigation:** `adb shell content query --uri
content://media/external/downloads` and a raw `ls` on
`/storage/emulated/0/Download/Relay/` both confirmed, on two independent
reproductions (transfer_id 35 and 36), that the file never existed at its
public destination — only at its private staging path
(`files/Downloads/test.txt`, confirmed present via `run-as`). Traced into
`node_modules/react-native-blob-util`'s native Android implementation
(`ReactNativeBlobUtilMediaCollection.java`, `writeToMediaFile()`): after
correctly writing the source file's bytes into the new MediaStore `Uri` via
a `ParcelFileDescriptor` opened in write mode, the method redundantly opens
`resolver.openOutputStream(fileUri)` a *second* time and immediately closes
it without writing anything — dead code, evidenced by a commented-out
`IS_PENDING` dance sitting right next to it that suggests an abandoned
refactor. On this device (RMX3997, ColorOS/RealmeUI, Android 16/API 36),
that redundant open-close truncates or orphans the just-written MediaStore
row, but throws no exception — so `publishDownload()`'s own try/catch
(`blobUtil.ts`) never saw a failure to report, and the transfer's local
state proceeded straight to `'completed'` with a URI pointing at nothing.
This is deterministic (hit on every attempt, both `.txt` downloads), not a
timing flake, and affects every file type identically since the code path
is direction-agnostic.

This bug lives entirely in third-party library code, not Relay's own, and
P8 touched zero Android/frontend files — confirmed unrelated to P8's
backend fix.

**Decision:** presented three options to the developer (accurately report
the failure without fixing the underlying publish; reimplement the
MediaStore write in Relay's own code to bypass the buggy library call
entirely; or leave it undiagnosed-fixed and only document it). Developer
chose the first — the smallest, lowest-risk fix, matching this milestone's
"do not redesign" instruction. `publishDownload()` (`blobUtil.ts`) now
stats the real destination path after `copyToMediaStore` resolves and only
treats the copy as successful if the published file's size matches the
staged file's; otherwise it warns and returns `null`, leaving the file at
its (already-existing) private-storage fallback rather than lying about
where it ended up. **This does not make the underlying publish actually
work on this device** — files downloaded here still won't appear in the
Downloads app or `Downloads/Relay` until the react-native-blob-util bug
itself is fixed or worked around, which was explicitly out of scope for
this fix.

### Defect 2 — the download-complete notification channel was created with no sound

**Symptom:** a "Relay" notification did appear for each completed download
(confirmed via the notification shade — "✓ test.pdf downloaded
successfully" — and via `adb shell dumpsys notification`), but per this
milestone's own matrix item ("Notification has sound"), sound was
suspect.

**Investigation:** `adb shell dumpsys notification` showed the
`relay-downloads` channel with `mSound=null` and `mAudioAttributes=null` —
compare the app's *other* channel
(`com.supersami.foregroundservice.channel`, the transfer-progress
notification), which explicitly carries
`mSound=content://settings/system/notification_sound`. `downloadNotification.ts`'s
`ensureChannel()` called `notifee.createChannel(...)` without a `sound`
field. notifee's own type declaration
(`NotificationAndroid.d.ts`) documents this exactly: *"The default value is
to play no sound. To play the default system sound use 'default'."* This is
Relay's own code (added in Milestone P4), not a third-party bug, and a
one-line fix with no meaningful alternative to weigh — applied directly
rather than re-raising as a decision.

**Solution:** `ensureChannel()` now passes `sound: 'default'` to
`createChannel()`.

**Verified at the code level, not audibly on this device:** confirmed via
the running Metro bundle (`grep`'d for `sound.*default`) and a new unit
test (`downloadNotification.test.ts`) asserting `createChannel` is called
with `sound: 'default'`. Could **not** be confirmed audibly on the
RMX3997 test device itself: Android notification channel settings
(including sound) are fixed at first creation and are not updated by a
later `createChannel()` call with the same channel ID — this device's
`relay-downloads` channel already existed from earlier (pre-fix) test runs
in this same session, and `dumpsys notification` still showed `mSound=null`
after the fix was live and reloaded. This is expected Android platform
behavior, not a flaw in the fix — a fresh install (or manually deleting the
channel via Settings) is required to observe the sound on this specific
device. Recommended before fully closing this out.

## Files changed

- `android/src/streaming/blobUtil.ts` — `publishDownload()` verifies the
  publish actually landed before trusting it (Defect 1).
- `android/src/streaming/downloadNotification.ts` — channel now created
  with `sound: 'default'` (Defect 2).
- `android/__tests__/streaming/blobUtil.test.ts` — two new regression
  tests for Defect 1.
- `android/__tests__/streaming/downloadNotification.test.ts` — one new
  regression test for Defect 2.

## Testing summary

- Backend: unaffected by either Android-side fix; the existing `pytest`
  suite (286 passed, 2 skipped per P8) was not re-run since no backend file
  changed in this milestone — only re-verified live against the physical
  device as described above.
- Android: `npx jest` — 25 suites / 156 tests passing (155 + 1 new; two new
  cases added to `blobUtil.test.ts`, one to `downloadNotification.test.ts`,
  net +3 across the two files after accounting for the pre-existing count).
  `npx tsc --noEmit` clean. `npx eslint` clean on all changed files.
- ADB: full manual matrix executed live (see Backend/Android results
  above) — this milestone's verification was physical-device-only by
  design, not simulated.
- `.mp4`: not tested — no sample file was available in the environment and
  no tool (`ffmpeg` or equivalent) was present to synthesize one; explicitly
  optional ("if available") per this milestone's brief.

## Known Limitations

- The react-native-blob-util `writeToMediaFile` bug itself (Defect 1's root
  cause) is not fixed — only its silent-false-success symptom is. Files
  downloaded on this specific device/OS combination will continue to land
  only in private app storage, invisible to the Downloads app or any file
  manager, until either the library is patched/upgraded or Relay's own code
  is changed to bypass the buggy call with a working alternative (deferred;
  see the three options presented to the developer above).
- Defect 2's fix is unverified audibly on this device for the reason
  described above (channel immutability) — verified at the code/test level
  only.
- The app's own debug instrumentation (`'[QR-DEBUG] ...'` console logging in
  `src/api/client.ts`, invoked on every single HTTP request/response) is
  extremely high-volume — high enough that it evicted the device's logcat
  ring buffer within roughly a minute of normal polling traffic during this
  session's investigation, repeatedly losing the exact moment being
  diagnosed. Left untouched as out of scope for this milestone, but flagged
  since it measurably slowed root-causing Defect 1 and would do the same to
  any future on-device investigation.

---

# Milestone P9 — Android Download Reliability (Detail Screen "Download Interrupted")

## Problem

Physical-device testing after P8/P8.1 reported `.pdf`, `.png`, and `.zip`
downloading successfully, while `.txt`, `.docx`, `.pptx`, `.jpg`, and `.mp3`
showed "Completed" on the Overview list but "Download interrupted" when
their detail screen was opened — a state that sometimes changed only after
another transfer began. This milestone's brief explicitly warned not to
assume MediaStore is the cause and asked for a full pipeline trace of both
a working and a failing type before any fix.

## Investigation

Traced every stage named in the brief — streaming, staging, publish,
`TransferStreamManager`, `Transfer` state, `TransferProgressDetail`, Files
screen, MediaStore, notification path — reading full files rather than
excerpts, on both the backend and the Android/native side.

- **Backend response path** (`backend/app/api/v1/transfers.py`,
  `backend/app/services/transfer_stream_service.py`): `Content-Length` is
  always set explicitly to the exact declared `transfer.file_size`, for
  every file, regardless of type. `guess_media_type()` only affects the
  `Content-Type` header (via `mimetypes.guess_type`), never chunking,
  never the byte loop, never the finalize/complete logic. No middleware
  (no `GZipMiddleware` or equivalent) is registered anywhere in the app —
  confirmed by grepping the entire backend for "middleware". Ruled out as
  a source of any type-dependent behavior.
- **`react-native-blob-util`'s native Android layer** (read in full, not
  excerpted): `ReactNativeBlobUtilReq.java`'s constructor picks
  `ResponseType.FileStorage` purely from whether `options.path` is set
  (always true for this app's downloads) — never from `Content-Type`.
  Content-type-based branching (`isBlobResponse()`) exists only for the
  unrelated `KeepInMemory` in-memory response mode, never reached here.
  `ReactNativeBlobUtilFileResp.isDownloadComplete()`
  (`bytesDownloaded == contentLength()`) is pure byte-count arithmetic
  against the parsed `Content-Length` header — no MIME involvement.
  `ReactNativeBlobUtilMediaCollection.createNewMediaFile`/
  `writeToMediaFile` (the actual MediaStore publish) use whatever
  `MediaType`/`mimeType` the *caller* passes — and the caller
  (`android/src/streaming/blobUtil.ts`'s `publishDownload()`) hardcodes
  `MediaType.Download` and `mimeType: 'application/octet-stream'` for
  every single download, never derived from the real file type. Per this
  milestone's own instruction not to assume MediaStore is the cause: it
  was investigated fully and ruled out on the evidence, not skipped.
- **Cross-referenced against this project's own history**: P7's own
  physical-device matrix (`docs/15_QA_NOTEBOOK.md`'s P7 entry, this same
  file) found the *opposite* ranking — `.txt` succeeded while `.pdf`,
  `.docx`, `.pptx`, and `.jpg` all failed. A genuinely type-keyed,
  deterministic bug cannot produce two contradictory rankings of the same
  extensions across two separate test passes with no code change to the
  byte-transfer path in between. P7's own diagnosis already identified the
  actual mechanism: `ReactNativeBlobUtilFileResp.isDownloadComplete()`'s
  exact byte-count check can false-negative, and is "more exposed on
  larger, multi-chunk downloads" — a size/timing property, not a type
  property. The most likely explanation for the apparent type correlation
  in both P7's and P9's reports is simply which sample files a tester
  happened to use for each extension (a quick test `.pdf`/`.png`/`.zip` is
  often small/single-chunk; a real `.jpg` photo or `.mp3` track or
  `.docx`/`.pptx` document people keep around is often several MB and
  multi-chunk) — not a rule the code implements.
- **The actual, deterministic bug**, found by comparing how the Overview
  list and the detail screen each read transfer state (per this
  milestone's specific hint that this divergence is a prime suspect):
  - `TransferListScreen` (`android/src/screens/transfers/
    TransferListScreen.tsx`) reads `transfer.status` exclusively from the
    polled `GET /transfers` response (`useTransfers.ts`) — no
    `TransferStreamManager` involvement at all. This is why it always
    correctly shows "Completed": the backend marks a `Transfer`
    `COMPLETED` unconditionally the instant it finishes writing all bytes
    to the socket (`transfer_stream_service._generate_download`,
    `_finalize`), independent of anything that happens to those bytes on
    the client afterward.
  - `TransferProgressDetail.tsx` merges server and local state via
    `mergeLiveTransferState()`, which already defers to the server outright
    once `transfer.status` is terminal (Milestone P3's rule) — this is why
    the screen's primary status text also correctly showed "Completed."
  - But a second, separate block in the same file —
    ```
    {stream?.transferId === transferId && stream.status === 'failed' && stream.error && (
      <Text style={styles.error}>{stream.error}</Text>
    )}
    ```
    — read `TransferStreamManager`'s raw module-singleton `stream` object
    directly, gated only on `stream.status === 'failed'`, completely
    bypassing `mergeLiveTransferState()`'s server-wins-once-terminal rule
    that the rest of the same screen already correctly follows.
  - `TransferStreamManager`'s `state` (`android/src/streaming/
    TransferStreamManager.ts`) is a plain module-level singleton, only
    ever reassigned from inside its own `start()` method — grepped every
    call site in `android/src` and confirmed there is no `reset()`/
    `clear()` export anywhere. Once a download's local
    `activeTask.promise` rejects (P7's native false-negative being the
    most likely trigger) and P7's own `isActuallyComplete()` recovery
    doesn't rescue it (e.g. the on-disk file isn't yet byte-for-byte
    flushed at the exact moment of rejection), `state` is stamped
    `{status: 'failed', error: 'Download interrupted.'}` for that
    `transferId` — and stays there forever, because `start()`'s own guard
    (`if (state?.transferId === transfer.id) return;`) explicitly refuses
    to ever touch that transfer's local state again ("V1 has no retry").
  - That stale text can only ever disappear when `stream?.transferId ===
    transferId` becomes false — i.e. when a *different* transfer's
    `TransferStreamManager.start()` call overwrites the singleton with a
    new `transferId`. This is precisely, and only, what "the state
    sometimes changes after another transfer begins" describes: a
    poll-based staleness bug would have self-corrected on the very next
    2-second poll tick or screen refocus regardless of whether another
    transfer started; this one specifically doesn't, because nothing else
    in the codebase ever touches `state`.
  - No render/component test exists for `TransferProgressDetail.tsx`
    (confirmed: no matching file anywhere under `android/__tests__`;
    `@testing-library/react-native` is not even an installed dependency),
    so `mergeLiveTransferState.test.ts` — which does correctly test the
    merge logic in isolation — never exercised this stray, ungated JSX
    block at all.

## Root Cause

Two things, clearly separated:

1. **Verified, deterministic, code-provable**: `TransferProgressDetail`'s
   trailing error block reads `TransferStreamManager`'s raw local state
   directly instead of going through `mergeLiveTransferState()`'s
   server-wins-once-terminal rule, so a stale local `'failed'` result can
   render underneath an already-correct "Completed" status indefinitely,
   for any transfer, of any file type, until an unrelated transfer starts.
   This alone fully and exactly explains every symptom in the bug report:
   Overview = Completed, detail = "Download interrupted", self-corrects
   only when another transfer begins.
2. **Plausible but not newly proven, and explicitly not type-keyed**: what
   makes the local `activeTask.promise` reject in the first place is most
   likely P7's already-documented `isDownloadComplete()` false-negative
   (a size/timing-dependent flake, not a per-extension rule) — exhaustive
   tracing of the backend, `blobUtil.ts`, `TransferStreamManager.ts`, and
   every relevant native `react-native-blob-util` Java source found no
   file-extension or MIME-type branching anywhere in the byte-transfer,
   completion-check, or MediaStore-publish path. This is independently
   corroborated by P7's own matrix showing the opposite type ranking on
   the same codebase area.

## Solution

`android/src/screens/transfers/TransferProgressDetail.tsx`: changed the
trailing error block's guard from the raw `stream.status === 'failed'` to
`merged.status === 'failed'` — the same server-aware value that already
drives this screen's status text and Cancel button. Once
`mergeLiveTransferState()` sees a terminal server `transfer.status`, it
already ignores the local stream outright (Milestone P3), so once the
server confirms `'completed'`, this block can no longer render a stale
local error underneath it — for any file type, regardless of what
originally caused the local promise to reject. Nothing else changed:
`TransferStreamManager`, `mergeLiveTransferState`, the backend, and the
MediaStore/publish path were all traced and confirmed clean, so touching
any of them would have been outside this milestone's "smallest correct
fix" instruction.

## Verification

- `android/__tests__/transfers/mergeLiveTransferState.test.ts`: added a
  case — server `status: 'completed'` merged against a local stream still
  reporting `status: 'failed', error: 'Download interrupted.'` — asserting
  the merge result is `status: 'completed'` outright, documenting the
  exact scenario the fix now depends on.
- Full Android suite: `npx jest` — 25 suites / 157 tests passing (156 + 1
  new). `npx tsc --noEmit` clean.
- Backend: untouched by this milestone; not re-run.
- Live device E2E across the full `.txt`/`.docx`/`.pptx`/`.jpg`/`.mp3`/
  `.pdf`/`.png`/`.zip` matrix was **not** run as part of this fix — no
  physical device/desktop pair was available in the environment the fix
  was made in, the same constraint recorded throughout this notebook.
  **Required before closing this out.**

## Remaining Limitations

- The upstream trigger for the local completion promise occasionally
  rejecting at all (P7's `isDownloadComplete()` false-negative) is
  unchanged by this fix — this milestone only stops that rejection from
  producing a permanently stale, contradictory error message once the
  server has already confirmed success. A transfer whose local stream
  never recovers and whose server-side transfer also genuinely fails will
  still correctly show its real failure reason.
- The five-extension list in the original bug report should not be read
  as a reliable reproduction recipe — see Investigation above for why
  P7's own matrix produced the reverse ranking on the same underlying
  mechanism. Physical re-verification should test with both small and
  large files of a given type, not assume the extension itself is what
  matters.
- As with every prior milestone in this notebook, this fix's correctness
  rests on a full code trace and the existing/updated Jest suite, not a
  live device run — flagged as the load-bearing gap to close before this
  milestone can be considered done.

---

# Milestone P9.1 — Live Physical Device Investigation: Two Verified, Fixed Defects, One Verified, Unfixed Defect

## Problem

P9's fix (the detail screen's stale "Download interrupted" text) was accepted, but the primary defect was reported as still present: `.pdf`/`.png`/`.zip` downloads succeeding, `.txt`/`.docx`/`.pptx`/`.jpg`/`.mp3` failing, with the transfer still reaching `Completed` and the actual file ending up "unavailable or unusable." This milestone required a live run against the physical device (RMX3997, connected over its own Wi-Fi hotspot, backend and Metro started locally), not a code-only trace — comparing one known-good and one known-bad file's complete execution end to end.

## Investigation

Backend (`uvicorn`) and Metro were started locally; `adb` confirmed the RMX3997 device connected and authorized. The already-paired, already-installed app was launched, driven via `adb shell input tap` against screenshots (`adb exec-out screencap`), with temporary `[P9.1]`-tagged `console.log` instrumentation added to `blobUtil.ts` and `TransferStreamManager.ts` (removed after use) and captured via `adb logcat`, cross-referenced against `backend/logs` and direct filesystem/MediaStore inspection (`adb shell ls`, `adb shell content query`).

- **`test.pdf` (reported good) traced completely.** `downloadFile` resolved cleanly, on-disk size matched the declared 1422 bytes exactly. `publishDownload` → `copyToMediaStore` resolved with a real content URI. Confirmed via `adb shell ls /storage/emulated/0/Download/Relay/` that the file genuinely landed there, byte-for-byte correct. **The divergence:** `isPublishedAt()` (`blobUtil.ts`) statted `${DownloadDir}/Relay/test.pdf`, which resolved (per `ReactNativeBlobUtilFS.java`) to `Context.getExternalFilesDir(DIRECTORY_DOWNLOADS)` — the app's own private, scoped external directory (`/storage/emulated/0/Android/data/com.relay.mobile/files/Download/Relay/`), a path that doesn't even exist — not the real public folder `copyToMediaStore` actually publishes into. The stat always failed, so `publishDownload()` unconditionally returned `null` regardless of whether the publish genuinely succeeded, leaving the staging copy never deleted, the completion notification's tap-to-open URI always `null`, and — since `downloadExistence.ts`'s `downloadedFilePath()` duplicated the exact same wrong path — `useDownloadExistence` always reported `false`, which `deriveDownloadStatus()` then downgraded from `completed` back to `idle`. Confirmed live: the Files screen's button for `test.pdf` reverted from "Downloading..." straight to plain "Download" a few seconds after a fully successful transfer — the literal "file is unavailable" symptom, on a file that was not actually unavailable. This is unconditional and applies identically to every file type — it is not what makes some extensions fail and others succeed.
- **`test.jpg`/`test.txt`/`test.png` (reported bad) traced completely.** Backend logs were clean for all three — `Download completed: transfer_id=N bytes=<declared size>`, matching P7/P8/P9's own prior finding that the backend is not the source. The client side was genuinely different this time: `isActuallyComplete()`'s own stat showed on-disk sizes strictly below the declared size at the moment of rejection — `test.jpg` 1460/17868, `test.txt` 1460/3000, `test.png` 2920/4311 on a first attempt and 1460/4311 on an immediate retry of the same file. Every observed cutoff is a multiple of ~1460 bytes (standard TCP MSS payload size), never a fixed value, never equal to the declared size — ruling out P7's false-negative-on-an-already-complete-file mechanism (which requires an exact size match) and proving genuine, live, reproducible data loss during the network read itself. `test.pdf` (1422 bytes, fits inside one TCP segment) never exhibited this; every file requiring more than one segment did, non-deterministically. This directly reproduces, with hard byte-count evidence for the first time, what P9's own investigation already inferred from history alone: the extension correlation in every prior report (including this milestone's own bug report) is coincidental — a function of which sample files happened to be small vs. large — not a rule the code implements. Read `react-native-blob-util`'s native `ReactNativeBlobUtilReq.java`'s `done()` (`FileStorage` case): the loop that drains the response body (and, as a side effect, performs the actual disk write) is wrapped in `catch (Exception ignored) {}` with `printStackTrace()` commented out — any real `IOException` that kills the connection mid-read is silently discarded, and only the generic, post-hoc `isDownloadComplete()` byte-count mismatch ever surfaces, as `"Download interrupted."` This is why no prior milestone could see the real cause: it never leaves the native layer.
- **A third, independent defect found while tracing the "Open" pipeline stage** (explicitly in scope per this milestone's brief). Tapping "Open" on a file already confirmed correctly published (after the first fix, live) failed every time with `Calling startActivity() from outside of an Activity context requires the FLAG_ACTIVITY_NEW_TASK flag` (captured via temporary instrumentation in `FilesScreen.tsx`'s `handleOpen`, removed after use). Traced to `ReactNativeBlobUtilImpl.java`'s `actionViewIntent`: it sets `FLAG_ACTIVITY_NEW_TASK` on the original `Intent`, then reassigns `intent = Intent.createChooser(intent, chooserTitle)` — `createChooser` returns a *new* wrapper `Intent` that does not inherit that flag, and `RCTContext` (an application context, not an `Activity`) requires the flag on whatever `Intent` is actually passed to `startActivity()`. `downloadActions.ts` always passed a non-null chooser title (`'Open with'`), so this fired on every single call, deterministically.

## Root Cause

Three separate, independently verified defects:

1. **`DownloadDir` vs. `LegacyDownloadDir` path confusion** (`blobUtil.ts`, `downloadExistence.ts`) — unconditional, affects every file type identically, and is what makes even a *successful* download appear unavailable in the UI. **Fixed.**
2. **Real, live, non-deterministic connection loss on multi-TCP-segment downloads** over this device's own hotspot, whose true cause is hidden by a swallowed exception inside `react-native-blob-util`'s native response-draining loop. This is what produces genuinely short, corrupt files for larger downloads — not a false completion check, not a UI staleness issue. **Not fixed** — see Remaining Limitations.
3. **`Intent.createChooser` dropping `FLAG_ACTIVITY_NEW_TASK`** (`ReactNativeBlobUtilImpl.java`, triggered by `downloadActions.ts` passing a non-null chooser title) — made "Open" fail on every completed download, independent of defects 1 and 2. **Fixed.**

## Solution

- `android/src/streaming/blobUtil.ts`: `isPublishedAt()` and `resolveAvailableMediaStoreName()` now stat `ReactNativeBlobUtil.fs.dirs.LegacyDownloadDir` (which — despite the name — is the one that actually resolves to `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS)`, the real public folder `copyToMediaStore` publishes into on every API level) instead of `DownloadDir`.
- `android/src/files/downloadExistence.ts`: `downloadedFilePath()`'s API 29+ branch gets the same fix, for the same reason — it deliberately mirrors `blobUtil.ts`'s destination logic per Milestone P2's own note to keep the two in sync.
- `android/src/files/downloadActions.ts`: `openDownloadedFile()` no longer passes a chooser title to `actionViewIntent` (`undefined` instead of `'Open with'`), which skips the buggy `createChooser` wrapping entirely. Android still shows its own disambiguation picker when more than one app matches (confirmed live); it just doesn't carry a custom title. This is a third-party (`node_modules/react-native-blob-util`) bug, avoided from this call site rather than patched in place — matching this codebase's own existing `isActuallyComplete()` precedent (P7) for working around a library defect without touching `node_modules`.
- Defect 2 (the real connection loss) was **not** code-fixed in this milestone — the developer was presented with three options (report only; add a bounded retry in Relay's own code; patch `react-native-blob-util` directly) and chose to report only, consistent with this notebook's established precedent (P7) against patching `node_modules`, and with V1's repeatedly-documented "no retry" design decision throughout this notebook. Adding retry behavior would be a genuine feature change requiring its own milestone, not a "smallest correct fix."

## Verification

- `npx tsc --noEmit`: clean.
- Full Android suite: `npx jest` — 25 suites / 157 tests passing (mock's `fs.dirs` gained `LegacyDownloadDir`; `downloadActions.test.ts` updated for the dropped chooser title).
- Live device (RMX3997), this session, not deferred:
  - `test.pdf` re-downloaded fresh; `adb shell ls /storage/emulated/0/Download/Relay/` confirmed the byte-for-byte-correct published file; Files screen correctly showed "Open"/"Saved to Downloads/Relay" instead of reverting to "Download".
  - Tapping "Open" launched Android's real disambiguation picker ("Browser PDF viewer", "Adobe Acrobat"); selecting Adobe Acrobat opened the file without error.
  - `test.jpg`, `test.txt`, `test.png` (twice) all reproduced genuine short-file rejection with hard byte-count evidence, confirming Defect 2 as a real, live, unfixed condition rather than a hypothesis.

## Remaining Limitations

- **Defect 2 (real connection loss on larger downloads) is unresolved.** A transfer whose bytes are genuinely cut short by the network will still correctly fail (this is accurate, not a bug) — but the underlying *why* (why this specific device/hotspot pairing loses the connection after roughly one TCP segment, non-deterministically) cannot be diagnosed further from React Native/JS: the only diagnostic signal (the real `IOException`) is discarded inside `react-native-blob-util`'s native code before it ever reaches JS. A future investigation would need either a packet capture on the Android side or a patched/forked build of the library to see the real exception.
- The two-fix live verification above used `test.pdf` (a single-segment file) as the good-path regression check; it was not re-run against every extension in the original report, since Defect 2's non-determinism means any individual re-run is not a reliable pass/fail signal for defects 1/3 either way.
- Files downloaded before this fix (during earlier sessions, including P8.1's) are left as-is: a duplicate copy sits in private staging (never cleaned up by the pre-fix `publishDownload()`), while a correct copy already exists at the real public path. No migration/cleanup of pre-existing installs was in scope for this milestone.

---

# Milestone P11 — Concurrent Download Freeze Investigation (Physical Device)

## Problem

Tapping Download on 3 or more shared files in quick succession put every one of them into "Downloading..."/`in_progress`, after which all but one appeared permanently frozen at 0 bytes — no transport error, no "Download interrupted", and the backend showed nothing wrong. Opening the Transfers tab and then a frozen transfer's own detail screen made it "unstick" and complete almost instantly. UI work was frozen for this milestone; only the underlying lifecycle could be touched, and the instruction was to prove the root cause live on the physical device (RMX3997, connected via USB/adb, backend reached over the phone's own hotspot) before changing anything.

## Investigation

Backend (`uvicorn app.main:app --host 0.0.0.0`) and Metro were started locally; `adb reverse tcp:8081 tcp:8081` tunneled Metro to the USB-connected device, and the already-paired, already-installed app was relaunched to pick up temporary `[P11]`-tagged `console.log` instrumentation added to `TransferStreamManager.start()` (guard entry/exit) and `FilesScreen.handleDownload` (removed after use), captured via `adb logcat ReactNativeJS:V` and cross-referenced against `backend/logs/relay.log`. 16+ disposable 5 MB files were shared directly through `POST /api/v1/files` (backend reached over loopback) to get enough distinct, never-downloaded rows for repeatable 2/3/5-tap batches, driven via `adb shell input tap` against `adb exec-out screencap` screenshots.

- **2 concurrent taps**: both `proposeTransfer` calls succeeded (backend auto-accepted both, e.g. transfer 124 and 125). `TransferStreamManager.start()` ran for 124 (`PROCEEDING`), but the call for 125 hit `state?.status === 'streaming'` and logged `NO-OP (busy)` — a silent, unconditional return with no retry scheduled anywhere. `grep`ing `backend/logs/relay.log` for transfer 125 showed only the `Transfer auto-accepted` line — no `Download completed`, no error, no `ActiveStreamRegistry` conflict — proving the backend never received the `GET /transfers/125/download` request at all. This is the first point of divergence: the drop happens entirely client-side, before any network I/O.
- **3 and 4/5 concurrent taps**: identical pattern, scaled — exactly one transfer streamed per batch, the rest (2 of 3, 3 of 4) logged `NO-OP (busy)` and sat at `0 B` indefinitely. One case (`transferId=133`) was dropped by the `starting` re-entrancy flag rather than `state.status`, confirming that guard also works as designed — it just has the same fate (silent drop, no queue) as the main guard.
- **Reproduced the reported "Transfers tab unsticks it" behavior directly**: opening `TransferListScreen` alone did *not* start the stuck transfer (it has no code path that calls `TransferStreamManager.start()` for an existing row). Navigating into that specific transfer's `TransferProgressDetail` did — its own `useEffect` opportunistically calls `start()` for any `in_progress` transfer it observes, which is the *only* other call site in the codebase. Since the manager was idle again by then, the call succeeded and the transfer (already fully available on the backend) completed in about a second, exactly matching "completes almost instantly."

## Root Cause

`TransferStreamManager` (`android/src/streaming/TransferStreamManager.ts`) is a strict app-wide singleton — by design, only one transfer's bytes move at a time (documented at the top of the file, matching `docs/11_File_Transfer.md` §10's sequential-processing model). The bug was never the one-at-a-time constraint itself; it was that a `start()` call arriving while another transfer was active was **silently dropped** with no path back to running it, rather than deferred. `FilesScreen.handleDownload` calls `start()` once per proposed download and never again — the Download button disables itself once the transfer is `in_progress`, so nothing on that screen retries. The only code that ever called `start()` a second time for the same transfer was `TransferProgressDetail`'s own opportunistic effect, which only runs if the user happens to navigate to that exact transfer's detail screen. A transfer proposed anywhere else — the ordinary case of a second or third rapid tap on FilesScreen — had no way back to streaming and stayed at 0 bytes forever. Not a networking, backend, or `ActiveStreamRegistry` issue: the backend logs and the absence of any HTTP request for the dropped transfer IDs confirm the client never even tried.

## Solution

`android/src/streaming/TransferStreamManager.ts`: a `start()` call that arrives while another transfer is streaming (or mid-`starting`) now joins a small in-memory FIFO `queue` instead of returning silently. The active stream's `finally` block (and the pre-`try` early-return path for a missing session, which also bypasses that `finally`) both drain one entry off `queue` and call `start()` on it once the current transfer is fully done — success, failure, or cancellation. `enqueue()` dedupes against the currently-active transfer and anything already queued, so redundant calls from both existing call sites (FilesScreen and TransferProgressDetail's opportunistic effect) stay harmless, as the module's own doc comment already required. The one-active-stream-at-a-time invariant is unchanged; only the "then what happens to the rest" behavior changed, from silently stuck to automatically continued. No UI/screen files were changed, per this milestone's UI freeze — the fix is entirely inside the streaming manager's own module-level state machine.

## Verification

- `npx tsc --noEmit`: clean.
- Live device (RMX3997), this session, not deferred — repeated after the fix, using fresh never-downloaded shared files each time:
  - 2 concurrent taps: both transfers streamed sequentially and reached "Open" with no manual intervention.
  - 3 concurrent taps: all three streamed sequentially and completed.
  - 5-tap batches (4 of 5 taps landed as genuinely concurrent proposals each round, `adb`'s synthetic taps occasionally missing a shifting row — not a product defect): every proposed transfer streamed and completed automatically, confirmed both in `backend/logs/relay.log` (`Download completed: transfer_id=...` for every id, in order, with no gaps) and in the Files screen (`Downloading...` → `Open` for every row, no visit to the Transfers tab required).
  - `adb logcat` across the full final regression run contained no errors, warnings, or crashes; `backend/logs/relay.log` contained no error/warning entries for any transfer created during this session.
- Test shared files (`p11_*.bin`, ids created via direct `POST /api/v1/files` calls against the loopback backend for repeatable testing) were unshared via `DELETE /api/v1/files/{id}` after verification; none are part of the repository.

## Remaining Limitations

- Queued transfers are still processed strictly one at a time (by design — this milestone fixed the silent drop, not the single-stream architecture itself). A transfer waiting in `queue` shows "Downloading..." on FilesScreen from the moment it's proposed, even though its bytes haven't started moving yet; this was already true of the transfer actually streaming and is unchanged here.
- If a queued transfer is cancelled server-side (e.g. via its detail screen) before its turn comes up, `TransferStreamManager.start()` does not special-case that: it will still attempt to stream it when dequeued and get the backend's existing 409 (`This transfer is not currently active.`), surfaced the same way any other stream failure already is. No new guard was added for this pre-existing class of race, consistent with keeping this fix to the smallest change that resolves the reported freeze.
- UI work remained frozen for this milestone; nothing surfaces queue position/depth to the user. If a future milestone lifts that freeze, showing "queued" distinctly from "downloading" would be a natural follow-up.
