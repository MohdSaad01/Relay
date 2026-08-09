# QA Notebook

Version: 1.1 — condensed 2026-08-09.

Practical notes from real issues hit during Relay development — not a
specification. Entries are condensed to the durable lesson (problem, real
root cause, fix, and anything still open); exhaustive step-by-step
investigation transcripts and per-milestone test-count logs have been
trimmed — current aggregate test status lives in `docs/14_Testing_Plan.md`
§3. See `docs/08_Architecture_Decisions.md` for architectural decisions and
`CLAUDE.md` for milestone history.

All physical-device entries below used a single test device: a realme C65
5G (model RMX3997, ColorOS/RealmeUI, Android 16/API 36). Several defects
were specific to this OEM's native library behavior — treat "verified live"
as "verified on this one device," not as multi-device coverage.

---

# Android Build — CMake/Ninja Path-Length Failure

**Problem:** `npx react-native run-android` failed on Windows with `ninja:
error: Filename longer than 260 characters` during `buildCMakeDebug`, even
after enabling Windows Long Paths.

**Root cause:** AGP silently falls back to its own bundled default CMake
(3.22.1) for any native module that doesn't explicitly pin
`externalNativeBuild.cmake.version` — nothing in the project pinned one, so
CMake 3.22.1 (and its shorter path tolerance) kept getting reinstalled
regardless of the registry Long Paths fix.

**Fix:** Installed CMake 4.1.2 via the SDK Manager and pinned
`externalNativeBuild.cmake.version = "4.1.2"` in
`android/android/app/build.gradle`. No `node_modules` or SDK-internal files
were touched (those changes don't survive a clean install and aren't
visible to other developers).

**Notes for future builds:** Use JDK 17 for this project (newer JDKs, e.g.
25, aren't supported by the AGP version in use — run `npx react-native
doctor` early to catch this). If this error reappears, check which CMake
version Gradle is actually invoking (`cmake\<version>\bin\ninja.exe` in the
build log) before trying anything else.

---

# Android FilesScreen Stuck on "Requested" After a Completed Download

**Problem:** After a transfer completed successfully (desktop and the
Android Transfers screen both correctly showed `Completed`), the Files
screen kept showing that file's Download button as "Requested" forever.

**Root cause:** `FilesScreen` tracked download status in a local
`useState` set once to `'requested'` when the propose call resolved, and
never updated again — it had no subscription to the real
request/transfer lifecycle already tracked server-side and already polled
by `TransferListScreen`.

**Fix:** Added `deriveDownloadStatus(fileId, requests, transfers)` — a pure
function mapping a shared file to `idle | pending | in_progress |
completed | failed` from the same polled request/transfer lists
`TransferListScreen` already used. `FilesScreen` now polls those lists
itself and derives each row's label from this function instead of local
state. This function became the foundation every later Files-screen
milestone built on.

---

# Downloaded Files Invisible to the User (Written to App-Private Storage)

**Problem:** A "Completed" download could not be found anywhere on the
device via search or file manager.

**Root cause:** The download destination
(`ReactNativeBlobUtil.fs.dirs.DocumentDir`) resolves to the app's
**internal private storage** (`ctx.getFilesDir()`), not any
user-accessible location — never indexed by MediaStore or search, and
different from the `Android/data/...` directory a user might try to browse
to instead.

**Fix:** Added `publishDownload()` — after a download finishes at its
(still private) staging path, copies it into `Downloads/Relay/<fileName>`
via MediaStore (`copyToMediaStore`, permission-free on API 29+) and deletes
the staging copy. Deliberately best-effort/non-throwing: the transfer has
already fully succeeded by this point, so a publish failure must not turn
it into a reported failure.

**Known limitation:** `MediaStore.Downloads` requires API 29; the app's
`minSdkVersion` is 26, so below API 29 `publishDownload()` is a no-op and
the file stays at its private path (not a regression, just not
user-visible on very old Android — accepted given the shrinking install
base).

---

# Download Flow Required Manual Desktop Approval, Manual Transfers-Tab Visit, and No Completion Feedback

**Problem:** Downloading a shared file required three manual steps adding
no real value: the desktop had to click Accept on every download even
though sharing the file was already the real decision; Android had to
separately visit the transfer's detail screen before bytes started moving;
nothing told the user a download had finished.

**Root cause:** `TransferService.request_transfer` always created a
`PENDING` request needing a separate `accept` call; `TransferStreamManager.start()`
was only ever invoked from the detail screen's own mount effect; nothing
posted a notification after the transfer-progress notification tore down.

**Fix:** Backend: `request_transfer` now auto-accepts a `send` (download)
request in the same call that proposes it, creating the `Transfer` row
immediately (uploads were still manual at this point — see Milestone P1
below). Android: `FilesScreen.handleDownload` now fetches the accepted
`Transfer` and hands it straight to `TransferStreamManager.start()` instead
of waiting for a Transfers-tab visit. Added `@notifee/react-native` (the
only notification-capable dependency, `@supersami/rn-foreground-service`,
is scoped to its own foreground-service lifecycle and can't show a
standalone notification with a real tap-to-open action) for a completion
notification that opens the published file directly via its MediaStore
content URI.

---

# Milestone P1 — Upload Workflow Still Required Manual Desktop Approval

**Problem:** The entry above removed download friction; the mirror-image
upload flow still required the desktop to click Accept on every proposed
upload under an "Incoming Transfer Requests" panel.

**Root cause:** `request_transfer` special-cased `direction=send` only —
a `receive` (upload) proposal stayed `PENDING` until a separate
desktop-initiated accept call.

**Fix:** `request_transfer` now creates the `Transfer` row immediately for
**both** directions (the desktop already made the decision that matters
when it paired with the device). Deleted `accept_request`/`reject_request`/
`withdraw_request` and their routes (nothing is ever left `PENDING` for
them to act on), the desktop's "Incoming Transfer Requests" table, and
Android's `TransferRequestDetail`/`useTransferRequest` (nothing is ever
left pending to view or withdraw). `TransferListScreen.handleUpload` now
mirrors `FilesScreen.handleDownload` exactly.

---

# Milestone P2 — Shared Files Screen Never Re-Validated What It Displayed

**Problem:** Three issues, all rooted in the same theme — the Files
screen trusted state it never re-checked: (1) a deleted download still
read "Downloaded"; (2) every download showed a meaningless `'...'` button
state before "Downloading..."; (3) a newly shared file didn't appear
without a manual pull-to-refresh.

**Root cause:** (1) `deriveDownloadStatus` mapped a `completed` Transfer
straight to `'completed'` with no on-device existence check — a
genuinely different question the backend has no way to answer, since the
download happens entirely client-side after the backend already finished
streaming. (2) The `'...'` label covered a window where the eventual state
("Downloading...") was already a foregone conclusion — the backend creates
the `Transfer` row as `IN_PROGRESS` in the same call that proposes it. (3)
`useSharedFiles()` only fetched on mount and on manual pull-to-refresh, no
focus-driven poll (unlike transfers, which already had one).

**Fix:** (1) Added `downloadedFileExists()`/`useDownloadExistence()`;
`deriveDownloadStatus` gained an optional `fileExists` parameter —
`false` downgrades `'completed'` to `'idle'`, `undefined` ("not checked
yet") or `true` leave it alone. (2) The `'...'` label was replaced with
"Downloading...". (3) Added `refreshSilently()` (same fetch core as
`refresh()`, never toggles the pull-to-refresh spinner), called
immediately on focus and then every 5s while focused.

---

# Milestone P3 — Transfer State Consistency & Download Reliability

**Problem:** Three inconsistencies: (1) the Transfers tab took ~2-3s to
show a just-started download; (2) a transfer's detail screen briefly showed
stale, smaller byte counts than the Overview list already showed
Completed; (3) multiple downloads could all report Completed while only
one file actually existed in `Downloads/Relay`.

**Root cause:** (1) `TransferListScreen`'s focus effect started a polling
interval but never refreshed immediately, and `createBottomTabNavigator`
keeps tab screens mounted (no remount to force a fresh fetch) — the exact
staleness class P2 already fixed for shared files, not yet applied here.
(2) The detail screen merged server state with `TransferStreamManager`'s
live state unconditionally; the live state doesn't reach `'completed'`
until *after* `publishDownload`/`notifyDownloadComplete` finish, even
though the backend (and the Overview list) already show `completed`. (3)
`publishDownload`'s underlying MediaStore call had no conflict handling at
all — the backend's own upload-side `resolve_available_path` "name
(1).ext" convention had no Android download-side equivalent.

**Fix:** (1) Both screens' focus effects now refresh immediately before
starting their polling interval. (2) The detail screen's live-stream
preference now additionally requires `transfer.status === 'in_progress'` —
once the server is terminal, it wins outright. (3) Added
`resolveAvailableMediaStoreName()`, the same "name (1).ext" convention,
checked via a raw filesystem read before `copyToMediaStore` runs.

---

# Milestone P4 — Download Completion Notification Never Appeared, No Action on a Finished Download

**Problem:** (1) The completion notification added in the entry above
never actually appeared. (2) A completed download's Files-screen row was a
disabled, dead-end "Downloaded" pill.

**Root cause:** (1) Two compounding defects in `downloadNotification.ts`:
`notifyDownloadComplete()` was awaited unguarded — any failure (most
plausibly a denied `POST_NOTIFICATIONS` permission, silently dropped by
Android with no exception) propagated up and wrongly marked an
already-successful transfer `'failed'`; and `ensureChannel()` cached the
*promise* from `notifee.createChannel()` even when it rejected, so one
early failure permanently disabled notifications for the rest of the app
session. (2) No Open/Share action had ever been wired up — investigated
what the existing dependencies actually support:
`react-native-blob-util`'s `actionViewIntent` (`ACTION_VIEW`, with
FileProvider handling built in) worked; React Native's own `Share` module
discards its `url` field entirely on Android, so true sharing would need a
new native dependency (not added — flagged for a future milestone).

**Fix:** `notifyDownloadComplete()` now wraps its body in `try/catch`
(matching `publishDownload()`'s existing best-effort contract);
`ensureChannel()` clears its cached promise on failure so the next call
retries. Added `downloadActions.ts` (`openDownloadedFile`) — Files screen
now shows an "Open" button plus a "Saved to Downloads/Relay" caption, gated
on `useDownloadExistence` having explicitly confirmed the file still
exists.

---

# Milestone P5 — Live Synchronization & UX Responsiveness

**Problem:** Explicitly a responsiveness pass over the existing polling
architecture (no WebSockets/push): (1) a redundant extra request fired on
every screen's first mount; (2) a download/upload's stream start waited on
an unrelated list refresh before bytes began moving; (3) the detail
screen's status badge/Cancel button lagged a few seconds behind the
progress bar already reaching 100%.

**Root cause:** (1) Each hook already fetched once on mount, and P3's
focus-refresh fired again at that same first-mount moment. (2) Handlers
`await`ed the list refresh before calling `getTransfer()`/`start()`, even
though the two don't depend on each other. (3) P3 fixed the
server-ahead-of-local case; the reverse (local stream reaches a terminal
state before the next 2s server poll) fell through to a stale
`transfer.status`.

**Fix:** (1) A `useRef` first-focus guard skips the immediate
refresh-on-focus call only on a screen's very first focus. (2) Handlers now
start the refresh without awaiting it, run `getTransfer()`/`start()`
concurrently, and only await the refresh afterward. (3) Added
`mergeLiveTransferState.ts` — server still wins once terminal (P3,
unchanged), but a local stream that's *itself* already terminal now also
wins over a still-`in_progress` server poll; this module became the single
place both the status text and the Cancel-button gate read from, and the
foundation for several later fixes (P9, P13.3).

---

# Milestone P6 — File Browser UX Refinement

**Problem:** (1) A completed download could still briefly show the
disabled "Downloaded" pill P4 was supposed to have removed. (2) A stale
"couldn't open this file" message could linger after a row no longer
offered Open.

**Root cause:** Both from the same pattern — a piece of UI state computed
its own second opinion instead of deferring to a single source of truth
nearby. (1) `FileRow`'s `canOpen` required `fileExists === true`, stricter
than `deriveDownloadStatus`'s own tolerance (which already treats
"not checked yet" as good enough). (2) `openErrors` was only cleared at the
top of a successful `handleOpen`, not by a fresh download attempt or by the
row leaving the completed state.

**Fix:** `canOpen` simplified to `status.kind === 'completed'` alone (the
`fileExists` prop was removed from `FileRow` entirely). `handleOpen`'s
failure path now calls `verify()` to re-sync existence; `handleDownload`
clears any stale open-error at the start of a fresh attempt. Also: a failed
download's retry button now reads "Retry" instead of "Download", so the
two states are distinguishable at a glance.

---

# Milestone P7 — Android Download Publishing: Only `.txt` Files Reached Downloads/Relay

**Problem:** On a physical device, `.txt` downloads worked end-to-end;
every larger type tested (`.pdf`, `.docx`, `.pptx`, `.jpg`, `.png`) instead
showed "Download interrupted" with no published file and no notification —
despite clean backend logs confirming every byte was sent correctly for
every type.

**Investigation:** Traced the full pipeline before assuming a cause. Ruled
out the backend (headers are correct and type-independent; no compression
middleware exists). Ruled out any type/MIME branching anywhere in
`react-native-blob-util`'s download path (confirmed by reading the native
source in full) — `publishDownload()` already hardcodes
`application/octet-stream` for every download regardless of type, so MIME
can't be the differentiator either. The actual differentiator was response
**size**: `.txt` test files fit in one chunk; the failing types didn't.

**Root cause:** `react-native-blob-util`'s
`ReactNativeBlobUtilFileResp.isDownloadComplete()` — an exact
`bytesDownloaded == Content-Length` equality check — can false-negative on
a real device connection even after every byte has already been written to
disk, and is more exposed on larger, multi-chunk downloads (an openly
reported upstream issue, react-native-blob-util #268). No existing test
could have caught this: `blobUtil.test.ts` mocks the library entirely and
never executes this native code path.

**Fix (mitigation only — see Milestone P10 for the actual native root
cause):** `downloadFile()` now takes the transfer's declared `file_size`
and, on a native rejection, stats the file already on disk — an exact size
match is treated as success (a genuine cancellation is exempted and always
propagates; a genuinely short file still rejects).

---

# Milestone P8 — Streaming Failure Root Cause Investigation (Backend)

**Problem:** Physical retest of P7's fix surfaced a more serious, distinct
failure: a `.mp3` disconnected at exactly 3,145,728 bytes (= 3 ×
`STREAM_CHUNK_SIZE_BYTES` — how much the client had read before stopping,
not a backend limit), a `.jpg` hung indefinitely, and the backend then
logged hundreds of `sqlite3.OperationalError: database is locked`.

**Investigation:** Built a real raw-socket reproduction (an abrupt RST
mid-download) against a real `uvicorn` process, since `TestClient`'s
in-process ASGI transport can't simulate an actual dropped connection.
Ruled out the classic FastAPI+`Depends(get_db)`+`StreamingResponse`
early-session-close bug by reading the installed FastAPI version's actual
source (it uses a two-stack `AsyncExitStack`; the DB session stays open
through the full response in this version). Confirmed `Request.is_disconnected()`
and forcing `SelectorEventLoop` over Windows' default `ProactorEventLoop`
both made no difference.

**Root cause:** Two independent bugs. (1) `_generate_download`'s only
disconnect signal was Starlette's `send()` raising `OSError` — entirely
dependent on the OS/event loop noticing a dead socket, which on this
Windows target took up to 19s or, while otherwise idle, never happened at
all (confirmed with an 80 MiB reproduction that "completed" successfully
server-side against a peer gone the entire time). (2)
`AuthService.authenticate()` flushed `last_used_at`/`last_seen_at` on
*every* authenticated request, including read-only GETs that never commit
— holding SQLite's single write lock for the whole request. Not
independently proven sufficient alone to cause the reported storm on this
machine's fast SQLite I/O, but a real, unnecessary contributor that bug (1)
directly aggravates by leaving a transfer stuck and re-polled far longer
than it should be.

**Fix:** Added a `_WriteTimeoutStreamingResponse` wrapping each chunk's
`send()` in `anyio.fail_after(STREAM_WRITE_TIMEOUT_SECONDS)` (new setting,
default 15s); on timeout, `TransferStreamService.abort_stalled_download`
finalizes the transfer and releases the stream-registry guard.
`AuthService.authenticate()` now mutates already-tracked ORM objects
directly instead of calling repository `update()` methods that flush
immediately — removing the accidental write-lock acquisition while keeping
the method's existing "informational, may be lost on a read-only route"
design.

**Gotcha for future backend work:** loopback doesn't reliably reproduce a
stalled write (the OS can buffer an entire file without `send()` ever
blocking, even against a dead peer) — a real Wi-Fi link has genuine
backpressure and should trigger the timeout far sooner. If `database is
locked` ever recurs on-device, `backend/app/database/session.py` has no
`PRAGMA journal_mode=WAL` configured — that's the next thing to try.

---

# Milestone P8.1 — Physical Device Verification (Post-P8)

**Result:** P8's fix held cleanly (8 file types, zero disconnect/lock
errors on RMX3997 over its own hotspot). Two Android-only defects found,
unrelated to P8:

**Defect 1 — `publishDownload()` reported success for a file that was
never actually published.** `ReactNativeBlobUtilMediaCollection
.writeToMediaFile()` redundantly opens the destination output stream a
*second* time and immediately closes it without writing — dead code (a
commented-out `IS_PENDING` dance nearby suggests an abandoned refactor)
that truncates/orphans the just-written MediaStore row on this device
without throwing. **Fixed at the symptom level, not the library bug
itself:** `publishDownload()` now stats the real destination after
`copyToMediaStore` resolves and only reports success if the published size
matches the staged size; otherwise it warns and falls back to the
private-storage path rather than lying about where the file ended up.
Files downloaded on this specific device/OS still won't actually appear in
Downloads until the library bug is patched or bypassed.

**Defect 2 — the notification channel had no sound.** `ensureChannel()`
never passed a `sound` field to `notifee.createChannel()` — notifee's own
docs state the default is silent. **Fixed:** `sound: 'default'`. (Could not
be confirmed audibly on this device in the same session: Android channel
settings, including sound, are fixed at first creation and don't update
from a later `createChannel()` call with the same ID — expected platform
behavior, not a flaw in the fix.)

**Gotcha:** the app's own `[QR-DEBUG]` debug logging in `src/api/client.ts`
is high-volume enough to evict the device's logcat ring buffer within about
a minute of normal polling traffic — measurably slowed this investigation.
Still present as of the latest milestone (see `docs/14_Testing_Plan.md` §6).

---

# Milestone P9 — Android Download Reliability (Detail Screen "Download Interrupted")

**Problem:** `.pdf`/`.png`/`.zip` downloaded successfully while
`.txt`/`.docx`/`.pptx`/`.jpg`/`.mp3` showed "Completed" on the Overview
list but "Download interrupted" on the detail screen — sometimes
self-correcting only once another transfer began.

**Investigation:** Read every layer in full (backend headers, RNBU's
native `FileStorage`/MediaStore code) and found no file-extension or
MIME-type branching anywhere — corroborated by this project's own history:
P7's matrix found the *opposite* ranking on the same code area. A
deterministic per-extension rule cannot produce two contradictory rankings;
a size/timing-dependent flake can (this is the same P7 false-negative,
more exposed on larger files — most reports simply used larger sample
files for the "failing" extensions).

**Root cause:** `TransferListScreen` and the detail screen's primary
status text both correctly read server state (the backend marks
`COMPLETED` unconditionally once bytes finish; `mergeLiveTransferState`
already defers to it once terminal, per P3/P5). But a *second*, separate
block in the same detail screen read `TransferStreamManager`'s raw local
`stream.status === 'failed'` directly, bypassing that same merge rule —
so a stale local failure (from whatever caused the local promise to
reject) could render underneath an already-correct "Completed" status
indefinitely. It only ever cleared when a *different* transfer's `start()`
overwrote the singleton — exactly matching "changes after another transfer
begins."

**Fix:** The trailing error block now gates on `merged.status === 'failed'`
(the same server-aware value already driving the rest of the screen)
instead of the raw local value.

---

# Milestone P9.1 — Live Investigation: Two Fixed Defects, One Confirmed-Unfixed

**Problem:** P9's fix was accepted, but the underlying defect was still
reported live: several types "completing" per the Overview yet ending up
unavailable/unusable.

**Defect 1 — `DownloadDir` vs `LegacyDownloadDir` confusion (fixed).**
`isPublishedAt()`/`downloadedFilePath()` statted
`ReactNativeBlobUtil.fs.dirs.DownloadDir`, which resolves to the app's own
private scoped external directory (a path that doesn't even exist) —
**not** the real public folder `copyToMediaStore` actually publishes into
(`LegacyDownloadDir`, despite the name). This made even a **genuinely
successful** publish unconditionally report as unavailable, for every
file type — the actual explanation for most of the "unavailable" reports.
Fixed by statting `LegacyDownloadDir` instead, in both `blobUtil.ts` and
`downloadExistence.ts`.

**Defect 2 — real, live, non-deterministic connection loss on
multi-TCP-segment downloads (confirmed real, root cause found later — see
Milestone P10).** Live instrumentation showed on-disk sizes strictly
*below* the declared size at rejection, in multiples of ~1460 bytes
(standard TCP MSS) — genuine data loss during the network read itself, not
a false-negative-on-an-already-complete-file. Traced into
`ReactNativeBlobUtilReq.java`'s `done()`: the response-draining loop is
wrapped in `catch (Exception ignored) {}` with logging commented out — any
real `IOException` mid-read is silently discarded, which is why no prior
milestone could see the real cause; it never left the native layer.

**Defect 3 — `Intent.createChooser` dropped `FLAG_ACTIVITY_NEW_TASK`
(fixed).** Tapping "Open" on a correctly-published file failed every time
with `startActivity() from outside of an Activity context requires
FLAG_ACTIVITY_NEW_TASK`. `actionViewIntent` sets the flag on the original
`Intent`, then wraps it in `Intent.createChooser(...)`, which returns a
**new** `Intent` that doesn't inherit the flag. Fixed by no longer passing
a chooser title to `actionViewIntent` (skips the `createChooser` wrapping
entirely — Android still shows its own disambiguation picker when more
than one app matches).

---

# Milestone P10 — Root Cause of P7/P8/P9/P9.1's Download Truncations

**Problem:** Defect 2 above (real, non-deterministic connection loss on
larger downloads) was still unexplained — the native exception causing it
was being silently swallowed.

**Investigation:** Traced the full native read path (OkHttp →
`ReactNativeBlobUtilFileResp` → `ProgressReportingSource.read()` → file
output stream → MediaStore) with instrumentation. Confirmed: the backend
always sent the complete file, the socket stayed healthy, and no
Java/JS/OkHttp exception was ever thrown — yet downloads stopped after
exactly one physical socket read, and whether that read happened to
contain the whole file determined success or failure (explaining why
failures tracked file *size*, not type, and why the type correlation
flipped between P7 and P9's reports).

**Root cause:** `ProgressReportingSource.read(Buffer sink, long byteCount)`
violates Okio's `Source` contract. It read bytes from OkHttp and wrote them
directly to the destination file, then returned the byte count read — but
**never copied those bytes into the `sink` buffer** Okio's own contract
requires. Okio's buffered layer therefore saw `sink` still empty after the
call returned, and treated that as end-of-stream on the very first
physical socket read. This single native bug is the actual explanation for
every "Download interrupted"/truncation symptom across Milestones P7, P8,
and P9.1's Defect 2.

**Fix:** A `patch-package` patch,
`android/patches/react-native-blob-util+0.24.10.patch`, adding the missing
`sink.write(bytes, 0, (int) read);` call immediately after the existing
output-stream write. Applied automatically after every `npm install`.
Verified on RMX3997 across `.txt`/`.pdf`/`.docx`/`.pptx`/`.jpg`/`.png`/`.mp3`/`.zip`
and synthetic files from 64 KB to 32 MB, with byte-for-byte confirmation
across multiple consecutive transfers. Full writeup:
`docs/upstream/react-native-blob-util-okio-read-contract.md`.

**Standing note:** whenever `react-native-blob-util` is upgraded, check
whether this upstream defect is fixed before removing the patch, and
re-run the full physical transfer matrix before deleting it either way.

---

# Milestone P11 — Concurrent Download Freeze Investigation (Physical Device)

**Problem:** Tapping Download on 3+ shared files in quick succession left
all but one permanently stuck in "Downloading..." at 0 bytes — no error
anywhere — until the user happened to open that specific transfer's own
detail screen, which "unstuck" it almost instantly.

**Investigation:** Live instrumentation on RMX3997 confirmed the backend
never even received the dropped transfers' `GET .../download` requests —
this was never a networking/backend/`ActiveStreamRegistry` issue.

**Root cause:** `TransferStreamManager`'s one-active-stream-at-a-time
design is correct and intentional (`docs/11_File_Transfer.md` §10). The
bug: a `start()` call arriving while another was active was **silently
dropped** with no path back to running it, rather than deferred.
`FilesScreen` calls `start()` exactly once per download and never retries
(the button disables itself once `in_progress`); the *only* other call
site, the detail screen's opportunistic effect, only runs if the user
happens to navigate there — exactly why doing so "unstuck" it.

**Fix:** A `start()` call arriving while another is active now joins an
in-memory FIFO `queue` instead of being dropped; both stream-exit paths
drain and start the next queued entry. `enqueue()` dedupes against the
active transfer and anything already queued. Verified live: 2/3/5-tap
batches all streamed and completed automatically, in order, with no gaps
in the backend log.

---

# Milestone P13 — Folder Transfer Support: Three Live-Verified Defects

**Feature summary:** whole-folder sharing/download/upload, layered on the
existing single-file pipeline with no new streaming concept — a folder
"transfer" is N ordinary single-file transfers serialized by P11's own FIFO
queue. New `shared_folders` table, `SharedFolderService`, `/folders` API
(mirrors `/files`), `UploadBatchRegistry` for upload-side name conflicts.
Full protocol/schema changes: `docs/11_File_Transfer.md` §6/§18,
`docs/13_Database_Design.md` §6a/§7a/§12.

The milestone's required live-device pass (not just the green automated
suites) found three real defects the suites had no way to reach:

**Defect 1 — non-Latin-1 filenames crashed every download, not just
folder children.** A file named `日本語ファイル.txt` triggered
`UnicodeEncodeError` inside Starlette's `Response.init_headers`, because
`app/api/v1/transfers.py` built `Content-Disposition:
attachment; filename="<raw name>"` with the real name interpolated
verbatim — HTTP header values are Latin-1 only. **Pre-existing since
Milestone 12** (affects standalone files identically; P13 is just what
finally exercised a non-ASCII name). **Fixed:** a new
`_content_disposition()` helper builds an RFC 6266-compliant header (a
Latin-1-safe ASCII fallback plus `filename*=UTF-8''...`). Not actually
load-bearing for Relay's own correctness (Android names its saved file
from the transfer's own JSON metadata, not this header) but must not crash.

**Defect 2 — `react-native-saf-x`'s `listFiles()` rejected its own
unpersisted `openDocumentTree()` grant** on this device — reproducibly.
Root cause is inside third-party native code, not further diagnosable from
JS. **Worked around:** persisting the grant (`openDocumentTree(true)`)
made the same call succeed immediately.

**Defect 3 — `react-native-blob-util`'s `wrap()` silently read zero bytes
from a `react-native-saf-x` URI** — every proposed folder upload reached
the backend with an empty body (`0 B / <size> B`), no client-side error at
all. The two libraries construct/hold SAF URIs differently and RNBU's
native reader doesn't handle `saf-x`'s shape. **Worked around:** each
picked file is materialized to local cache (via `saf-x`'s own native
`copyFile`) before `wrap()` ever sees it — not a true zero-copy stream, and
the cache copy is never explicitly deleted (an accepted trade-off, same
tolerance the backend's own upload path already has for unswept temp
files).

**Live verification highlights:** a real 7-file nested unicode-named
folder downloaded byte-for-byte correct (landing under the public
`Download/Relay/` tree via MediaStore's nested `RELATIVE_PATH` — the
single highest-risk item flagged at design time); an empty shared folder
correctly staged privately only (MediaStore cannot represent an empty
public directory — a platform limitation, not a defect); a 250-file
folder-upload batch completed in ~10.5s.

---

# Milestone P13.1 — Folder UX Polish: Duplicate Folder Names Share One Physical Directory

**Change:** Removed folder-row progress counters; added Open (opens
`Downloads/Relay/<FolderName>` in the file manager) and a
folder-specific completion notification.

**Found, documented, not fixed here (deferred to P13.2):** two shared
folders with the *same display name* but different source paths download
into **one merged physical directory** — `resolveAvailableMediaStoreName`
(P3) only ever disambiguates a *file's own basename* on conflict, never
the leading folder segment, since the backend always builds a folder
child's path as `"<folder_name>/<relative_path>"` verbatim. Confirmed live
(two `Duplicate` folders' files landed side by side in one directory) and
ruled out of this milestone's scope by its own "do not change backend
streaming" instruction.

---

# Milestone P13.2 — Folder Identity & Change Detection

**Problem:** Two defects left open by P13.1: (1) duplicate folder names
still merge on download; (2) folder content changes on the desktop
(add/remove/rename) were never detected — a row stayed "Open" even after
its shared folder changed.

**Architecture decision (Issue 1):** Added `folderIdentity.ts` — a new,
client-only, `shared_folder_id`-keyed local registry
(`relay-folder-registry.json`, via `react-native-blob-util`, the same
JSON-file pattern used throughout this app rather than adding
AsyncStorage/MMKV) resolving a free on-device root name once ("name (1)"
convention) and remembering it permanently, serialized behind a mutex.

**Architecture decision (Issue 2), first attempt superseded:** An initial
design derived "still matches what's on disk" purely from Transfer
history (avoiding any new persisted state). **Physical verification broke
it:** a file *removed* from a folder leaves its completed Transfer row in
history forever (never deleted, never superseded by anything, since
nothing re-downloads a removed file) — permanently poisoning the check, so
a folder with a removed file got stuck on "Download" even after a
successful re-download. **Final design:** the registry gained a
client-owned `reconciledChildren: Record<relative_path, file_size>` field,
written wholesale (never merged, so a removal can actually disappear from
it) at the exact moment a folder download genuinely finishes.

**Live verification:** two identically-named `test/` folders landed in
separate `test/`/`test (1)/` directories; add/remove/rename/content-change
scenarios against a live folder (via `POST /folders/{id}/refresh`) all
correctly flipped Open↔Download and recovered on re-download.

**Remaining limitations:** byte-identical-size content edits are
undetectable (no checksum — an explicitly deferred V1 feature); orphaned
local files from a rename/removal are not cleaned up (only a changed
file's old copy is actively deleted, to avoid a spurious "(1)" rename); the
registry doesn't survive a reinstall and has no entry for a folder
downloaded before this milestone (self-heals on next download).

---

# Milestone P13.3 — Folder State Machine Audit & Correctness

**Objective:** Not a symptom fix — a full-lifecycle audit prompted by four
reports (a deleted folder still showing "Open"; duplicate names still
occasionally colliding despite P13.2; a Download→Downloading→Download→Open
flicker; an unverified claim that the download queue lets two transfers
stream concurrently).

**Audit finding:** the Files screen's label was recomputed from **five**
independently-polled/cached sources on three different cadences, with no
cross-notification between them — and none of them ever asked the live
filesystem.

**Root causes and fixes, one per reported problem:**
1. **Deleted folder still "Open"** — no existence check existed for
   folders at all (unlike files). Fixed: `deriveFolderDownloadStatus`
   gained a `folderExists` parameter, verified the same way the file path
   already does.
2. **Duplicate names still occasionally collided** — a real race: naming
   was resolved and *committed to the registry* synchronously at tap time,
   well before any bytes/directory existed on disk, so two same-named
   folders downloaded within the same second could both see
   `fs.exists() === false` and claim the same name. Fixed:
   `findAvailableRootName` now also checks the in-flight registry itself
   for reservations already claimed, not just the filesystem.
3. **Flicker back to "Download"** — the reconciliation record was written
   before the local stream state flipped to `'completed'`, but nothing told
   the screen to re-read it; the fast 2s transfer poll could observe
   "all children complete" before the slower 5s folder poll caught up.
   Fixed: `FilesScreen` now subscribes directly to
   `TransferStreamManager` and refreshes reconciliation the instant a
   stream completes.
4. **Queue label wrong** — `active` was resolved via `isActive(fileId)`
   when it needed `isActive(transferId)` (`shared_file_id` and
   `transfer_id` are different id spaces that never collide, so the wrong
   one silently always returned `false`). Fixed via a new
   `latestSendTransferId()` helper; also added a fifth fix found only
   through re-testing fix #1: a completely-deleted folder root needs every
   child treated as pending again, not just the ones whose individual
   metadata disagrees.

**Verification:** all four scenarios reproduced live pre-fix and confirmed
fixed post-fix, including a full backend+desktop+app restart cycle
(registry survives, since it's private app storage).

---

# Milestone P13.3 Correction — Single-Transfer "Queued" Regression

**Problem:** P13.3's own queue-label fix (`active = isActive(transferId)`)
shipped a regression: downloading a single file or folder — nothing else
queued — now briefly flashed "Queued" before settling into
"Downloading...".

**Root cause:** The backend flips `Transfer.status` to `in_progress` the
instant a download is *proposed*, well before local streaming starts, and
`TransferStreamManager.start()` itself doesn't commit `state.status =
'streaming'` until *after* an unavoidable `await
PermissionsAndroid.request(...)` gap. P13.3's fix treated "not yet
observed as `isActive`" as equivalent to "genuinely waiting in the FIFO
queue" — but a lone, never-queued transfer looks identical to a queued one
for that entire startup window.

**Fix:** Added a real `isQueued(transferId)` reading FIFO membership
directly (`queue.some(...)`) — no async gap, since `enqueue()` is only ever
reached synchronously from `start()`'s own guard check. Labels now key off
`queued`, not `active`; anything `in_progress` that isn't genuinely queued
defaults to "Downloading...". Verified live across 5 scenarios (single
file, single folder, 2/3 concurrent files, mixed file+folder) with
frame-by-frame screenshot capture confirming zero false "Queued" states and
correct FIFO ordering throughout.

---

# Milestone P14.1 — Long-Press Context Menu: Core UX

**Change:** Added `FileActionMenu.tsx`, a small bottom-sheet built on React
Native's own `Modal` (no new dependency) offering Open/Details on a Files
row's long-press. Details uses the built-in `Alert.alert`. Extracted
`computeFileRowState`/`computeFolderRowState` so the row and the menu share
one status derivation instead of duplicating it.

**Verified live:** menu content recomputes correctly if the underlying
transfer/existence state changes while the menu is still open (e.g. a
download completing, or its file being externally deleted); Open is
correctly omitted for a not-locally-available item; a long-press directly
on the existing Open button still triggers the button, not the menu
(nested `Pressable`s isolate correctly with no manual propagation
handling).

---

# Milestone P14.2 — Device Discovery & QR Pairing UX

**Change:** A tapped row in the Discovery list (previously a dead `View`)
now navigates straight into the existing QR scanner, optionally carrying
the tapped device so a best-effort `(desktop_ip, port)` match check can run
against the scanned QR before submitting (the pairing protocol carries no
stronger device-identity field — a heuristic, not a guarantee). Added an
instructional overlay, an explicit Close button, and a three-way camera
permission state (`granted`/`denied`/`blocked`, the last offering "Open
Settings"). Removed leftover `[QR-DEBUG]` logging from the specific
functions this milestone was already rewriting (the same logging in
`api/client.ts` was left — see the open-items list in the Testing Plan).

**Note:** "Already paired" row states were investigated and deliberately
**not** built — `RootNavigator` swaps the entire app to `MainTabs` the
instant pairing succeeds, so Discovery structurally never renders while
paired; there is nothing for it to distinguish.

---

# Milestone P14.3 — Android Settings & Download Location

**Feature:** A Settings screen to switch the download destination between
the default `Downloads/Relay` (MediaStore) and a user-picked SAF folder.
Persisted via the same `react-native-blob-util` JSON-file pattern as
`folderIdentity.ts` (`DownloadLocationManager.ts` mirrors
`SessionManager.ts`'s in-memory-cache + boot-time-restore shape).
`downloadExistence.ts` became the pipeline's one mode-aware abstraction
boundary; default-mode behavior is byte-for-byte unchanged (every
pre-existing test in that area passed unmodified).

**Defect found and fixed during live verification — "Invalid root Uri"
opening a custom-location folder.** For a nested child document,
`react-native-saf-x`'s `stat()` deliberately returns a **tree**-shaped URI
rather than one scoped to the originally-granted tree; that shape works
fine for the library's own re-resolution but Android's DocumentsUI only
accepts a tree URI as a browsable root if it's the *exact* one it
originally granted. Fixed: build the correct
`content://<authority>/tree/<treeDocId>/document/<childDocId>` shape
directly from the granted tree's own document id.

**Gotcha confirmed live:** an SAF permission grant survives the granted
folder's own deletion (`hasPermission()` is a pure OS-level permission
record, independent of whether the target still exists) — so a
grant-revocation warning can't be triggered this way. A download attempt
against a deleted custom destination does fail gracefully
(`SafX.copyFile` rejects with `ENOENT`, caught by the existing best-effort
`catch`, row stays re-downloadable).

**Pre-existing defect noticed, not fixed (out of scope):** existence
checks are keyed by a shared file's raw `file_name`, not by whichever
disambiguated on-device name it actually got — two different files sharing
a basename can show each other's status. (This is the same defect P16
later fixed for standalone files.)

---

# Milestone P14.4 — Transfer History Reset

**Feature:** "Clear History" on the Transfers list. **Architecture
decision: Android-local filter only, never a backend delete** —
`TransferRepository` has no delete method by design, `transfers` rows are
explicitly permanent per `docs/13_Database_Design.md` §10, and the
desktop's own `GET /transfers` is unscoped across every device, so a
backend delete triggered from Android would silently erase state other
paired parties still rely on. A transfer is "historical" once its status
leaves `in_progress` (covers both a transfer streaming right now and one
merely sitting in the local FIFO queue, since queueing has no backend
status of its own). Persisted as a small `{ clearedAt }` JSON marker, same
pattern as `folderIdentity.ts`.

**Defect found and fixed during live verification.** Backend timestamps
are naive (no UTC designator) but represent UTC; JavaScript's `Date`
constructor parses a timezone-less ISO string as **local** time. On this
device (UTC+5:30), a transfer that finished a full minute *after* a reset
was incorrectly hidden, since its parsed time landed 5.5 hours before the
true UTC cutoff. Fixed with a `parseTimestamp()` helper that forces UTC
interpretation regardless of device timezone.

**Two pre-existing, unrelated defects noticed during verification, not
fixed (out of scope):** (1) a SEND transfer whose source file is deleted
before its first download byte is requested gets stuck `in_progress`
forever, since the validation failure happens before any code path that
could finalize it — fixed later in Milestone P15. (2) `shared_folder_id`
reuse (only reachable via a reset/repopulated database) can collide with
`folderIdentity.ts`'s numeric-id-keyed registry — proposed as Milestone
P17, still open.

---

# Milestone P15 — Backend: Zombie `in_progress` Transfer on a Disappearing Source File

**Problem:** Flagged by P14.4: a SEND transfer whose source file is
missing, unshared, or has changed size raises inside
`resolve_download_source` — but that runs as a plain method call in the
route handler, *before* the streaming response (and therefore `_finalize`)
is ever constructed, so nothing on that path ever moves the `Transfer` row
out of `IN_PROGRESS`.

**Fix:** `resolve_download_source` now wraps its existing validation in
`try`/`except (ValidationError, NotFoundError)`: on any of its four raise
conditions it calls the same `_finalize(transfer.id, FAILED, 0,
failure_reason=str(exc))` every other terminal transition in this file
already uses, then re-raises unchanged — the client-visible 400/404
response is byte-for-byte identical to before; only the `Transfer` row's
fate changes. `_finalize`'s existing already-terminal-wins guard means a
transfer finalized by a race just before this runs is left untouched.

**Why this fix over the alternative:** P14.4 floated running
`reconcile_interrupted_transfers` periodically instead of only at startup
— rejected as new scheduling infrastructure this codebase doesn't have
anywhere else, for a defect class the chosen fix (fail fast, at the
source) closes completely rather than just bounding.

**Verified live:** restarting the dev backend first retroactively cleared
a stuck row left over from the P14.4 session (via the existing startup
sweep); a fresh repro against the running fixed backend showed the Files
screen immediately reading "The source file is no longer available." with
a Retry button, the Transfers screen showing "Failed," and — closing the
exact gap P14.4 flagged — "Clear History" now able to reach this class of
row for the first time.

---

# Milestone P16 — Android: Same-Basename Existence/Identity Collision

**Problem:** Milestone P3 fixed the *write* side of two same-named shared
files colliding (`resolveAvailableMediaStoreName` gives them distinct
on-device paths). Nothing fixed the *read* side: every existence check and
the Open action still asked about the shared, undisambiguated
`file.file_name`, so two different shared files with the same display name
shared one on-device identity in the UI.

**Live reproduction confirmed this is worse than a stale label:** tapping
Open on one file's row opened the **other** file's physical content —
a genuine data-identity mix-up, not just a status glitch. Deleting one
file's physical copy also flipped *both* rows back to "Download."
(Confirmed folders do **not** share this defect — P13.2 already gave them
a `shared_folder_id`-keyed identity.)

**Identity decision:** key on `shared_file_id` (already stable, unique,
and already threaded through every relevant API type) — not `transfer_id`
(a file accumulates many transfers over its life; the identity that must
stay stable is the file) and not a smarter display-name-based lookup
(still a display-name-shaped identity, just obscured).

**Fix:** Mirrored `folderIdentity.ts`'s already-proven shape exactly: a
new, separate (not merged — a file has no reconciliation concept), disk-
persisted `fileIdentity.ts` registry (`relay-file-registry.json`),
resolved once before a standalone file's bytes start moving
(`TransferStreamManager`'s `resolveDownloadRelativePath`) and reused by
every later reference — the existence check, `computeFileRowState`,
`handleOpen`, and the long-press menu's file-state derivation all now
resolve through it instead of the raw `file_name`.

**This is now a documented standing rule** — see `CLAUDE.md`'s "Android
Download Identity (P16)" note: any new download-path code (existence
checks, Open, notifications, reconciliation) must resolve identity through
the appropriate id-keyed registry, never through `file_name`/`folder_name`
directly.

**Remaining limitation:** a `Transfer` that completed *before* this fix
shipped has no registry entry until it's re-downloaded — until then it
still falls back to the raw name and can transiently collide with a newly
downloaded same-named file. A fresh download of either file immediately
and permanently fixes that file's identity going forward; no retroactive
backfill was attempted (fundamentally ambiguous after the fact).

**Also re-confirmed live, not fixed (Milestone P17 candidate):** the
`shared_folder_id` reuse defect from P14.4 recurred during this
milestone's own test setup (stale local registry entries from an earlier
session collided with freshly-assigned ids) — worked around by clearing
local test state, not fixed.

---

# Milestone P17 — `shared_folder_id` Reuse / Folder Identity Collision

**Problem (from P14.4, re-confirmed in P16):** `folderIdentity.ts`'s
on-device registry (`relay-folder-registry.json`) is keyed by the bare
`shared_folder_id`. `shared_folders.id` is a plain SQLite
`INTEGER PRIMARY KEY` with no `AUTOINCREMENT` keyword (confirmed against
`backend/relay.db`'s own schema — no `sqlite_sequence` table exists), so
once every row is deleted the next `INSERT` restarts numbering from 1: the
id is unique only while its row exists, not forever. A folder deleted and
later replaced by an unrelated one can therefore be handed the exact same
`shared_folder_id` its predecessor had.

**Baseline / lifecycle established (Phase 1, before any code change):**
inspected `backend/app/models/shared_folder.py`,
`shared_folder_service.py`, and `shared_folder_repository.py`. Deletion is
a hard `db.delete()` (`unshare_folder`), never a soft-delete or tombstone.
Re-sharing an *already-shared, still-existing* path is an update-in-place
(`share_folder`'s `get_by_path` branch) — same row, same id, and
critically `shared_at` (set once at creation, `utc_now()`) is left
untouched by that path. Only a genuinely new row (a fresh path, or the
same path re-shared *after* being unshared) gets a fresh `shared_at`. This
makes `(id, shared_at)` a reliable proxy for "this exact row's lifetime,"
without any backend change — `AvailableFolderResponse.shared_at` was
already returned to Android.

**Exact physical reproduction (RMX3997, USB + LAN, real backend, real
APK):**
1. Shared `test/A.txt` as Folder A (`POST /folders``id=1`,
   `shared_at=2026-08-09T07:50:08`). Downloaded it on-device. Registry:
   `{"1":{"localRoot":"test","reconciledChildren":{"A.txt":17}}}`.
   Filesystem: `Download/Relay/test/A.txt`.
2. Unshared Folder A (`DELETE /folders/1`) — `shared_folders` now empty.
3. Shared a **different** folder, same display name `test`, different
   content (`test_b/test/B.txt`, 71 bytes) — backend returned
   `id=1` again (confirmed: SQLite recycled the rowid),
   `shared_at=2026-08-09T08:20:09` (different from Folder A's).
4. Row correctly still read "Download" (not a premature "Open") — the
   per-child `deriveDownloadStatus` gate (keyed by the *file's own*
   `shared_file_id`, a different id space) happened to mask the collision
   here. Tapped Download anyway.
5. **Confirmed defect:** registry became
   `{"1":{"localRoot":"test","reconciledChildren":{"B.txt":71}}}` — B.txt
   streamed into `Download/Relay/test/`, the *same physical directory*
   still holding Folder A's leftover `A.txt`. `adb shell ls` confirmed
   both files coexisting in one directory; tapping "Open" on Folder B's
   row opened a DocumentsUI listing containing both `A.txt` and `B.txt`.
   Physical isolation (a hard P17 invariant) was violated — not merely a
   stale label.

**Architecture decision — Android-side fix (Option B), not a backend
change.** `docs/13_Database_Design.md` already establishes the relevant
precedent for this codebase: `devices.device_identifier` (a
client-generated UUID) is the *stable external identity*, while "the
primary key stays a plain internal integer." `shared_folders.id` was never
meant to be durable external identity either — forcing it to be (an
`AUTOINCREMENT` keyword, a UUID column, a global sequence) would be a
schema change disproportionate to the actual defect (CLAUDE.md Rules 1–3),
and the backend already exposes everything needed to close the gap:
`shared_at`.

**Fix (`android/src/files/folderIdentity.ts`):**
* `RegistryEntry` gains an optional `sharedAt` field.
* `resolveLocalFolderRoot(id, rawName, sharedAt?)` — `sharedAt` is new and
  optional. When provided (both `FilesScreen.tsx` call sites always have
  the live `AvailableFolderResponse`) and an existing entry's own recorded
  `sharedAt` disagrees, the id has been reused for a different logical
  folder: the stale entry (`localRoot` **and** `reconciledChildren`) is
  dropped before resolving a fresh root, so the old id's former localRoot
  no longer counts as "reserved" — only a genuine on-device collision
  (the old physical directory still present) still forces a `(1)` suffix.
  A legacy entry with no recorded `sharedAt` (pre-P17 data, or written by
  a caller that omitted it) is trusted, not invalidated, and backfilled.
* `readAllLocalRoots`/`readAllReconciledChildren` now take the currently
  shared `LiveFolder[]` (`{id, shared_at}`) and omit any entry whose
  recorded `sharedAt` disagrees with the live folder now holding that id.
  This closes the *read* side of the gap — a reused id must never read
  back as "already downloaded" on the very first render, before the user
  taps anything. `useFolderReconciliation.ts` (already handed the live
  `folders` list) supplies this for free.
* `TransferStreamManager.ts`'s two call sites deliberately still omit
  `sharedAt` (a `Transfer` response carries no such field) — safe because
  they only ever run after `FilesScreen`'s own call already
  resolved/invalidated this exact id moments earlier in the same
  user-initiated download flow; unchanged, pre-P17 read-through behavior.
* No backend, database, or transfer-protocol change.

**Physical re-verification (RMX3997, exact pre-fix sequence repeated on a
cleared registry + cleared backend tables):**

| Test | Result |
|---|---|
| Folder A shared, downloaded | Registry gained `sharedAt`; `Download/Relay/test/A.txt` |
| Folder A unshared, Folder B shared (id reused, same display name `test`) | Row read "Download", not "Open" |
| Folder B downloaded | Registry: `{"1":{"localRoot":"test (1)",sharedAt:B's,reconciledChildren:{"B.txt":71}}}` — fresh root, old entry dropped |
| Physical isolation | `test/` still holds only `A.txt`; `test (1)/` holds only `B.txt` — verified via `adb shell cat` on both |
| Open | Opened `test (1)/`, listing only `B.txt` (DocumentsUI, confirmed via screenshot) |
| App restart (force-stop + relaunch) | Row still "Open", registry entry unchanged |
| External deletion of `test (1)/` | Row correctly reverted to "Download" |
| Re-download | Returned to "Open", same `test (1)` root reused, no drift to `(2)` |
| Standalone file regression (P16) | `A.txt` shared/downloaded independently, landed correctly, unaffected |
| Clear History (P14.4) | Not re-exercised via UI this session (navigation issue, unrelated to this fix); verified by code inspection — `historyReset.ts` never imports `folderIdentity.ts` — and its own dedicated test suite (`historyReset.test.ts`) still passes unmodified |

**Not physically re-spot-checked this session (relies on existing/new
automated coverage only):** duplicate-name suffixing beyond `(1)` (covered
by `folderIdentity.test.ts`'s existing `(2)` test, unmodified), the P14.3
custom SAF download location (covered by its existing describe block,
unmodified, still passing), nested folder content, and the folder-complete
notification's tap target. None of these paths were touched by the fix —
`findAvailableRootName`, `DownloadLocationManager`, and
`downloadNotification.ts` are all unmodified.

**Automated tests:** `folderIdentity.test.ts` gained a `shared_folder_id
reuse (P17)` describe block (mismatched/matching/legacy `sharedAt`,
`TransferStreamManager`'s omitted-`sharedAt` path) plus new cases for
`readAllReconciledChildren`/`readAllLocalRoots`'s live-folder filtering.
`useFolderReconciliation.test.tsx` updated to drive the hook with real
`AvailableFolderResponse` objects (`{id, shared_at}`) instead of an opaque
poll key, plus a new pin that the live set is actually passed through.
`npx jest` (320/320), `npx tsc --noEmit`, `npx eslint src __tests__` (0
errors, 2 pre-existing unrelated warnings in `TransferStreamManager.ts`)
all clean. No backend files changed — `pytest`/`ruff` not re-run.

**Limitation, documented rather than solved:** a registry entry written
*before* this fix shipped has no recorded `sharedAt` and is trusted at
face value the first time it's read after the update (there is nothing to
compare it against) — the same class of limitation P16's own entry
documents for its pre-fix `Transfer` rows. If that legacy entry already
described a folder whose id was reused pre-fix, it is "blessed" as correct
going forward rather than retroactively detected. Only affects installs
that already hit this exact collision before updating; every id-reuse from
this point forward is caught.

---

# Milestone P18 — Stabilization Baseline Audit

**Purpose:** not a bug hunt. A deliberate checkpoint after P1–P17's feature
work and hardening, to decide whether Relay is ready to leave stabilization
and enter a UI/UX finishing phase, or whether a genuine blocker remains.

**Automated suites (all green):** backend `pytest -q` — 340 passed, 2
skipped; `ruff check .` — clean. Android `npx jest` — 38 suites / 320
tests passed; `npx tsc --noEmit` — clean; `npx eslint .` — 0 errors, 2
pre-existing `no-void` warnings in `TransferStreamManager.ts` (unchanged
from P17). Desktop has no automated suite by design (plain HTML/CSS/JS,
per M14) — validated by launching it directly (see below).

**Architecture/hygiene sweep** (backend, android, desktop — dead code,
duplicated logic, debug instrumentation, stale docs): layering is
consistently respected, `backend/README.md` matches the filesystem
line-for-line, no TODO/FIXME/HACK markers, no committed secrets, no stray
`print()`/debug prints in the backend. Two real findings:

* **`android/src/api/client.ts`'s `[QR-DEBUG]` logging** (first flagged
  P8.1, still present) sits in the shared HTTP request wrapper used by
  *every* API call and logs full request bodies and parsed response
  envelopes — including pairing responses, which carry the device secret
  and session token. Never reachable by a remote party (it only ever
  writes to this device's own `logcat`), but it is genuine leftover
  diagnostic instrumentation in a shared production code path. Left
  in place this milestone (not a blocker — see rule below) but flagged as
  the top technical-debt item for the next cleanup pass.
* `backend/app/core/config.py`'s `DEBUG: bool = True` setting is read
  nowhere in `backend/app` — dead config. `android/src/components/
  PlaceholderScreen.tsx` is unused scaffolding from an early milestone,
  no longer imported anywhere. Both cosmetic, both safe to delete
  whenever someone is next in that area.

**The P17-analog question (`fileIdentity.ts`):** investigated directly.
`shared_files.id` is the same kind of reusable, non-`AUTOINCREMENT` SQLite
primary key as `shared_folders.id`, and `shared_files.shared_at` (set once
at share time, already returned to Android in `AvailableFileResponse`) is
sitting right there as the same independent signal P17 used to fix this
for folders — but `fileIdentity.ts` never reads it: `resolveLocalFileName`
takes no `sharedAt` parameter, and `readAllLocalFileNames` has no
live-filtering equivalent to `folderIdentity.ts`'s
`readAllReconciledChildren`/`readAllLocalRoots`. Conclusion: **real,
reproducible via the identical recipe P17 already proved for folders
(unshare all standalone files, share a new one, SQLite recycles the id),
not a mere theoretical limitation** — but not a blocker either: it only
manifests after a specific unshare-to-empty-then-reshare sequence, not
during normal single-item use, and P17 already built the exact pattern
this needs. Documented here as the leading technical-debt item; not fixed
this milestone per the rule below.

**Physical-device smoke test (RMX3997, real hotspot network, real desktop
app):** pairing survived an app restart with no re-pairing needed
(session token + device row both persisted correctly); shared a fresh
file and a fresh nested folder from the desktop via its own backend API
(the same loopback calls the Electron UI itself makes) and both appeared
on Android within one screen refresh; downloaded both, "Open" state was
correct, and the completion notification fired and grouped correctly for
both, with tap-to-open correctly deep-linking into the app and offering
the system "Open with" chooser; externally deleted the downloaded
standalone file via `adb shell rm` and confirmed the row correctly
reverted to "Download" on next view (P16's fix, live); re-shared a
second, distinct folder with the same display name (`folderX`) as an
already-downloaded one and confirmed both rows tracked independent
Open/Download state with no bleed, and the second download landed
correctly disambiguated on disk as `folderX (1)` (P13.1/P13.2/P17's fix,
live); performed a real Android→desktop upload and confirmed the file
landed on disk in the desktop's configured download directory; exercised
Clear History and confirmed it cleared the list without touching either
device's already-downloaded files. Desktop GUI click-through (as opposed
to API-level verification) was not completed: this machine's window focus
did not reliably stay on the Electron window during scripted mouse
clicks, and one blind click landed on an unrelated foreground window
instead — rather than keep clicking blindly, verification switched to
calling the backend directly (functionally identical to what the desktop
UI's own JS client does) plus a static screenshot confirming the desktop
app's Devices/Pairing/Shared Files/Transfers/Settings tabs render with
correct live state (the already-paired device, in this case). Fresh QR
pairing from an unpaired state was not re-exercised live this session
(existing pairing was reused to test restart-persistence instead); no
finding depends on it, and it was heavily verified in P14.2 with no
pairing code changed since.

**Rule applied this milestone:** per the explicit P18 scope, an issue is
only fixed here if it is a genuine blocker to normal correctness,
reliability, or data integrity. Neither the `fileIdentity.ts` gap nor the
`[QR-DEBUG]` logging blocks normal single-item use, so both are recorded
as backlog items rather than fixed. No application code was changed this
milestone.

**Conclusion:** no blocker found. Relay is ready to move from
stabilization into product finishing/UI-UX refinement. `docs/
14_Testing_Plan.md` and `docs/11_File_Transfer.md` §12 were updated
alongside this entry — both had fallen out of sync with what P17 and the
duplicate-file-name handling actually shipped.

---

# Milestone P19 — Desktop Foundation & Navigation

**Scope:** `New_Issues.txt` §1.1–1.5 only — overall visual foundation,
empty states, first-launch tab behavior, the Devices page, and navigation.
Explicitly not touched: pairing/QR dialog redesign (§1.6), app icon
(§1.7), menu bar (§1.8), Clear History (§2), Settings field changes (§3),
file-type/metadata wording (§4/§5), upload flow (§6/§7), received-files-in-
Shared-Files (§8), delete action (§9) — all deferred to later milestones
per the written scope boundary.

**Baseline, inspected live before any change:** launched the real Electron
app (see Tooling note below) and screenshotted every reachable state.
Confirmed the issue descriptions matched reality: nav was five bordered/
filled buttons in a row; every view was a bare `<h2>` + a paragraph with
the rest of a 1100×720 window left blank; the Devices empty state was
exactly the two-line placeholder text quoted in the issue; a paired device
rendered as one plain table row with no visual weight; the app always
opened on Devices regardless of pairing state.

**Change:** Added two small shared primitives to `dom.js`
(`pageHeader()`, `emptyState()`) and used them from all five views instead
of each hand-rolling its own heading/placeholder markup. Reworked
`app.css` with a small CSS-variable token set (spacing/color/radius) and
consistent card/table/button/badge styling. Nav is now open text with a
color + bottom-underline indicator for hover/active instead of bordered
buttons — no markup change, CSS only. `renderer.js` now calls `GET
/devices` before choosing the startup tab: 0 paired devices → Pairing, ≥1
→ Devices (falls back to the old default of Devices on any lookup
failure). Manual tab switching is untouched — it's the same `showView`
used by both the automatic call and the nav click handlers. Devices got a
real empty state (heading, explanation, a "Go to Pairing" button that
clicks the real nav item — no invented navigation path) and a card per
paired device (name, platform badge, a "Paired" status badge, paired/last-
seen dates, Rename/Remove).

**Deliberate design decision — no fabricated "online/offline" status.**
§1.3 asks the Devices page to show "whether it is currently connected/
available." The backend has no live connection tracking (confirmed by
reading `app/schemas/device.py` — `DeviceResponse` has only
`last_seen_at`, updated solely when that device authenticates against
`/files` or `/transfers`, per `AuthService`). Rather than invent a fake
live indicator the app can't actually back up, the card shows the real
`last_seen_at` timestamp and a "Paired" badge (true or the row wouldn't
exist) — honest about what Relay actually knows.

**Defect found and fixed during live (screenshot) verification:** the
first post-change screenshot showed the active nav item's underline
rendered as a short rounded arc instead of a straight line. Root cause:
the generic `button { border-radius: var(--radius-sm); }` rule still
applied to nav buttons (only `background`/`border`/`padding` were
overridden for `#nav button`), so the element's own corner radius bent the
`border-bottom` indicator at both ends. Fixed with an explicit
`border-radius: 0` on `#nav button`. Would not have been caught without
an actual screenshot — the CSS looked correct on inspection.

**Verification performed:**
- Automated: no desktop lint/test suite exists (same finding as P18,
  by design — plain HTML/CSS/JS, per M14). Ran `node --check` against
  every modified `.js` file (syntax only).
- Live functional: launched the real Electron app twice from a cold
  process start — once with a paired device (opened on Devices), once
  with none (opened on Pairing) — confirming the startup-routing decision
  reflects actual app restarts, not just an in-page reload. Manually
  clicked Devices while unpaired and confirmed the empty state still
  renders correctly (automatic navigation doesn't block manual nav).
  Clicked through every tab (Devices → Pairing → Shared Files →
  Transfers → Settings) with a `window.onerror`/`unhandledrejection`
  listener attached — zero errors. Screenshotted every required state
  (Devices empty/paired, Pairing idle/QR/review/decided, Shared Files
  empty/populated, Transfers populated, Settings, nav active state, and a
  real-mouse-move hover state) and compared each against its baseline
  screenshot.
- The full pairing handshake (start → Android submits → desktop
  approves) was exercised for real against the loopback backend API —
  the same endpoints the Android app and the desktop UI itself call —
  since no physical/emulated Android device was available in this
  environment. Test devices (`device_identifier`
  `test-android-device-00{1,2}`) and a test shared file/folder used only
  to populate the Shared Files screenshot were removed afterward; the dev
  `relay.db` is unchanged from before this milestone.

**Tooling note:** no project skill existed for driving the Electron app.
Since this is a native Windows environment with a real display (not a
headless container), the app was driven directly rather than under
`xvfb` — `playwright-core`'s `_electron` launcher against
`desktop/node_modules/electron/dist/electron.exe`, controlled through a
disposable REPL script (`scratchpad/driver.mjs`, not committed to the
repo) fed commands over a named pipe. Recommend `/run-skill-generator` if
Desktop UI work becomes frequent enough to justify a committed driver.

**Limitations:** `last_seen_at` shows "-" for a device that has never
made an authenticated request since pairing (accurate, not a bug — the
Android app in this session was simulated via direct API calls, which
don't include the authenticated calls that update it). The QR/pairing
dialog visual redesign, app icon, and menu bar (§1.6-1.8) remain
unaddressed by design — next in the UI/UX finishing sequence per
`New_Issues.txt`.

---

# Cross-Cutting Lessons

A few gotchas worth remembering independent of any single milestone above:

- **Any new download-path code must resolve on-device identity through
  the relevant id-keyed registry** (`fileIdentity.ts` for standalone
  files, `folderIdentity.ts` for folders) — never through
  `file_name`/`folder_name` alone. Established by P3/P13.2/P16 the hard
  way.
- **A backend integer primary key is not durable external identity** — a
  plain SQLite `INTEGER PRIMARY KEY` (no `AUTOINCREMENT`) is reused once
  its table empties, so any id-keyed local state that must survive across
  a row's deletion-and-replacement needs an independent signal alongside
  the id (P17 uses `shared_at`, the same role `devices.device_identifier`
  already plays for pairing per `docs/13_Database_Design.md`).
- **`TestClient`'s in-process ASGI transport cannot simulate a real
  dropped TCP connection** — anything about client-disconnect handling
  needs a real `uvicorn` process and a raw socket (see P8).
- **Loopback does not reliably exercise real network backpressure** — a
  stalled `send()` may never occur on loopback even against a dead peer.
  Test timeout/backpressure logic over a real Wi-Fi link, not localhost.
- **This project's one physical test device is OEM-locked down**
  (ColorOS/RealmeUI blocks `pm clear`/`pm revoke` even from the `shell`
  UID) — use `DELETE /devices/{id}` against the backend to force an
  unpaired state instead of trying to clear app data via ADB.
- **The desktop's own unauthenticated routes are loopback-trusted
  regardless of bearer token** — a verification script must call them from
  actual loopback for desktop-perspective requests and from the LAN IP for
  Android-perspective ones, or it will silently test the wrong code path.
- **Backend timestamps are naive (no UTC designator) but represent UTC.**
  Any code that parses one with `new Date(...)` on Android must force UTC
  interpretation (append `Z` if missing) or it will silently misbehave by
  the device's own UTC offset. This bit both the Electron desktop (T3) and
  Android (P14.4) independently.
- **A patched third-party native dependency is tracked via
  `patch-package`** (`android/patches/`) — check `docs/upstream/` for the
  full writeup before assuming a library behaves per its own docs; the
  Okio `Source` contract violation (P10) is the current example.
