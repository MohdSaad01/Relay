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
Full protocol/schema changes: `docs/11_File_Transfer.md` §6,
`docs/13_Database_Design.md` §6a/§7/§12.

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

# Milestone P20 — Desktop Pairing & QR UX

**Scope:** `New_Issues.txt` §1.6 (pairing/QR windows and dialogs) and, since
this milestone owns the Pairing tab specifically, the same page's §1.4
blandness — idle/waiting/review/decided states. No change to the pairing
protocol, QR payload, `PairingManager`/`PairingService`, or the Android
scanner. Explicitly not touched: every other tab, the app icon (§1.7), the
menu bar (§1.8), and anything outside `desktop/src/renderer/views/pairing.js`
and its shared CSS/JS dependencies.

**Baseline, inspected live before any change** (real Electron app, driven
via a disposable `playwright-core` script — see Tooling note): the idle,
waiting/QR, review, and decided states were all a single small `.pairing-card`
(P19's existing pattern) centered in an otherwise blank ~1000px-wide page.
The waiting state's "Waiting for a device to scan..." was a static badge
pill with no visual indication of being live; there was no way to back out
of a pairing attempt short of navigating to another tab (which silently
abandoned the poll without resetting the UI if the user came back); the
review card ran the device name as plain inline text with no visual
weight; the decided/success and decided/rejected states used byte-identical
styling with no color or iconography to distinguish a success from a
rejection.

**Change:**
- Added `iconBadge({ icon, variant })` to `dom.js` (a small tinted-circle
  SVG badge, variants mirroring the existing primary/success/danger/neutral
  badge language) and `icons.js` (hand-written inline SVGs: QR, device,
  check, x, clock — no icon-font/library dependency, per the finalized
  plain HTML/CSS/JS stack). Every pairing-card state now leads with one of
  these instead of a bare heading.
- Rewrote every render function in `pairing.js` to use the icon badge and
  gave the waiting state a two-column `.pairing-flow` layout: the QR card
  next to a "How to pair" numbered instruction card, using the page's
  width instead of one small card floating in blank space. Stacks to a
  single column under 720px (`app.css`).
- Waiting state's status pill is now a live-looking pulsing dot
  (`.pairing-status-dot`, CSS `@keyframes`) plus text, and gained an
  explicit **Cancel** action (`.text-button`, a new borderless button
  variant) that stops the poll and returns to idle. This is client-side
  only — no new backend endpoint. The backend has no pairing-attempt
  cancel/abandon call (confirmed by reading `pairing_service.py`/
  `pairing.py`); the old, unchanged attempt is simply superseded the next
  time `POST /pairing/start` runs, same as it already was when a user
  navigated away mid-wait.
- Review card now shows the device name as a real heading with a device
  icon above it and the platform in the same `.badge` component
  `devices.js` already uses (consistency, not a new pattern).
- Decided state is now outcome-aware: `renderDecided` takes an
  `{ icon, variant, title, message }` object instead of a bare message
  string — a green check badge for a successful pair, a red x badge for a
  rejection, a neutral clock badge for an expired attempt.

**Verification performed:**
- `node --check` (as ES modules) on `pairing.js`, `dom.js`, `icons.js` —
  clean.
- Real Electron app, driven via `playwright-core@1.62.1` installed with
  `npm install --no-save` (not committed — `desktop/package.json`/
  `package-lock.json` are unchanged; confirmed via `git status` before and
  after) into a `desktop/node_modules/.driver-scratch/` scratch script
  (also not committed — `node_modules/` is gitignored), following P19's
  same tooling pattern. Exercised and screenshotted every state:
  idle → waiting/QR (two-column layout, pulsing status, Cancel) →
  Cancel → back to idle → waiting → a simulated `POST /pairing/request`
  (device `Pixel Test Device`, backend-API simulation — no physical
  scan involved in this step, see below) → review → Approve → success
  (green check) state; a separate run through to Reject → rejected (red x)
  state. Console/`pageerror` listeners attached throughout the whole
  session — zero uncaught exceptions; the only console-level entries were
  the pre-existing, expected 404s from polling `/pairing/pending` before a
  request lands (unchanged from before this milestone).
- Regression: clicked through Devices (paired-device card, still correct
  after approving the test device and then removing it), Shared Files,
  Transfers (a real populated history table, unaffected), and Settings —
  all rendered exactly as before this milestone's CSS/JS changes.
- Test artifacts cleaned up: the simulated `Pixel Test Device` (id 2) was
  deleted via `DELETE /devices/2` after the approve-flow screenshot;
  `backend/relay.db`'s `devices` table was confirmed to hold only the one
  real paired device (`RMX3997`) both before and after this milestone.

**Physical-device verification: attempted, not completed — documented
honestly rather than simulated.** A real Android test device (RMX3997,
same one used throughout this project's history) was connected via ADB at
the start of this session (`adb devices` listed it) and had the Relay app
already paired. It disconnected from ADB partway through the session
(`adb devices` returned empty; `adb kill-server`/`adb start-server` did not
bring it back) before a fresh QR-scan pairing could be attempted, and was
not available again before this milestone finished. Separately: even with
the device connected, genuinely exercising the QR **scanner** (as opposed
to the API calls a scan triggers) requires physically aiming the phone's
camera at the desktop screen — the Android pairing flow has no
gallery/image-based scan fallback (confirmed: no `ImagePicker`/gallery
code path in `android/src/pairing` or `android/src/screens`) — which is
outside what this session could perform unattended. Deliberately did
**not** unpair the real already-paired device to force a fresh scan
attempt, since doing so without being able to complete the optical scan
step afterward would have left the project's one physical test device
broken with no way for this session to fix it. What *was* verified: the
review/approve/reject/success flow end-to-end against the real,
unmodified backend via a simulated device request (the same endpoints a
real scan submits to — `POST /pairing/request` → poll → `POST
/pairing/approve`/`reject`) — this is backend-API simulation, not physical
verification, and is labeled as such per this milestone's own instructions
not to conflate the two. The real paired device's row and session were
otherwise left completely untouched by this milestone.

**Tooling note:** reused P19's approach (no committed Electron driver
exists yet) — `playwright-core`'s `_electron` launcher against
`desktop/node_modules/electron/dist/electron.exe`, this time controlled
through a small named-pipe server (`driver.mjs`) plus a one-shot client
(`send.mjs`) instead of a REPL, so individual commands could be issued one
at a time across tool calls. Neither script is committed.

**Limitations:** the Cancel button stops the desktop from polling and
resets its own UI, but (as already documented above) the backend's pairing
attempt itself has no cancel primitive and simply sits until its normal
expiry — unchanged pre-existing behavior, not a new gap introduced here.
No fresh physical QR scan was performed this milestone (see above); the
next Desktop UI/UX milestone or a dedicated verification session should
re-attempt it once the physical device is reachable again.

---

# Milestone P21 — Desktop Files & Transfers UX

**Scope:** `New_Issues.txt` §2 (Transfers "Clear History"), §4 (file/folder
type presentation), the Desktop-applicable part of §5 (metadata
consistency), §8 (received files in Shared Files), and §9 (Delete action).
Explicitly not touched: Settings (§3, including the stale download-directory
default — investigated, root-caused, deliberately left alone per this
milestone's own "no Settings changes" boundary), any Android code (§5's
Android half, §6, §7, §14, §15), and §12 (see "Scope ambiguity" below).

**Requirements read and triaged before implementation** (`New_Issues.txt`
in full, `docs/15_QA_NOTEBOOK.md`'s P19/P20 entries, then the live app):

- §1.1–1.8, §1.6: already delivered by P19/P20 — verified still intact
  (regression pass below), not re-touched.
- §2 Clear History, §4 file-type wording, §8 received files, §9 Delete: in
  scope, implemented.
- §5 metadata consistency: partially in scope — see below.
- §3 Settings, §6 folder-upload wording, §7 file-selection flow, §14/§15
  Android nav/Clear-History placement: out of scope for this milestone
  (Settings explicitly excluded; §6/§7/§14/§15 are Android-only, per Rule 4).
- §12 "Desktop Files Tab — Long-Press/Context Actions": scope ambiguity,
  resolved as out-of-scope — see below.

**Scope ambiguity — §12.** Its heading says "Desktop Files Tab," but its
body (downloaded/not-downloaded/downloading-or-queued states, Open/Share/
Delete/Details vs. Remove/Details) describes browsing *someone else's*
shared files and deciding whether to download them — a concept that only
exists on the Android side today (confirmed by reading
`android/src/screens/files/FilesScreen.tsx`, whose current Open/Details-only
action set matches the issue's complaint almost exactly) and that current
Desktop Files couldn't produce even after this milestone's own §8 change:
a Desktop entry only exists once a receive has fully **completed** (§8's own
design — see Architecture decisions below), never as
"not-downloaded"/"downloading"/"queued," so §12's states have no Desktop
referent. Per this milestone's own instruction ("choose the smallest
interpretation consistent with the surrounding requirements") and Rule 4
("Not: Android UI redesign"), §12 is treated as an Android Files-screen
requirement mislabeled in the source document, and left for a future
Android UI milestone. Recorded here rather than silently skipped.

**Investigation before implementation (live app, real data):**
`backend/relay.db` already held one real paired device (RMX3997) and 541
real `Transfer` rows (a mix of `send`/`receive`, including two real folder
receives) from prior sessions' physical testing — no synthetic data was
needed to see the actual §2/§8 problems. Baseline screenshots (Files empty,
Transfers populated, Devices, Settings) confirmed every issue as described:
Shared Files showed 0 rows despite real received files existing on disk;
Transfers had no Clear History control; status was plain lowercase text
(`completed`); the Type column, when files were shared during testing,
showed a MIME type/raw item count exactly as quoted in the issue.

**Root causes:**
- §8/§9: `TransferStreamService.receive_upload` (confirmed by reading it)
  only ever writes bytes to disk and updates the `Transfer` row — it never
  creates a `SharedFile`/`SharedFolder` row. There was therefore no backend
  query the Files view could have used to include received items; this is
  a real modeling gap in what the *desktop UI* shows, not a backend defect
  (the backend was never asked to treat a receive as a share).
- §4: `files.js` rendered `SharedFile.mime_type` directly, and a folder row's
  Type column was a bare `"{n} items"` string — both literal, unmodified
  since M10/P13.

**Architecture decisions:**
- **Received items are derived, not stored.** Per this milestone's explicit
  instruction not to invent backend state to ease rendering, a "received
  file" row is computed client-side from `GET /transfers` (`direction ===
  'receive' && status === 'completed'`, grouped by `upload_batch_id`
  exactly like the Transfers view already groups folder batches — the
  grouping logic was extracted into a new shared module,
  `transferGrouping.js`, instead of duplicated) plus
  `app_settings.download_directory`. Only `completed` transfers are
  considered: an in-progress/queued receive is operational state that
  belongs in Transfers, not a file the user can act on yet, and a
  failed/cancelled one never produced a file — this sidesteps §12's
  "downloading/queued" ambiguity entirely by construction, per this
  milestone's own "do not infer a state from timing" rule.
- **"Delete" cannot remove a `Transfer` row** — `TransferRepository` has no
  delete method by design ("transfer rows are never removed by normal
  operation — they are the transfer history," per its own doc comment and
  `docs/13_Database_Design.md` §7/§10). So, for a received item, Delete (a)
  moves the local file/folder to the OS Recycle Bin via a new
  `shell.trashItem` IPC call (recoverable, not a permanent unlink) and (b)
  records the item's key in a local-only "removed" marker
  (`receivedFiles.js`, `localStorage`) that filters it out of future
  renders — the real `Transfer` row, and Android's own history, are
  untouched. This is the same shape as "Clear History" below and as
  Android's own `historyReset.ts`, applied to a second case.
- **"Clear History" (§2) is client-side only, for the identical reason**:
  `GET /transfers` has no backend delete/archive operation for either
  client to call (confirmed by reading `TransferRepository`,
  `TransferService`, and `app/api/v1/transfers.py` — no delete route
  exists), and Android already solved this exact problem the same way
  (`android/src/transfers/historyReset.ts`, whose own doc comment gives the
  full reasoning). `desktop/src/renderer/transferHistory.js` mirrors that
  module field-for-field (eligibility rule, UTC-naive-timestamp handling,
  "in_progress is never hidden regardless of clearedAt"), substituting
  `localStorage` for Android's JSON marker file since Electron's renderer
  has no filesystem access of its own and localStorage already persists
  correctly across app restarts (verified below).
- **Delete for a *sent* file/folder** (§9's other half) is real: it calls
  `shell.trashItem` on the local path and then the existing
  `DELETE /files/{id}` / `DELETE /folders/{id}` (already-existing
  `unshare_file`/`unshare_folder`, which only ever touched the DB row, never
  the disk — confirmed by reading `SharedFileService`/`SharedFolderService`).
  Trash is attempted first; the DB row is only removed after it succeeds,
  so a failed delete never leaves a dangling entry. This is additive to the
  existing "Unshare" action (kept, now correctly non-destructive-styled)
  rather than replacing it — Unshare (keep file, stop sharing) and Delete
  (remove file, stop sharing) are different user intents.
- **A new "Source" column** (`Shared` / `Received` badge, reusing the
  existing `.badge` component) was added rather than folding that
  distinction into the Name cell, so the table states the item's origin
  explicitly instead of requiring the user to infer it from which action
  buttons happen to be present.
- **§4/§5 file type**: `formatFileType()` (`dom.js`) returns the lowercase
  extension (`.pdf`, `.txt`) instead of the stored MIME type; a folder's
  Type cell became `Folder (N items)`. §5's "ordering consistency" concern
  is Android-specific in its literal form (Android renders inline
  `size · type` text and had an actual file-vs-folder ordering
  inconsistency there); Desktop already renders Size and Type as two fixed
  table columns in the same order for every row kind, so implementing §4 is
  what full "consistency" reduces to on this side — Android's own inline
  redesign is out of scope here (Rule 4) and unaffected by this change.
- **Transfer status badges**: `completed`/`failed`/`cancelled`/`in_progress`
  became colored `.badge` variants (green/red/neutral/pulsing-blue) instead
  of plain lowercase text, reusing the badge language P19/P20 already
  established for device/pairing state rather than inventing a new visual
  system.
- **Loading/error states** (`dom.js`'s `renderError`/new `loadingState`):
  restyled into the same bounded-card language as `emptyState` (P19) instead
  of a bare paragraph, with an optional "Try again" retry button wired in
  Files/Transfers (in scope) — the signature stayed backward-compatible so
  every other view's unchanged `renderError(container, err)` call still
  works, just with nicer styling, at zero behavior risk to out-of-scope
  views (Devices/Pairing/Settings).
- **`.row-actions`** (`app.css`): a table action cell can now hold up to
  four buttons (a sent file's full set); a tighter flex-wrap layout keeps a
  forced wrap (only at the default 1100px window width) reading as
  intentional rather than overflowing, instead of introducing a new
  "more actions" menu pattern this codebase doesn't otherwise have.

**Files modified:**
- `desktop/src/renderer/dom.js` — `formatFileType`, `loadingState`,
  restyled `renderError` (+retry), removed the now-dead `.error` CSS class's
  only consumer.
- `desktop/src/renderer/views/files.js` — received items, Source column,
  Delete (sent + received), Open (received), type/folder-count formatting,
  loading/error states.
- `desktop/src/renderer/views/transfers.js` — Clear History, status badges,
  loading/error states; grouping logic extracted to `transferGrouping.js`.
- `desktop/src/renderer/transferGrouping.js` (new) — shared batch-grouping,
  used by both Files and Transfers.
- `desktop/src/renderer/transferHistory.js` (new) — Clear History marker
  and filter (mirrors `android/src/transfers/historyReset.ts`).
- `desktop/src/renderer/receivedFiles.js` (new) — received-item derivation
  from transfers, removed-item marker, path resolution.
- `desktop/src/main/ipc-handlers.js` / `desktop/src/preload/preload.js` —
  three new IPC calls: `shell:openPath`, `shell:deleteItem` (trash),
  `fs:resolveDownloadPath`.
- `desktop/styles/app.css` — `.error-state`/`.loading-state`/`.spinner`,
  `.badge-danger`/`.badge-progress`, `.status-detail`, `.row-actions`;
  removed the dead `.error` rule.

**Verification performed:**
- `node --check` (as ES modules for every `import`/`export` renderer file,
  as CommonJS for the two main-process files) on every file touched or
  added — clean.
- Real Electron app, driven via `playwright-core@1.62.1` (`npm install
  --no-save`, same P19/P20 pattern, not committed) against the project's
  actual dev `backend/relay.db` (541 real transfers, one real paired
  device) rather than synthetic fixtures:
  - Confirmed the CSP `style-src` console warning on `.progress-fill`'s
    inline `width` is cosmetic only — `getComputedStyle` showed the width
    genuinely applied (100px/100px at 100%); not a real bug, not touched.
  - Files: shared a real test file and a real test folder via the actual
    `POST /files`/`POST /folders` endpoints, confirmed Type/Source/row-
    actions rendering, then exercised Delete on both a sent file and a real
    received file (`p144_custom (1).txt`, genuine prior-session data) —
    confirmed via direct filesystem check that the sent file's original
    path was empty afterward and the received file was gone from the
    configured download directory (both trashed, not corrupted/orphaned),
    and via direct `sqlite3` query that the sent file's `shared_files` row
    was gone. Reloaded the view and did a full process restart — both
    removals persisted (backend row genuinely gone; received-item
    `localStorage` marker survives a real process restart, not just SPA
    navigation).
  - Discovered live (not from the issue text): sharing a file individually
    and then sharing its containing folder raises an unhandled
    `sqlalchemy.exc.IntegrityError` (`UNIQUE constraint failed:
    shared_files.file_path`) surfaced to the user as a generic "unexpected
    error" — a pre-existing backend edge case, unrelated to any P21
    requirement and not blocking one. **Deferred**, recorded here per this
    milestone's "record unrelated bugs, don't fix them" rule.
  - Transfers: clicked Clear History against the real 100-row (pagination
    limit, pre-existing and unchanged) history — table went to 0 rows,
    button correctly disabled, "History cleared" empty state shown;
    navigated away and back (including a real 2s poll tick) and the
    cleared state held. Reset the marker afterward so the dev profile
    isn't left showing "History cleared" for its next real use.
  - Full click-through of all five tabs plus a real mouse-hover nav check,
    with `pageerror` listeners attached throughout every run — zero
    uncaught exceptions across every script in this milestone.
  - All test-created shared_files/shared_folders rows were removed after
    verification; `shared_files`/`shared_folders` are back to empty (their
    pre-milestone state), the one real device is untouched.
- **Regression:** Devices (paired-device card), Pairing (idle state, icon
  badges), and Settings screens re-screenshotted and visually compared
  against this milestone's own baseline captures — byte-for-byte identical
  in layout/content, confirming P19/P20 are unaffected.

**Physical-device verification: attempted, partially completed —
documented honestly rather than simulated.** RMX3997 was connected via ADB
(`adb devices`) and the Windows host was confirmed connected to the phone's
own "samsung" hotspot (`netsh wlan show interfaces`, matching `adb shell ip
route`'s `10.169.164.0/24` subnet) — genuine physical networking, not
loopback. The installed Relay app is a Metro-connected debug build; Metro
was already running from an earlier session, `adb reverse tcp:8081
tcp:8081` was set up, and the app was relaunched successfully — logcat
confirmed it made real, correctly-addressed HTTP requests to the desktop's
real LAN IP (`http://10.169.164.233:8000/api/v1/files`, `/folders`,
`/transfers`, `/transfers/requests`) on a live ~2s poll loop, and the
desktop backend's own log confirmed the corresponding `POST /files` (a real
test share made for this check) succeeded with no server-side error.
**What could not be confirmed:** the phone's own Shared Files screen never
progressed past its loading spinner despite these requests visibly
succeeding — repeated navigation, force-stop/relaunch, and a `logcat`
search for a JS error or crash all turned up nothing (no `ReactNativeJS`
error, no `AndroidRuntime` fatal). This reads as a pre-existing Android-side
rendering issue in this debug build, not a P21 regression: zero Android
files were touched by this milestone, and the API response shapes Android
consumes (`GET /files`/`/folders`/`/transfers`) are byte-for-byte unchanged.
Chasing it further would mean debugging/fixing Android application code,
which is explicitly out of scope for this milestone (Rule 4) — recorded
here as a discovered, deferred issue rather than either faked or silently
dropped. The backend-level round trip (share → real device successfully
authenticates and requests it over a real LAN) is the strongest evidence
available this session that the P21 changes don't break the real
Android-facing contract; full on-device visual confirmation is deferred to
whenever this debug build (or a release APK) is next working end-to-end.

**Discovered defects (deferred, not fixed — out of P21's scope):**
1. Sharing a file individually, then sharing its parent folder, throws an
   unhandled `IntegrityError` surfaced as a generic 500 instead of a clean
   validation message (backend, `SharedFolderService`/`SharedFileService`).
2. The installed Android debug build's Shared Files screen never resolves
   its loading state even though its own network requests succeed — see
   physical-device section above.
3. `list_transfers`'s default `limit=100` means Clear History (and the
   Transfers view generally) only ever sees the newest 100 rows of a
   longer history; pre-existing, unrelated to this milestone's own logic.

**Remaining limitations:**
- Desktop's "Details" action (mentioned as one of several *optional*
  actions in §8/§12) was not implemented — every field it would show
  (name, size, type, source, date) is already visible directly in the row,
  and this codebase has no modal/dialog pattern yet to build one from;
  deferred rather than introducing a new UI primitive for marginal value.
- "Open" was added only for received files (the literal §8 ask), not for
  sent/shared files — an intentional, minimal-scope asymmetry, not an
  oversight.
- §12 (Android Files-screen actions) and §5's Android half remain
  unaddressed, per the scope-ambiguity note above — candidates for a future
  Android UI milestone.

---

# Milestone P21.1 — Android Folder Download Flicker & Transfer Grouping

**Scope:** Two reported Android issues only — (1) a folder's Files-screen
button flickering between "Download" and "Downloading..." during a folder
download, (2) the Transfers tab showing every child file of a folder
download/upload as its own row instead of one folder-level row. No new
architecture, no new backend transfer type, no context-menu/Settings/
pairing/Desktop changes — per this milestone's own explicit boundary.

**Baseline reproduction (RMX3997, real backend + real hotspot network, not
the attached videos alone):** four synthetic shared folders (8, 8, 12, and
6 files, 15–20 MB each so streaming took real, observable time) were shared
via `POST /folders` and downloaded from the Android Files screen while
capturing the folder row every 0.5–0.7s via `adb shell screencap`, and every
`GET /transfers`/`GET /transfers/requests` request/response was captured via
the app's existing `[QR-DEBUG]` HTTP logging (`api/client.ts`) over `adb
logcat`. Pre-fix, an 8-file folder's row was observed to transition
"Downloading..." → **"Download"** (one frame) → "Open" — confirmed live, not
assumed from the videos.

**Root cause (Issue 1):** `deriveFolderDownloadStatus`
(`files/folderDownloadStatus.ts`) is a pure function of polled data with no
way to distinguish two situations that look identical to it: (a) every
child's `Transfer` just reached `'completed'`, but
`TransferStreamManager.notifyIfFolderComplete`'s own multi-step pipeline
(`getFolderFiles` + `listTransferRequests` + `listTransfers`, then
`markFolderReconciled`) hasn't finished writing the reconciliation record
yet, vs. (b) a folder that was never downloaded, or whose shared content has
since drifted (P13.2, Issue 2) and genuinely needs a fresh download. Both
report every current child `'completed'` but `isFolderContentReconciled ===
false`, so both fall to `'idle'` → "Download". P13.3's own fix (subscribing
to `TransferStreamManager` and refreshing reconciliation the instant a
stream completes) narrows this window but does not close it: the routine
2000ms `transfers` poll can independently observe "every child completed"
via the backend *before* `notifyIfFolderComplete`'s own several sequential
network calls finish — confirmed directly by parsing the captured
`[QR-DEBUG]` response bodies: the `transfers` array's own completed-count for
the folder was strictly monotonic (never regressed) across the whole
download, ruling out an out-of-order/stale-poll-response race as the cause
before spending any effort on it. Also confirmed live: intermediate
children finishing never causes a flicker — every child's backend `Transfer`
already reads `'in_progress'` the instant it's proposed (auto-accept, see
`downloadStatus.ts`), so the aggregate `kind` cannot fall out of
`'in_progress'` until the very last child, and `requestingFolderIds` already
pins the button to "Downloading..." for the whole propose loop regardless.

**Fix (Issue 1):** `FilesScreen.computeFolderRowState` now breaks the
`'idle'`-vs-"reconciling" tie using a signal `deriveFolderDownloadStatus`
doesn't have: `TransferStreamManager`'s own live state, which this screen is
already subscribed to. If every child is backend-`'completed'` but the
derived `kind` is still `'idle'`, and the last transfer this app instance's
stream engine actually touched (`state.transferId`) belongs to this exact
folder, the row is held at `'in_progress'` ("Downloading...") instead of
regressing to `'idle'` ("Download") — self-terminating the moment
reconciliation actually lands (kind becomes genuine `'completed'` directly).
A folder the stream engine hasn't just touched (state `null`, or referencing
an unrelated transfer — including the ordinary "content changed on desktop"
staleness case) is untouched by the override and still correctly offers
"Download". `folderExists === false` (P13.3) also bypasses the override — a
folder just confirmed deleted from disk must still fall back to "Download,"
never get stuck on "Downloading..." forever.

**Root cause (Issue 2):** `TransferListScreen` has always rendered `GET
/transfers` one row per persisted `Transfer`, with no concept of "these N
rows are one folder operation" — confirmed by reading the screen (no
grouping logic existed at all, unlike Desktop's own
`transferGrouping.js`/`renderBatchRow`, which already solved the identical
problem for Desktop's Transfers table).

**Fix (Issue 2):** New `android/src/transfers/transferGrouping.ts`
(`groupTransfers`), a client-side-only grouping over the existing `GET
/transfers` data — mirrors `desktop/src/renderer/transferGrouping.js`'s
shape, adapted for Android's two directions: a folder *download* groups by
`shared_folder_id` (a download has no `upload_batch_id`), a folder *upload*
groups by `upload_batch_id` (client-generated UUID, set by
`TransferListScreen.handleUploadFolder`). `TransferListScreen` renders each
group as one non-interactive `FolderTransferRow` (name, `Folder (N items)`,
an aggregate status — failed > in_progress > completed > cancelled, same
priority as Desktop's `renderBatchRow`) instead of N individual rows; a
standalone transfer is untouched. No progress counters in the folder row,
per this milestone's own instruction and matching FilesScreen's existing
P13.1 precedent (a folder's label reads like an ordinary item's, never
"(3/8)"). The row is not `Pressable` — there is no folder-level detail
screen, and building one was out of this milestone's scope; each child
transfer still has its own detail screen, just not reachable from the
folder row.

**Architecture decision — `shared_folder_id` reuse (P17) left as a known
limitation, not solved:** `transferGrouping.ts`'s own doc comment spells
this out — grouping a folder *download* by `shared_folder_id` alone can, in
the narrow case where a folder is downloaded, fully unshared, and a later,
unrelated folder is shared and reuses the same SQLite id (P17), merge two
logically unrelated download batches into one folder row in Transfers
*history*. Unlike `files/folderIdentity.ts`'s own P17 fix, there is no
available fix at this layer: that fix cross-checks a live `SharedFolder`'s
`shared_at`, but the Transfers screen renders permanent history
(`docs/13_Database_Design.md` §7/§10) including transfers whose folder was
unshared long ago and has no live `shared_at` to check against. The common
case (one folder, downloaded once or retried) groups correctly; a false
merge requires the specific id-reuse sequence above. Accepted rather than
adding a backend column or new client-side identity store for a folder
history predates.

**Files changed:**
- `android/src/screens/files/FilesScreen.tsx` — `computeFolderRowState`
  fix (exported for testability), doc comment.
- `android/src/screens/transfers/TransferListScreen.tsx` — renders grouped
  items, new `FolderTransferRow`.
- `android/src/transfers/transferGrouping.ts` — new.
- `android/__tests__/screens/files/computeFolderRowState.test.ts` — new,
  9 tests.
- `android/__tests__/transfers/transferGrouping.test.ts` — new, 10 tests.

**Automated verification:** `npx tsc --noEmit` clean; `npx eslint .` — 0
errors, the same 2 pre-existing `no-void` warnings in
`TransferStreamManager.ts` unrelated to this change; `npx jest` — 40 suites,
339 tests, all passing (19 new, 0 regressions).

**Physical-device verification (RMX3997, real backend/network):**
- **Test A (single file):** unaffected — Download → Downloading... → Open,
  and the Transfers row for it stays its own single row even alongside a
  concurrent folder download.
- **Test B (one-file folder):** the three "duplicate name" folders below
  (§Test F) each had exactly one child and showed the identical clean
  transition with no flicker.
- **Test C (multi-file folder):** a 12-file, 240 MB folder captured at
  0.5s intervals end-to-end (100 frames) — contact sheet confirmed a clean
  "Downloading..." → "Open" transition with **zero** intermediate
  "Download" frames (pre-fix, the same class of folder produced one). The
  Transfers tab showed exactly one row ("Folder (12 items)", "In progress"
  → "Completed") for the whole operation, never 12 rows.
- **Test D (nested folder):** `a.bin` + `sub/b.bin` + `sub/c.bin` +
  `sub2/d.bin` — one Files row, one Transfers row ("Folder (4 items)"),
  "Open" correctly showed the full nested structure (`sub/`, `sub2/`,
  `a.bin`) via the device's file manager.
- **Test E (concurrent operations):** a folder download and a standalone
  file download started together — the file correctly queued behind the
  folder (FIFO unchanged), Transfers showed the file as its own row
  ("0 B / 10.0 MB", "In progress") and the folder as one row
  ("In progress") simultaneously; both reached "Completed"/"Open" cleanly.
- **Test F (duplicate folder names):** three distinct shared folders all
  named `test` (distinct `shared_folder_id`s 6/7/8, downloaded
  concurrently) remained three separate rows on both Files and Transfers
  throughout — one `Completed`/`Downloading...`/`Queued` at a time (FIFO),
  never merged — and landed on-device as three distinct directories
  (`test`, `test (1)`, `test (2)`, confirmed via `adb shell ls`),
  regression-checking P13.2/P13.3/P17's existing identity handling.

**Before/after:** Before — a multi-file folder's Files-screen button could
regress "Downloading..." → "Download" for one frame right before "Open";
the Transfers tab showed every folder child as its own row. After — the
button transitions cleanly Download → Downloading... → Open/Retry with no
regression; the Transfers tab shows exactly one row per folder operation
alongside ordinary single-file rows.

**Defects discovered and deferred (not fixed — out of P21.1's scope):**
- Re-downloading a folder that was previously downloaded, then deleted from
  disk (`folderExists` cached `false`), appears able to get stuck failing
  to report `'completed'` again until the next existence re-check happens
  to run — `deriveFolderDownloadStatus`'s `'completed'` branch requires
  `folderExists !== false`, but the effect that re-verifies existence only
  runs when `status.kind === 'completed'` already, a potential circular
  dependency. Not reproduced live (would require a separate, deliberate
  repro) and not touched by this milestone's fix (P21.1's override
  explicitly excludes `folderExists === false`, so it neither causes nor
  worsens this) — flagged here for a future milestone to investigate.
- The `[QR-DEBUG]` logging left in `api/client.ts` (noted as an open item
  since P14.2) is verbose enough to occasionally hit React Native's
  console "TOO BIG formatValueCalls" truncation on a large `GET /transfers`
  response during heavy testing — cosmetic (log truncation only, no
  functional impact observed), not touched here.

**Remaining limitations:** the `shared_folder_id` reuse edge case for
Transfers-tab grouping (see Architecture decision above); no folder-level
detail/drill-down screen (each child's own detail screen is unreachable
from the grouped folder row); no progress-count indicator on a folder's
Transfers row, per this milestone's explicit instruction.

---

# Milestone P21.2 — Folder Download Button State Regression

**Scope:** Files-screen folder button state only, per this milestone's own
boundary — P21.1's Transfers-tab grouping was explicitly not to be touched
(verified unbroken, see below).

**Reproduction methodology:** a 100-file, 200 MB shared folder
(`P21_2_100_File_Test`, 2 MB/file) was downloaded live on RMX3997 while
`computeFolderRowState`'s own return value was captured via temporary
single-line `console.log` instrumentation over `adb logcat` — not by
scraping the app's existing `[QR-DEBUG]` HTTP response dumps (`api/client.ts`),
which was tried first and found unreliable at this scale: React Native's
console formatter truncates a large printed array after roughly 200
field-format calls, so a `GET /transfers` response containing 100+ objects
only ever printed ~12–14 of them before hitting
`[TOO BIG formatValueCalls N exceeded limit of 200]` placeholders. An
initial pass analyzing those truncated dumps produced 31 apparent
"completed-count regressions" and 107 apparent "present-count drops" that,
on cross-checking against the *un-truncated* real backend data (`curl`
against `GET /transfers` directly, and comparing to responses containing
more than 3 real objects), turned out to be entirely a printing artifact —
some captured "list" records were actually single-object `GET
/transfers/{id}` responses (from `handleFolderDownload`'s own
`getTransfer()` call per proposed child) misidentified as truncated list
responses by the initial parsing. Direct in-app instrumentation was
adopted instead specifically to avoid drawing conclusions from this noise.

**First reproduction result — `kind` (Download/Downloading/Open): clean.**
Two full 100-file runs (one holding Files in the foreground throughout, one
additionally navigating to Transfers and back mid-download) both showed
`computeFolderRowState`'s `status.kind` transition exactly three times:
`idle → in_progress → completed`, zero regressions, zero premature
`completed`, across 383 and 387 captured renders respectively. P21.1's own
fix (the `idle`-vs-reconciling tie-break) holds at 100-file scale exactly
as it did at the smaller scale it was originally verified against.

**Second reproduction result — `queued` (Downloading.../Queued): the real
bug.** The same capture's `queued` boolean, replayed through
`folderDownloadButtonLabel`'s own switch, showed **194 label changes** —
`Downloading...` ⇄ `Queued`, roughly once per child, for the entire ~105s
download. This is what the reported "the button keeps changing state as
individual files complete" behavior actually was: not the folder falling
back to `Download`/`Open` literally, but a rapid, continuous
`Downloading...`/`Queued` oscillation that reads, at a glance, as exactly
the kind of "state keeps flickering" the milestone description describes.

**Root cause:** every child transfer — not just the first — passes through
`TransferStreamManager.start()`'s own brief `await
PermissionsAndroid.request(...)` gate before `state.status` flips to
`'streaming'` (the same startup gap `Milestone P13.3 Correction` already
had to design around for a *single* lone transfer). Between one child's
stream ending and the next one clearing that gate, `state.status` is
briefly whatever the just-finished child left it at (`'completed'` /
`'failed'`), so `TransferStreamManager.isActive(id)` returns `false` for
*every* id in the folder for those few milliseconds — while the other
98-or-so not-yet-started children are already genuinely sitting in the
FIFO `queue`, so `isQueued()` for them is `true`. `computeFolderRowState`'s
old `queued = !anyActive && childTransferIds.some(isQueued)` therefore
read `true` at every single child boundary in a large folder — once per
child, 99 times for a 100-file folder — not just once at the very start.
A small folder (P21.1's own 6–12-file tests) has too few boundaries for
this to read as more than an occasional, easy-to-miss blip; at 100 files
it is continuous and highly visible.

**Fix:** `android/src/screens/files/FilesScreen.tsx`'s `computeFolderRowState`
now treats the folder as "underway" — and therefore never `Queued` — once
any child has completed or one is genuinely active right now
(`folderDownloadUnderway = anyActive || status.completedCount > 0`); the
transient inter-child gap no longer counts as "the whole folder went back
to waiting in line." A folder that genuinely has not started at all
(nothing completed, nothing of its own active) still correctly reports
`Queued` while it waits behind an unrelated already-streaming transfer
(P21.1's own Test E: a lone file plus a folder started together).

**Why this doesn't change the underlying architecture:** the fix is a
three-line change to one derived boolean in one screen-local function.
`TransferStreamManager`'s FIFO, `folderIdentity.ts`, `useFolderReconciliation.ts`,
`deriveFolderDownloadStatus`, and the P21.1 `kind` override are all
untouched — children still stream one at a time exactly as before; only
how their *transient in-between* state is read for the folder's `queued`
flag changed.

**Automated tests:** `android/__tests__/screens/files/computeFolderRowState.test.ts`
gained a `computeFolderRowState queued derivation (P21.2)` block (4 tests):
the inter-child gap no longer reads queued; a 100-child folder simulated
across every single completion boundary never reads queued once started;
a folder genuinely not yet started still correctly reads queued behind an
unrelated transfer; the actively-streaming child keeps the folder out of
queued regardless of completed count. `npx tsc --noEmit` clean; `npx eslint .`
0 errors (same 2 pre-existing unrelated `no-void` warnings); `npx jest` —
40 suites, 343 tests, all passing (4 new, 0 regressions).

**100-file physical-device verification (post-fix, RMX3997):** a fresh
100-file folder (never before downloaded on this install, so no stale
reconciliation state) was downloaded while capturing the Files-screen row
at backend-confirmed 0%, 25%, 51%, 75%, and 95% completion, plus after
100%. All five in-progress screenshots showed an identical, stable
"Downloading..." button — no `Download`, no `Queued`, no `Open` in
between — and the final screenshot showed "Open", with all 100 files
confirmed present on-device (`adb shell ls`, 100 entries).

**P21.1 regression check:** the same 100-child folder's Transfers tab
still showed exactly one row — "P21_2_100_File_Test / Download · Folder
(100 items) / Completed" — never 100 individual rows, confirming P21.1's
grouping fix is untouched by this change.

**Remaining limitations:** none newly introduced by this fix.
`handleFolderDownload`'s sequential propose loop (unrelated pre-existing
code, not touched by P21.1 or P21.2) has no per-child retry — a single
transient network failure among 100 sequential `POST /transfers/requests`
calls would abort the loop, leaving the remaining children un-proposed and
the folder stuck at "Downloading..." with no automatic resume; not
reproduced live and not observed in either successful 100-file test run
in this milestone, noted here only as a theoretical scale-related gap
worth a future look, not a defect this milestone's fix caused or could
mask.

---

# Milestone P22 — Android Files Screen & File Actions UX

**Scope:** `New_Issues.txt`'s Android Files-screen requirements P21 had
explicitly deferred: §12 ("Desktop Files Tab — Long-Press/Context Actions,"
resolved during P21 as actually describing Android's own Files screen — see
P21's own "Scope ambiguity" note) and §5's Android half (file/folder
metadata line consistency). Explicitly not touched: Android Settings,
Android navigation/bottom-nav icons (§14), Transfer History placement (§15),
Desktop, backend business logic, or any other Android UI area.

**Requirements read and triaged before implementation** (`New_Issues.txt` in
full, P21's own QA entry, then the live app on RMX3997):
- §12: a downloaded file needs Open/Share/Delete/Details; a downloaded
  folder needs Open/Delete/Details (no Share — see Architecture decisions);
  a not-yet-downloaded or downloading/queued file or folder needs
  Remove/Details, with Remove's actual behavior left to "whatever is
  appropriate to the current transfer state" per the issue's own wording.
- §5 (Android half): drop the redundant raw MIME type from a file's meta
  line (the file's own name/extension already conveys type) and make a
  file's and a folder's meta-line ordering consistent.
- Section 11 of this milestone's own instructions required first
  determining whether P21's documented "Files screen never leaves its
  loading spinner" issue still reproduces, before doing anything else.

**Reproduction (Section 11):** did not reproduce. A clean `adb`
force-stop + relaunch against a live backend (with one real shared file and
one real shared folder) rendered the populated Files list correctly on the
first attempt — screenshotted before any code was touched. The prior
session's own report already treated this as "possibly a stale debug-build
artifact, not conclusively an Android code defect" rather than a hard
regression; whatever it was, it was not present in this session's build and
is not this milestone's to explain further.

**Investigation before implementation:** read `FilesScreen.tsx`,
`FileActionMenu.tsx` (P14.1), `downloadActions.ts`, `downloadExistence.ts`,
`downloadStatus.ts`/`folderDownloadStatus.ts`, `fileIdentity.ts`/
`folderIdentity.ts`, and the Transfers tab's own existing per-transfer
Cancel action (`TransferProgressDetail.handleCancel`) to find the exact
active-vs-queued cancel pattern to reuse. Confirmed live via baseline
screenshots that the long-press menu offered only Open/Details for every
row regardless of state, and that a file's meta line read `55 B ·
text/plain` while a folder's read `2 items · 22 B` (reversed order,
matching the issue text exactly).

**Architecture decisions:**
- **"Share" required a new native dependency; user chose `react-native-share`
  over a hand-written native module.** Confirmed by reading
  `node_modules/react-native/Libraries/Share/Share.js` (drops `url` on
  Android) and `react-native-blob-util`'s own Android implementation (only
  `ACTION_VIEW`, never `ACTION_SEND`) that neither existing dependency can
  do this. `react-native-share`'s own native module calls
  `startActivityForResult` against the real foreground `Activity`
  (`getCurrentActivity()`), avoiding the `FLAG_ACTIVITY_NEW_TASK` crash
  `react-native-blob-util`'s `actionViewIntent` had to work around (P9.1) by
  omitting a chooser title — confirmed live, Share works with no equivalent
  workaround needed.
- **Share is file-only, not offered for folders.** No single-file-shaped
  `ACTION_SEND` maps cleanly onto "share a whole directory," and this
  codebase already treats file-only vs. folder-only actions as an
  intentional split rather than forcing one to fit the other.
- **Share does not support a custom SAF download location (P14.3).**
  `react-native-share`'s own `RNSharePathUtil.compatUriFromFile` mishandles
  an already-`content://` URL (re-parses it as a bare path before
  rewrapping, losing the scheme) — a confirmed third-party limitation, not
  fixable without patching `node_modules`. `shareDownloadedFile` detects
  this case and rejects with a plain "not available to share" instead of
  invoking a broken share.
- **"Delete" is local-only, direction-blind by construction.** Android's
  Files screen only ever lists items it can *download* (desktop → Android);
  there is no "received" concept to disambiguate the way Desktop's own P21
  Delete had to. Deleting a file/folder here always means "remove my local
  downloaded copy" — the desktop's `SharedFile`/`SharedFolder` row is never
  touched, matching how the backend's shared-file model was already
  designed (Android has no ownership over a share's existence). Reuses the
  existing `deleteDownloadedPath` (already recursive for a directory, per
  `fs.unlink`/`safUnlink`'s own native behavior — confirmed by reading
  `ReactNativeBlobUtilFS.java`'s `deleteRecursive`) rather than adding a new
  low-level primitive. Confirmed with a real confirmation dialog (mirroring
  `TransferListScreen`'s own Clear History `Alert.alert` pattern) since,
  unlike Clear History, this discards actual bytes.
- **"Remove" behavior is genuinely bifurcated by state, exactly as the
  issue's own wording allows ("appropriate to the current transfer
  state").** An idle/failed row has nothing backend-side to act on — Remove
  dismisses it from this screen via a new client-local marker
  (`removedItems.ts`), the same shape as Desktop's own P21
  `receivedFiles.js`/Android's own `historyReset.ts` precedent for "the
  backend has no delete primitive for this, so don't invent one." A
  pending/in_progress row is genuinely operational — Remove cancels it via
  byte-for-byte the same active-vs-not branch
  `TransferProgressDetail.handleCancel` already uses for the Transfers tab's
  own Cancel button (`TransferStreamManager.isActive`/`cancelActive()` vs.
  a plain `cancelTransfer()` call), reused rather than reinvented. A
  folder's Remove during `in_progress` loops every child currently
  pending/in_progress and cancels each the same way — a child already
  `completed` is left alone, so a partially-downloaded folder correctly
  falls back to a re-downloadable `idle` state (existing retry logic in
  `handleFolderDownload` already only re-fetches what's missing).
- **`removedItems.ts` applies the P17 `shared_at` guard even though the
  pre-existing `fileIdentity.ts` registry doesn't.** `fileIdentity.ts`
  predates P17 and was left as its own documented, accepted gap; this is
  new code written after P17 was established, so it follows the convention
  `folderIdentity.ts` set: store the dismissed item's `shared_at` alongside
  the dismissal, and only honor it while the live item's own `shared_at`
  still matches — otherwise a reused id (a folder/file unshared and later
  replaced by an unrelated share that happens to land on the same reused
  SQLite rowid) would incorrectly inherit an old dismissal. Verified live
  (see below), not just unit-tested.
- **§5 metadata**: new `metadataFormat.ts` — `fileMetaLine` returns size
  only (no MIME type: a file's own extension already conveys type to a
  normal user, and repeating `text/plain` next to `sample.txt` is exactly
  the redundancy the issue called out); `folderMetaLine` returns `Folder ·
  N items · size`. Reused by `FileRow`/`FolderRow`, the long-press menu's
  subtitle, and (for the file case) the Details alert — one formatter, not
  four call sites each re-deriving the string.
- **A destructive-styled Delete action.** `FileActionMenuAction` gained an
  optional `destructive` flag (red label, matching
  `TransferProgressDetail`'s own `dangerButtonText` color) applied only to
  Delete, not Remove — Remove never discards content the way Delete does
  (it either dismisses a still-shared item or cancels a download, neither
  destroys anything).

**Files modified/created:**
- `android/src/files/metadataFormat.ts` (new) — `fileMetaLine`/`folderMetaLine`.
- `android/src/files/removedItems.ts` (new) — the P22 "Remove" dismissal
  registry (JSON file, mutex-guarded, mirrors `folderIdentity.ts`'s shape).
- `android/src/files/useRemovedItems.ts` (new) — React hook wrapping it,
  mirrors `useFolderReconciliation.ts`'s shape.
- `android/src/files/downloadActions.ts` — added `shareDownloadedFile`;
  updated its own doc comment (previously documented Share as
  investigated-and-rejected — now implemented).
- `android/src/components/FileActionMenu.tsx` — `destructive` flag on
  `FileActionMenuAction`.
- `android/src/screens/files/FilesScreen.tsx` — per-state menu action lists
  for both files and folders; `handleShareFile`/`handleDeleteFile`/
  `handleRemoveFile` and their folder equivalents; removed-item filtering on
  the merged list; meta-line rendering switched to `metadataFormat.ts`.
- `android/package.json`/`package-lock.json` — added `react-native-share`
  (`^12.3.1`).
- `android/__mocks__/react-native-share.js` (new) — manual Jest mock,
  matching the existing `__mocks__/react-native-blob-util.js` pattern (a
  TurboModule only registered in a real native binary).
- New/extended tests: `__tests__/files/metadataFormat.test.ts` (new),
  `__tests__/files/removedItems.test.ts` (new, including a P17 id-reuse
  regression test), `__tests__/files/downloadActions.test.ts` (extended
  with `shareDownloadedFile` coverage, including the custom-SAF-mode
  rejection case).

**Automated verification:** `npx tsc --noEmit` clean; `npx eslint` clean on
every touched/added file (two pre-existing `no-void` warnings in
`TransferStreamManager.ts`, a file this milestone did not touch); `npx
jest` — 42/42 suites, 357/357 tests passing, including all newly added
cases.

**Physical-device verification (RMX3997, `69DADENFONAIOZS4`):** a full
native rebuild (`gradlew app:installDebug`, ~11 minutes, no CMake/path
issues this time) was required to link `react-native-share`'s TurboModule;
installed and driven against the real dev backend over the phone's own
hotspot (`10.169.164.233:8000`), not loopback. Verified live, with
before/after screenshots and direct `adb shell ls`/backend `GET`
cross-checks at each step:
- §5: a real shared file rendered `55 B` (no MIME type); a real shared
  folder rendered `Folder · 2 items · 22 B`.
- §12 downloaded file: long-press menu showed Open/Share/Delete (red)/
  Details. Share opened Android's real `ACTION_SEND` chooser (WhatsApp,
  Instagram, Chrome, etc. — the *content*, not an "Open with" dialog,
  confirming this is genuinely a different intent than Open). Delete
  removed the file from `/storage/emulated/0/Download/Relay/` (confirmed via
  `adb shell ls`) and the row reverted to "Download."
- §12 downloaded folder: menu showed Open/Delete (no Share)/Details.
  Delete recursively removed the folder's on-device directory (confirmed
  empty via `adb shell ls`) and the row reverted to "Download."
- §12 not-yet-downloaded file/folder: menu showed Remove/Details. Remove
  hid the row immediately, survived a full app force-stop + relaunch
  (registry file persisted), and the backend confirmed the item was still
  genuinely shared (`GET /files`/`/folders` unchanged) — a purely local
  dismissal, not an unshare.
- P17 regression check (not in the original requirement text, verified
  because `removedItems.ts` claims to handle it): unshared, then re-shared,
  the same folder (`DELETE /folders/1` then `POST /folders`, SQLite reused
  id `1` with a new `shared_at`) — the folder correctly reappeared instead
  of staying hidden under the old dismissal.
- §12 downloading/queued file: shared a 1.6 GB file, tapped Download, and
  tapped Remove mid-stream (confirmed genuinely in-progress via the
  "Downloading..." button label and a direct `GET /transfers` poll showing
  partial `bytes_transferred`). The backend's own `Transfer` row moved to
  `status: "cancelled"` at ~620 MB transferred, and the row reverted to
  "Download." (A 60 MB file was tried first and completed before the
  cancel tap could land — local hotspot throughput made it too fast to
  reliably catch mid-transfer; the 1.6 GB file gave a reliable multi-second
  window instead.)
- Regression: Transfers tab (including the just-cancelled transfer showing
  "Cancelled") and Settings tab both re-screenshotted and confirmed
  unaffected; pairing state, download queue, and notifications were not
  disturbed by the native rebuild.

**Discovered but out of scope (deferred, not fixed):**
1. `api/client.ts` contains leftover `[QR-DEBUG]` `console.log`/`console.error`
   statements (confirmed still present, unrelated to any P22 file) — noise
   in test/logcat output, not a defect this milestone introduced or was
   asked to clean up.
2. A folder's Remove-during-`in_progress` multi-child cancel loop was code
   reviewed against the single-file case it mirrors and is covered by unit
   tests exercising the underlying `cancelTransfer`/`TransferStreamManager`
   calls, but was not itself exercised live with more than one child
   in-flight simultaneously (this app's own one-active-stream-at-a-time
   design, per `TransferStreamManager`'s doc comment, means only one child
   is ever genuinely streaming regardless of folder size — the multi-child
   case mainly exercises the "cancel several backend-pending rows" branch,
   which the live single-file test already covers end-to-end). Worth a
   dedicated live pass in a future milestone that specifically stresses
   folder cancellation.

**Remaining limitations:**
- Share is unavailable (with a clear in-app message, not a silent failure)
  when the download location is a custom SAF folder (P14.3) — a
  `react-native-share` library limitation, not something fixable from this
  codebase without patching `node_modules`.
- `removedItems.ts`'s dismissal, like every other private-storage registry
  in this pipeline (`fileIdentity.ts`, `folderIdentity.ts`,
  `historyReset.ts`), is lost on app reinstall — an accepted, narrow edge
  case consistent with this app's existing persistence precedent, not a new
  gap introduced here.

---

# Milestone P23 — Android Settings, Navigation & App Identity

**Scope:** `New_Issues.txt` §3 (Android Settings, device display name,
download folder audit), §14 (bottom-navigation icons), §13/§1.7 (Android
app icon, cross-platform visual identity), §15 (Clear History placement).
Explicitly not touched: Desktop Settings/menu-bar/UI, pairing protocol,
transfer engine, storage architecture, `historyReset.ts` semantics, or
packaging/deployment.

**Baseline (RMX3997, already paired, before any change):** Settings showed
only the P14.3 download-location card ("Downloads/Relay" default) with a
large empty area below it — no device-name UI existed. The bottom nav
rendered `@react-navigation/elements`' `MissingIcon` (a bare outlined
rectangle) for all three tabs — confirmed by grep, no `tabBarIcon` was set
anywhere in the codebase, so this wasn't a rendering bug, it was simply
never implemented. The launcher icon was the stock unmodified React Native
template robot icon. Transfers' Clear History sat right-aligned below the
Upload buttons. All captured via `adb screencap` before any edit.

**Investigation before implementation:** read `SettingsScreen.tsx`,
`downloadLocationStore.ts`/`DownloadLocationManager.ts`/
`useDownloadLocation.ts` (confirmed P14.3 fully functional, reused
verbatim — not rebuilt), `pairing/deviceName.ts`/`deviceIdentifier.ts`,
`session/types.ts`/`SessionManager.ts`/`secureStorage.ts`, the pairing
screens (`QrScanScreen.tsx`, `PairingWaitingScreen.tsx`,
`PairingResultScreen.tsx`), `MainTabs.tsx`, `TransferListScreen.tsx`,
`historyReset.ts`, and the backend's `devices.py`/`device_service.py`/
`dependencies.py`/`auth_service.py`.

**Architecture decision — device display name required a scoped backend
auth change, surfaced to the user before implementing:** `deviceName.ts`'s
own doc comment stated the rename was desktop-only
(`PATCH /devices/{id}`), and that route had zero auth of any kind — not
even a loopback check in code, only a documented assumption. This is
exactly the gap `CLAUDE.md`'s "Not Yet Implemented" section had flagged
since M9 ("revisit if Android is ever expected to call those routes
directly"), and P23 is the milestone that actually triggers it. Presented
three options to the user (call the open route as-is; make the name
local-only with no backend sync; add a scoped auth check) — the user chose
the scoped check. Implemented as `verify_device_owner`
(`backend/app/api/dependencies.py`), reusing the exact
`RequestingDeviceDep`/loopback-vs-bearer-token pattern M10 already
established for `GET /files`: the loopback desktop caller is unrestricted;
any other caller must present a session token whose `device_id` matches
the path — a token for a *different* device gets the same generic 401 as
no token at all (`10_Security.md` §11). `GET /devices`, `GET /devices/{id}`,
`DELETE /devices/{id}` are untouched. New/updated backend tests:
`test_patch_device_as_self_renames_it`,
`test_patch_device_rejects_non_loopback_caller_without_token`,
`test_patch_device_rejects_token_for_a_different_device`; the three
pre-existing PATCH tests were switched from the (non-loopback-simulating)
`client` fixture to `desktop_client` since they exercise the
desktop-perspective rename.

**Architecture decision — `Session.device_name` is carried forward from
pairing, not fetched.** `PairingResultResponse` never returns the name
Android itself submitted at pairing (`POST /pairing/request`'s
`device_name`), so it wasn't available anywhere after the pairing screens.
Threaded `deviceName` through `QrScanScreen` → `PairingWaiting` route
params → the `Session` object `PairingWaitingScreen` builds, rather than
adding a new `GET /devices/{id}` round-trip (simpler, and avoids opening a
second dual-audience read route on `/devices` beyond what P23 actually
needed). Editing calls `PATCH /devices/{id}` first and only updates the
local `Session` (`SessionManager.updateDeviceName`) once that succeeds, so
the two are never out of sync from Android's own actions.

**Bug found and fixed during live verification, not anticipated by
inspection alone:** the physical test device's session predates this
milestone, so its persisted `Session` had no `device_name` field at all —
the DEVICE card rendered with a blank value and a large visual gap between
the label and the Edit Name button (screenshotted). Fixed by falling back
to `getDefaultDeviceName()` (the same default a fresh pairing would use)
whenever `session.device_name` is falsy, in both the display value and the
edit-start draft; saving (even unchanged) self-heals the stored session
since the fallback is guaranteed not to equal the missing `device_name`.
Re-verified live — showed "RMX3997" (the device model) immediately.

**Files changed:**
- Backend: `app/api/dependencies.py` (`verify_device_owner`,
  `DeviceOwnerAuthDep`), `app/api/v1/devices.py` (wired onto
  `PATCH /devices/{id}`), `tests/api/test_devices.py` (new/adjusted
  tests), `README.md` (new "Devices API" section, updated Authentication
  Infrastructure paragraph).
- Android: `session/types.ts` (`Session.device_name`),
  `session/SessionManager.ts` (`updateDeviceName`),
  `navigation/types.ts` (`PairingWaiting.deviceName`),
  `screens/pairing/QrScanScreen.tsx`/`PairingWaitingScreen.tsx` (thread
  the submitted name into the built `Session`), `pairing/deviceName.ts`
  (doc comment only — logic unchanged), `api/types.ts`
  (`DeviceUpdateRequest`/`DeviceRenameResponse`), `api/client.ts` (new
  `patch` method), `api/endpoints/devices.ts` (new, `renameDevice`),
  `screens/settings/SettingsScreen.tsx` (DEVICE/STORAGE sections,
  `DeviceNameCard`; download-location logic reused verbatim),
  `navigation/MainTabs.tsx` (`tabBarIcon`/tint colors),
  `components/icons.tsx` (new — `FolderIcon`/`TransferIcon`/
  `SlidersIcon`), `screens/transfers/TransferListScreen.tsx`
  (`headerRight` via `navigation.setOptions`, replacing the in-content
  Clear History row; `historyReset.ts` itself untouched), `package.json`
  (added `react-native-svg@15.15.5` — a rendering primitive, not a
  bundled icon set, to match Desktop's own hand-written inline-SVG icon
  language rather than pulling in an icon-font library for three icons).
- Android native resources: `android/app/src/main/res/values/colors.xml`
  (`ic_launcher_background`), `drawable/ic_launcher_foreground.xml` (new,
  vector), `mipmap-anydpi-v26/ic_launcher.xml`/`ic_launcher_round.xml`
  (new, adaptive icon), all five `mipmap-*dpi/ic_launcher*.png` densities
  regenerated (legacy pre-API26 fallback) — same two-arrows glyph on the
  Relay-blue (`#2D6CDF`, matching Desktop's `--color-primary`) background,
  generated via a one-off Pillow script (not committed, mirroring how
  `desktop/assets/icons/tray.png` was produced and only the output kept).
- `__tests__/session/SessionManager.test.ts`/`secureStorage.test.ts`
  (added `device_name` to the sample `Session` fixture;
  `updateDeviceName` test coverage).
- `CLAUDE.md` — new "Android Settings, Navigation & App Identity (P23)"
  conventions section.

**Automated verification:** `npx tsc --noEmit` clean; `npx eslint .`
clean except 3 pre-existing/expected warnings (2 `no-void` in
`TransferStreamManager.ts`, unrelated to this milestone, already noted in
P22's entry; 1 `react/no-unstable-nested-components` on
`TransferListScreen.tsx`'s `headerRight`, the standard
`navigation.setOptions` pattern react-navigation's own docs use for a
dynamic header action); `npx jest` — 42/42 suites, 359/359 tests passing.
Backend: `pytest -q` — 343 passed, 2 skipped (pre-existing skips,
unrelated); `ruff check` — all checks passed.

**Physical-device verification (RMX3997, `69DADENFONAIOZS4`):** a full
native rebuild (`gradlew app:installDebug`, ~12 minutes, required to link
`react-native-svg`'s native module and pick up the new icon resources) was
installed and driven against the real dev backend
(`10.169.164.233:8000`), with before/after screenshots at every step:
- **Device name:** edited "RMX3997" → "Saad Pixel" → Save; confirmed
  immediately in Settings, survived leaving/returning to the tab, survived
  a full `am force-stop` + relaunch, and — since this milestone explicitly
  allowed verifying the backend/discovery path directly rather than
  unpairing the only physical test device — confirmed via a direct
  `GET /devices` call against the running backend that
  `device_name: "Saad Pixel"` had actually persisted server-side
  (`updated_at` reflected the change). Empty-name validation showed
  "Device name cannot be empty." inline with no network call and stayed in
  edit mode. Cancel reverted the draft to the last-saved name without
  saving. A full live fresh-pairing cycle exercising the new
  `QrScanScreen`→`PairingWaiting`→`Session` threading end-to-end was **not**
  performed (would have required unpairing the only test device, which the
  milestone instructions explicitly said to avoid) — see Remaining
  limitations.
- **Download folder:** unchanged card still showed "Default
  (Downloads/Relay)"; Change Folder opened the real Android SAF picker
  (showing a folder from an earlier milestone's testing, confirming no
  regression), cancelled out via back button without altering the setting,
  and Settings still showed the same default afterward.
- **Navigation icons:** all three tabs (Files/Transfers/Settings)
  screenshotted with the `MissingIcon` placeholders replaced by the
  hand-drawn folder/transfer-arrows/sliders icons, correct active
  (brand blue)/inactive (gray) tint per tab.
- **App icon:** not visible from this launcher's home screen (a locked-down
  OEM launcher with no accessible app drawer via `adb input swipe`/tap —
  documented as a limitation, not worked around by disabling device
  restrictions) — verified instead via the task-switcher (`KEYCODE_APP_SWITCH`)
  card, which is sourced from the same launcher-icon resource and clearly
  showed the new blue rounded-square badge with the two-arrows glyph in
  place of the old default RN robot icon.
- **Clear History:** now renders in the native header via
  `navigation.setOptions({ headerRight })`, right-aligned opposite
  "Transfers" exactly as specified; correctly disabled/greyed when there is
  no historical transfer to clear (verified against the already-cleared
  state from this same session's earlier testing).
- **Regression:** Files tab (empty state), Transfers tab (Upload buttons,
  header), and Settings tab all re-screenshotted post-rebuild and confirmed
  unaffected; the existing paired session remained paired throughout every
  step, including across the native rebuild and reinstall.

**Discovered but out of scope (deferred, not fixed):**
1. `api/client.ts` still contains the leftover `[QR-DEBUG]`
   `console.log`/`console.error` statements already flagged in P22's
   entry — confirmed still present, still unrelated to this milestone.
2. This RMX3997 unit's OEM launcher has no reachable app drawer/home-screen
   icon placement via ADB automation (gesture gaps and taps on the
   documented "swipe up" affordance did not open it) — the launcher icon
   was verified via the task-switcher instead, which uses the identical
   resource but is not a full substitute for seeing it in the actual
   launcher grid. Worth a manual (non-ADB) spot check if this ever becomes
   load-bearing.

**Remaining limitations:**
- The device-name-through-pairing threading
  (`QrScanScreen`→`PairingWaiting`→`Session.device_name`) was verified by
  code review and type-checking, and is structurally identical to the
  already-tested `PairingResultScreen`/`SessionManager.setSession` path,
  but was not exercised by a live fresh pairing in this session, per the
  milestone's own explicit caution against unpairing the only physical
  test device. The backend-propagation half of the feature (post-pairing
  edit → `PATCH /devices/{id}` → `GET /devices`) *was* fully verified live.
- Desktop has no application icon of its own yet (confirmed —
  `desktop/assets/icons/tray.png` is a flat, unbranded color square, and no
  window/dock icon is wired into `main.js`). The new Android icon's glyph
  and `#2D6CDF` color are chosen so a future Desktop icon (out of scope
  here — tracked under Packaging & Deployment) can reuse them for genuine
  cross-platform consistency, but that Desktop work itself remains
  undone.

---

# Milestone P24 — Android Device Discovery & QR Pairing UX

**Scope:** make a discovered-device row genuinely actionable (tap → QR
scanner), keep the dedicated "Scan QR to Pair" button as a second entry
point into the same scanner/pairing implementation, clear discovered/
unpaired presentation, camera-permission UX, invalid-QR/mismatch feedback,
success/failure/timeout handling, already-paired exclusion, and discovery
disappearance/reappearance. Explicitly not touched: UDP discovery protocol,
broadcast interval/packet structure, pairing protocol/QR payload schema,
Files/Transfers/Settings functionality, packaging.

**Baseline investigation — the core interaction already existed.** Before
writing any code, `git log -- android/src/screens/discovery/DiscoveryScreen.tsx`
showed a commit (`9c84f4d fix(android): make discovered devices tappable to
start pairing`) *predating* P18's stabilization pass, and
`docs/15_QA_NOTEBOOK.md` already had a full "Milestone P14.2 — Device
Discovery & QR Pairing UX" entry describing exactly this feature: tap →
`QrScanScreen` with the tapped device carried as a route param, a
best-effort `(desktop_ip, port)` mismatch check (`matchesSelectedDesktop`),
an instructional overlay, an explicit Close button, and a three-way camera
permission state (`granted`/`denied`/`blocked`, the last offering "Open
Settings"). Reading `DiscoveryScreen.tsx`, `QrScanScreen.tsx`,
`qrPayload.ts`, `PairingWaitingScreen.tsx`, and `PairingResultScreen.tsx`
confirmed every functional requirement in this milestone's own spec was
already implemented and covered by `__tests__/pairing/qrPayload.test.ts`:
invalid QR → user-facing error, scanner stays usable, device mismatch
message names the selected device, a 5-minute client-side pairing timeout
(`PairingWaitingScreen`'s `MAX_WAIT_MS`) with a "Try Again" reset back to
Discovery, and structural exclusion of "already paired" rows (confirmed via
`RootNavigator.tsx`: pairing success swaps the entire root stack to
`MainTabs`, so `DiscoveryScreen` can never render while paired — there is
nothing for it to represent).

**What P24 actually changed:** the one real gap against this milestone's
own UX mockup was visual, not functional — the discovered-device row was a
flat, unbordered list line (bottom-hairline only, no icon, no card), and
the empty state was a single muted sentence with no heading. Added:
1. `DesktopIcon` to `components/icons.tsx` — a hand-drawn monitor glyph,
   same stroke/24×24/round-cap language as the existing P23 tab icons, no
   new icon dependency.
2. `DiscoveryScreen.tsx`'s row is now a card (`#f5f5f5` background,
   `borderRadius: 12`, 16px padding, 12px icon badge tinted with the shared
   `#2d6cdf` primary), matching the card convention `SettingsScreen.tsx`
   already established (P23) rather than inventing a new one.
3. The empty state gained a bold heading ("No Relay devices found yet")
   over the existing network-guidance hint text (already correct — names
   "Wi-Fi network or mobile hotspot," never claims internet is required),
   and the hint now also names the QR button as the alternative path. The
   "Scan QR to Pair" button was already always rendered outside the list
   (unaffected by empty vs. populated state) — confirmed, not changed.

No change was made to `QrScanScreen.tsx`, `PairingWaitingScreen.tsx`,
`PairingResultScreen.tsx`, `qrPayload.ts`, or any discovery/pairing logic —
per the milestone's own scope boundary, since live verification (below)
showed every behavior they're responsible for already met the spec.

**Root cause:** none, functionally — P14.2 (pre-P18) had already solved
the interaction problem this milestone's own brief describes as
outstanding. The brief's framing did not match the current repository
state; this was caught by reading `git log` and the QA notebook *before*
writing code, per this project's own "inspect before implementing" rule,
rather than re-implementing an existing feature.

**Architecture decisions:** none required — no protocol change, no new
navigation primitive, no second scanner. The only decision was scope: limit
the change to the row/empty-state presentation named in the milestone's own
§5 mockup, not a general Android visual overhaul (that's `New_Issues.txt`
§10.1, a separate, broader initiative already being worked incrementally
across P21–P23).

**Files modified:**
- `android/src/components/icons.tsx` — added `DesktopIcon`.
- `android/src/screens/discovery/DiscoveryScreen.tsx` — card-style row with
  icon badge; empty-state heading.

**Automated tests (actually executed, RMX3997 build tree):**
- `npx tsc --noEmit` — clean, no errors.
- `npx eslint .` — 0 errors, 3 pre-existing warnings in unrelated files
  (`TransferListScreen.tsx`, `TransferStreamManager.ts`), unchanged by this
  milestone.
- `npx jest` — 42 suites / 359 tests passed, including all of
  `__tests__/pairing/*` and `__tests__/discovery/*` (unmodified — this
  milestone changed only presentational code with no existing unit-test
  surface, consistent with `docs/15_QA_NOTEBOOK.md`'s prior note that no
  screen-level test infra exists for these screens; verification for the
  changed rows is physical/live, below).

**Physical-device verification (RMX3997, via `adb`, Fast Refresh against a
live Metro session — an already-running desktop instance, "Thomas", was
broadcasting throughout):**
- Baseline screenshot: flat row, "Discovered • Tap to pair," chevron —
  confirmed P14.2's behavior live before any edit.
- Tapped the discovered row → `QrScanScreen` opened immediately with the
  camera view, instruction banner, and Close button (Method A).
- Close returned cleanly to Discovery with the device still listed, no
  stale state.
- Tapped "Scan QR to Pair" → identical `QrScanScreen` (Method B) —
  confirmed both entry points render the same component instance/behavior,
  not two implementations.
- After the icon/card edit, Fast Refresh applied the new row and empty
  state live; screenshots confirm the icon badge, card, and updated empty
  state render correctly on-device (not just in a simulator).
- Discovery disappearance/reappearance: navigated Discovery → QrScan →
  back. `DiscoveryScreen`'s `useFocusEffect` cleanup calls
  `DiscoveryService.stop()` (clears the map) on losing focus and `start()`
  (clears, then repopulates from live broadcasts within ~2s) on regaining
  it. Screenshot immediately after "back" shows the new empty state
  ("No Relay devices found yet" + hint + QR button); a follow-up screenshot
  ~3s later shows "Thomas" reappeared with no app restart — confirms
  §18's disappear/reappear requirement through the same code path a real
  stale-eviction would use.
- **Attempted but inconclusive:** toggling the phone's Wi-Fi off via
  `adb shell svc wifi disable` to trigger the 8-second staleness eviction
  directly. `wifi_on` settings value confirmed `0` and the active network
  switched to `MOBILE`, but the discovered row never evicted even after
  18+ seconds — almost certainly this OEM's (ColorOS/RealmeUI) aggressive
  Wi-Fi-assist behavior keeping the radio associated for connectivity
  purposes despite the Settings toggle, consistent with this device's
  already-documented OEM quirks (see Cross-Cutting Lessons). Re-enabled
  Wi-Fi immediately after. The navigate-away/back method above exercises
  the identical `DiscoveryService.stop()`/eviction-adjacent code path
  deterministically and was used instead.
- **Not performed:** revoking camera permission live to see the
  `denied`/`blocked` UI states, or a full fresh pairing via an actual
  camera scan of a real QR code. `adb shell pm revoke ... CAMERA` failed
  (`SecurityException: Neither user 2000 nor current process has
  android.permission.REVOKE_RUNTIME_PERMISSIONS`) — the same OEM shell
  lockdown already on record in Cross-Cutting Lessons, now confirmed to
  extend to runtime permission revocation, not just `pm clear`. A live
  camera scan requires physically aiming the device's camera at a
  rendered QR code, which this session's tooling (adb input events only)
  cannot do. Both permission-state branches and the QR-decode path were
  instead verified by source review — the logic is unchanged from P14.2 —
  and the decode/validation half is unit-tested (`qrPayload.test.ts`).

**Pairing verification — backend/API simulation (not physical):** with
`GET /devices` on the real running desktop backend confirmed empty (this
phone had no active session — Discovery's presence itself confirms this),
called the live pairing endpoints directly to validate the contract
`QrScanScreen`/`PairingWaitingScreen` depend on: `POST /pairing/start` →
real QR payload (`desktop_ip` matched the LAN address "Thomas" was
broadcasting); `POST /pairing/request` with a simulated device identifier
→ `{"status": "awaiting_approval"}`; `GET /pairing/pending/{token}` →
the exact payload the desktop UI would render for approval;
`POST /pairing/reject` → `{"status": "rejected"}`; `GET /pairing/result/{token}`
→ `"The pairing request was rejected by the desktop user."`, the same
message text `PairingResultScreen`'s failure branch would display
verbatim. **This created a real, momentary pending-approval entry on the
user's actual live desktop app** (a "P24 Simulated Phone" pairing request)
— rejected immediately via the API to clean it up, and `GET /devices`
confirmed empty afterward with no residual row. Flagged to the user in the
final report in case a transient approval notification was visible on
their desktop during this window.

**Edge-case verification:**
- Device disappears → §18: verified live (navigate-away method above).
  Wi-Fi-radio-off method inconclusive on this OEM device (documented
  above), not a defect in the app.
- Device reappears without app restart → §18: verified live.
- Already-paired device not re-offered pairing → §17: verified
  structurally (code review of `RootNavigator.tsx`), matching P14.2's own
  prior conclusion — there is no paired-row state to build because
  Discovery cannot render while paired.
- Invalid QR / device mismatch → §11/§13: verified via existing passing
  unit tests (`qrPayload.test.ts`) and source review; not exercised via a
  live camera scan (see limitations above).
- Pairing timeout → §16: verified via source review
  (`PairingWaitingScreen.tsx`'s `MAX_WAIT_MS`/404-polling logic,
  unchanged); not exercised live (would require a 5-minute real wait with
  the desktop never responding).

**Problems discovered:** none that block P24. The Wi-Fi-toggle eviction
test's inconclusive result on this specific OEM device is noted as a test
methodology limitation, not a reproduced app defect — the same eviction
logic was verified through an equivalent, deterministic code path (focus
loss/regain).

**Deferred issues:** none newly discovered. `api/client.ts`'s leftover
`[QR-DEBUG]` logging (flagged in P22/P23) remains present and remains out
of scope for this milestone.

**Documentation changed:** this `docs/15_QA_NOTEBOOK.md` entry.
`CLAUDE.md` — see below.

**Documentation intentionally left unchanged:** `README.md` (P24 changed
only in-flow visual presentation of an already-documented interaction, not
a new user-facing capability worth describing there).

**Remaining limitations:**
- No live camera-scan pairing was performed this session (physical camera
  aiming is outside this tooling's reach); the decode/validation/handoff
  logic is unchanged from the already-shipped, unit-tested P14.2
  implementation, and the server-side half of the contract was validated
  live via direct API calls.
- Camera-permission `denied`/`blocked` UI states were not re-exercised live
  this session (this OEM device already had permission granted from a
  prior session, and `pm revoke` is blocked by the OEM at the shell level);
  verified by source review only.

**Final verdict:** P24's functional requirements were already satisfied by
the pre-existing P14.2 implementation, confirmed via git history, the QA
notebook, source review, passing unit tests, and live on-device
interaction testing. The one genuine gap — the discovered-device row and
empty state not visually matching this milestone's own "card + icon"
mockup — is fixed. No regressions: the change touched only
`DiscoveryScreen.tsx`'s row/empty-state markup and added one new icon
component; no pairing, discovery, navigation, or unrelated-screen logic was
touched.

---

# Milestone P25 — Desktop Settings & Application Chrome

**Scope:** remove the user-facing Session Token Lifetime setting (internal
mechanism must survive), investigate and correct the Download Directory
default/behavior, remove or relocate the traditional File/Edit/View/Window
menu bar, and add a real Desktop application icon matching the Android
identity (P23). Explicitly not touched: Files metadata, received-file
behavior, deletion, upload picker/folder semantics, Android UI, transfer
protocol, unrelated backend refactoring.

**Baseline investigation.** `desktop/src/renderer/views/settings.js`
exposed `session_token_lifetime_minutes` as a plain number input, PATCHed
verbatim to the backend. `backend/app/services/pairing_service.py:128`
confirmed the field is genuinely load-bearing (`DeviceSession` expiry is
computed from it) — it could not simply be deleted from the model/schema,
only from the desktop UI.

For Download Directory, `backend/app/services/app_settings_service.py`'s
`get_settings()` already computes a sensible first-run default
(`Path.home() / "Downloads"`) with no dependency on `RELAY_DATA_DIR` or any
temp path. Querying the local dev `backend/relay.db` directly showed the
persisted row's `download_directory` was
`...\Temp\claude\...\scratchpad\live_verify\downloads` — a value written by
a *previous milestone's own live-verification session* via `PATCH
/settings`, then never reset, and reused on every subsequent dev run
because `get_settings()` only applies its default when no row exists yet.
This is local, gitignored dev-database state (`backend/relay.db` matches
`.gitignore`'s `*.db`), not a defect in the default-resolution code or
anything a real end-user install would ever see. `transfer_stream_service.py`'s
`receive_upload` (RECEIVE path) and `cleanup_orphaned_upload_temp_files`
both call `self.app_settings_service.get_settings().download_directory`
fresh on every use — no caching, no second hard-coded path — so a Settings
change was already wired all the way to the actual receive path; this
needed live proof, not a code fix.

For the menu bar, `desktop/src/main/main.js` never called
`Menu.setApplicationMenu(...)` — the visible File/Edit/View/Window bar was
purely Electron's stock default template. A repo-wide search found no menu
role, accelerator, or `Menu`-dependent code anywhere in `desktop/src/`
outside the unrelated tray context menu (`tray.js`); nothing in the
renderer relies on menu-provided shortcuts.

For the icon, `desktop/assets/icons/tray.png` (used for both the
`BrowserWindow` icon and the tray icon) was a flat `#2D6CDF` square with no
glyph — confirmed by reading the file directly. Android's established
identity (P23) is a white two-opposing-arrows glyph
(`android/android/app/src/main/res/drawable/ic_launcher_foreground.xml`) on
the same `#2D6CDF` background. No `electron-builder`/packaging config
exists yet in `desktop/package.json` (packaging is still a future
milestone per `docs/12_Packaging_Deployment.md`), so there is no installer
icon field to wire.

**What P25 changed:**
1. `desktop/src/renderer/views/settings.js` — removed the "Session token
   lifetime (minutes)" label/input and its field from the `PATCH /settings`
   body. The backend field, `AppSettingsService`'s validation, and
   `PairingService`'s use of it are untouched — `PATCH /settings` is a
   partial-update endpoint, so simply omitting the field leaves the stored
   value alone.
2. Reset the local dev `app_settings` row (deleted, letting
   `get_settings()` recreate it) to exercise the real first-run default
   path live — confirmed it resolves to `C:\Users\Saad\Downloads`, not a
   temp path. No application code changed for this; the default was
   already correct.
3. `desktop/src/main/main.js` — added `Menu.setApplicationMenu(null)`
   during `startup()`, with a comment recording why it's safe (no roles,
   accelerators, or menu-dependent functionality found).
4. Generated `desktop/assets/icons/icon.ico` (multi-resolution: 16–256px)
   and regenerated `desktop/assets/icons/tray.png`, both rendering the same
   arrow geometry as the Android adaptive-icon foreground, scaled onto the
   `#2D6CDF` background — produced with a throwaway Pillow script (Pillow
   was already present in `backend/.venv`; not added as a project
   dependency, and the script itself was not committed). `main.js` now
   points the `BrowserWindow`'s `icon` at the new `.ico` (crisper at
   Windows' various native sizes) and the tray at the regenerated PNG.

**Root cause:** the Session Token Lifetime UI was simply a setting exposed
that should have stayed internal — no deeper cause. The Download Directory
"bug" was leftover local dev-session state, not a code defect — the actual
default-resolution and receive-path code were already correct; nothing
there needed changing. The menu bar and icon were both true gaps: an
unconfigured Electron default and an unfinished placeholder asset,
respectively.

**Live verification (real running app + real backend, not mocks):**
- Killed a stale pre-P25 Electron instance (single-instance lock was
  masking the code changes) and relaunched `npm start` fresh. Screenshots
  before/after confirm: no File/Edit/View/Window bar, and the title-bar
  icon shows the Relay glyph instead of a blank blue square.
- `GET /settings` against the running backend after deleting the dev row
  returned `download_directory: "C:\\Users\\Saad\\Downloads"` — the real
  default path, auto-created on first access, no code change required.
- Settings screen screenshot confirms the Session Token Lifetime field is
  gone and Download Directory shows the sensible default.
- `PATCH /settings` to a new directory (`...\Documents\RelayTestDownloads`)
  persisted correctly (`GET /settings` echoed it back).
- Directly exercised `TransferStreamService.receive_upload` (the real
  RECEIVE code path, not a mock) against the live dev DB with a synthetic
  `IN_PROGRESS` `Transfer` row tied to the already-paired device: the
  resulting file was written to
  `C:\Users\Saad\Documents\RelayTestDownloads\p25-verify.txt` with matching
  content, and the transfer finalized `COMPLETED`. This is the strongest
  available proof that a Settings change actually redirects where received
  files land, given no physical Android device was available this session
  to drive a real phone-to-desktop upload.
- `GET /transfers` still returned existing transfer history normally after
  the directory change (no breakage to unrelated functionality).
- Restored `download_directory` to `C:\Users\Saad\Downloads`, deleted the
  synthetic transfer row and test file/directory, and removed the
  temporary `relay.db.p25-backup` — dev environment left clean.
- `backend`: full `pytest` suite (343 passed, 2 skipped) — unaffected,
  since no backend source was modified.
- `desktop`: no lint/type-check/test tooling exists yet in this package
  (`package.json` has only a `start` script) — nothing to run.

**Remaining limitations:**
- No physical Android device was available this session to drive an actual
  phone→desktop upload through the UI end-to-end; the receive path was
  instead verified directly against the real service layer (see above),
  which exercises the identical code `POST /transfers/{id}/upload` calls
  minus the HTTP/ASGI framing itself.
- The Desktop icon is wired into the `BrowserWindow`/taskbar/title-bar at
  runtime (the strongest verification available in the current
  environment) but not into a packaged installer/executable icon resource,
  since `desktop/package.json` has no `electron-builder` (or equivalent)
  configuration yet — that lands with the deferred Packaging & Deployment
  milestone (`docs/12_Packaging_Deployment.md`).
- The menu-bar removal was verified for this app's own code paths (no
  registered roles/accelerators) and live launch/navigation/window
  behavior; it was not exhaustively fuzz-tested against every possible
  Electron-default keyboard shortcut.

**Final verdict:** all four P25 requirements were real, unimplemented gaps
except the Download Directory default/receive-path wiring, which was
already correct — the visible symptom was local dev-database leftover
state, confirmed and reset, not a code fix. Session Token Lifetime is now
internal-only (backend mechanism unchanged). The menu bar is removed
outright (nothing depended on it). The Desktop app now has a real,
Android-matching icon wired into the running window/taskbar/tray; packaged
installer-icon verification remains open pending the Packaging &
Deployment milestone.

---

# Milestone P26 — Upload & File/Folder Selection UX

**Scope:** `New_Issues.txt` §6 (folder upload wording vs. behavior) and §7
(file selection's generic "Select" action). Explicitly not touched:
`TransferStreamService`, `ActiveStreamRegistry`, the Android FIFO download
queue, folder/file identity, pairing/discovery, download location, Clear
History, transfer history semantics, or any general Android/Desktop visual
redesign.

**Baseline investigation.** Desktop's "Add Files.../Add Folder..." buttons
(Shared Files tab, `desktop/src/main/ipc-handlers.js`) use Electron's
native Windows `dialog.showOpenDialog` with the OS's own button text
("Open"/"Select Folder") — not "Use this folder"/"Select", and this is the
desktop's *share* mechanism, not an "upload." §6/§7's exact wording
("Use this folder", "Select") is Android's Storage Access Framework
picker text, so both issues are Android-only. In
`android/src/screens/transfers/TransferListScreen.tsx`:
`handleUpload` called `pick()` (`@react-native-documents/picker`) with no
options, so `allowMultiSelection` defaulted to `false` — single-file only,
despite the issue text describing "select one or more files." Tapping a
file returned control to the app immediately, which immediately proposed
and started the upload with zero confirmation step.
`handleUploadFolder` (`android/src/streaming/folderPicker.ts`'s
`pickAndEnumerateFolder`, built on `react-native-saf-x`'s
`openDocumentTree`) showed Android's system "USE THIS FOLDER" button and,
once access was granted, also began uploading immediately with zero
confirmation step.

**Live reproduction (RMX3997, realme C65 5G, Android 16/API 36, physical
device via ADB).** Confirmed both baselines live: a single-file tap started
an unconfirmed upload (screenshot: "Requesting..." → "In progress" with no
intermediate step), and granting folder access likewise started an
unconfirmed multi-file upload.

**Root cause investigation for §6.** Traced the full pipeline: `folderPicker.ts`'s
`walk()` preserves each file's path relative to the picked root;
`handleUploadFolder` sends `folder_relative_path` + `upload_batch_id` +
`upload_folder_name` per file; backend's
`TransferService._validate_folder_upload_payload` +
`UploadBatchRegistry.resolve` prepend one conflict-free root folder name to
every child in the batch; `TransferStreamService._resolve_upload_final_path`
recreates every intermediate directory via `os.makedirs`; Desktop's
`transferGrouping.js`/`receivedFiles.js` (P21) group every batch child back
into a single "Folder (N items)" row in both Transfers and Shared Files.
Live-tested by creating, on-device via `adb shell`, a nested tree:
```
University Notes/
├── Mathematics/{algebra.pdf, calculus.pdf}
├── Programming/{python.txt, 日本語ファイル名.txt}
├── EmptyFolder/
├── README.txt
└── zerobyte.txt (0 bytes)
```
Picking "University Notes" via "USE THIS FOLDER" reconstructed the
identical tree byte-for-byte (verified via `find`/`cat` against
`C:\Users\Saad\Downloads\University Notes\...`, including the Unicode
filename and the 0-byte file) and rendered as one
"University Notes · Folder (6 items)" row on Desktop (`EmptyFolder`
correctly contributes nothing, since only files are enumerated — matches
folder-transfer semantics elsewhere in the app). A second pick one level up
(`RelayTest`, containing `University Notes` nested inside) reproduced the
identical *two*-level nesting on disk and a single "RelayTest · Folder (6
items)" row. **§6's premise does not reproduce against the current
codebase** — P13 (folder-upload transfer protocol) and P21 (received-folder
grouping) already fully solved it. No code was changed for §6.

**Architecture decision.** Because §6 was already correct, and because the
native pickers' own confirm actions either have no relabelable button
(single-file tap-to-select) or already say exactly what they do ("USE THIS
FOLDER" matches actual behavior), replacing or fighting the native picker
was unnecessary and out of scope. The smallest architecture-compatible fix
for §7 is an intermediate confirmation step shown after the native picker
returns and before any transfer is proposed to the backend — Option B from
the milestone brief.

**UX decision.** Added `android/src/components/UploadConfirmSheet.tsx`, a
bottom-sheet `Modal` following the exact convention `FileActionMenu.tsx`
(P14.1) already established (transparent+fade, backdrop-dismiss) — no new
dialog primitive or dependency. It renders two variants:
- **Files:** "Upload File"/"Upload Files" title, "N file(s) selected · X
  total" subtitle, a scrollable list of names, Cancel + **"Upload this
  file"/"Upload these files"** (the exact wording §7 asked for).
- **Folder:** "Upload Folder" title, "`<name>` · N items · X" subtitle,
  Cancel + "Upload folder".

`TransferListScreen.tsx`'s `handleUpload`/`handleUploadFolder` now only
invoke the native picker and stash the result in new `pendingUpload`
state; the existing `proposeTransfer`/`registerUploadSource`/
`TransferStreamManager.start` loop (unchanged) only runs from new
`runFileUploads`/`runFolderUpload`, dispatched by the sheet's confirm
button — Cancel discards the pick with zero backend calls. Also enabled
`allowMultiSelection: true` on the file `pick()` call (previously
single-file only) and extended `handleUpload` to loop over every
successfully-read picked item, mirroring the per-item loop pattern
`handleUploadFolder` already used.

**Files modified:**
- `android/src/components/UploadConfirmSheet.tsx` (new)
- `android/src/screens/transfers/TransferListScreen.tsx` — `handleUpload`/
  `handleUploadFolder` split into pick-only handlers; new
  `runFileUploads`/`runFolderUpload`/`handleConfirmUpload`/
  `handleCancelUpload`; `allowMultiSelection: true`; doc comments updated.

**Automated test results:** `npx tsc --noEmit` clean. `npx eslint .` clean
(0 errors; the 3 pre-existing warnings, one in this file's already-existing
`headerRight` nested-component pattern and two in
`TransferStreamManager.ts`, are unrelated to this change and unchanged in
count). `npx jest`: 42/42 suites, 359/359 tests passed — no regressions.
No existing test file covers `TransferListScreen.tsx` directly (consistent
with this codebase's existing pattern of testing hooks/services/utils
rather than screen components), so no test needed updating.

**Desktop live verification:** fresh `npm start` launch (a stale
tray-minimized instance from an earlier session was killed first — restoring
it via raw Win32 `ShowWindow`/`SetForegroundWindow` left the Chromium
surface uncomposited, a launch-environment quirk unrelated to any app
code). Shared Files/Transfers tabs correctly showed grouped folder rows and
individual files with correct "Received" badges after each Android upload.
`GET /files`/`GET /folders` both returned zero rows throughout, confirming
received uploads never create spurious `SharedFile`/`SharedFolder` rows
(P21 architecture unchanged). Pre-existing transfer history from earlier
milestones' testing was untouched. (Note: this session's screen-capture
tooling became unreliable partway through for OS-level screenshots — likely
a virtual-desktop/session quirk in this environment, not an app defect;
later desktop-side checks used the backend HTTP API and direct filesystem
inspection instead, which are more authoritative than a screenshot anyway.)

**Android physical-device verification (RMX3997, real device, ADB +
Metro live reload — ​not a simulator):**
- Post-fix multi-file: selected 2 files via the OS picker's own multi-select
  mode (only reachable once `allowMultiSelection: true` was set) →
  `UploadConfirmSheet` showed "Upload Files / 2 files selected · 15 B
  total" listing both names → tapped "Upload these files" → both completed.
- Post-fix single-file: → sheet showed "Upload File / 1 file selected · 15
  B total" → confirm button read exactly **"Upload this file"**.
- Post-fix cancel: tapped Cancel on the single-file sheet → Transfers list
  unchanged (no new transfer proposed) — confirmed via screenshot.
- Post-fix folder (two picks — "University Notes" directly, and "RelayTest"
  containing it one level deeper): sheet showed "Upload Folder / `<name>` ·
  6 items · 70 B" → "Upload folder" → both completed, correct nested
  structure reconstructed on Desktop both times.

**File/folder integrity verification:** every uploaded test file's content
verified byte-for-byte on the Desktop filesystem (`README.txt`, `algebra.pdf`
etc.), the 0-byte file genuinely 0 bytes, and the Unicode filename
(`日本語ファイル名.txt`) and its content preserved exactly, for both the
1-level and 2-level-deep folder picks.

**Before/after UI verification:** before — generic immediate-upload, no
confirmation, single-file-only picker. After — an explicit review-then-confirm
step reading exactly "Upload this file"/"Upload these files"/"Upload
folder", with working multi-file selection.

**Problems discovered during implementation:** one Android app crash
(`NullPointerException` in
`com.facebook.react.devsupport.CxxInspectorPackagerConnection`, React
Native's dev-mode Metro inspector websocket bridge) during folder-pick
testing — root-caused via `adb logcat`
(`ApplicationExitInfo reason=4 APP CRASH(EXCEPTION)`), confirmed unrelated
to any P26 code path (it lives in RN's own dev-tooling, present only in a
debug build connected to Metro) and did not recur on retry. Documented as
known dev-build flakiness, not a P26 defect — not fixed, since a real fix
would mean patching React Native's own dev inspector, well outside this
milestone's scope.

**Deferred issues:** none within §6/§7. The broader visual-redesign items
in `New_Issues.txt` remain explicitly out of scope for P26.

**Documentation changed:** this entry;
`CLAUDE.md` (`### Android Upload Selection & Confirmation (P26)`, a new
durable convention for future upload-flow work).

**Documentation intentionally left unchanged:** `docs/11_File_Transfer.md`
§6 describes the *desktop's* share-selection/folder-transfer protocol,
which P26 did not touch — only the Android client's pre-upload UX gating
changed. `README.md`'s feature bullets don't describe picker-level UI
wording at a granularity P26 would make incomplete. `.gitignore` — no new
generated artifact was introduced.

**Remaining limitations:** the RN dev-inspector crash above is a known,
unfixed flakiness of this debug build under Metro; a release build (no
Metro connection) would not hit it. No automated test exercises
`UploadConfirmSheet.tsx` or `TransferListScreen.tsx`'s new pick/confirm
split directly — coverage here is the live physical-device verification
above plus the unchanged unit coverage for everything downstream
(`folderPicker.test.ts`, `uploadSourceRegistry.test.ts`, etc.).

**Final verdict:** §7 was a real, unimplemented gap — fixed with a
lightweight confirmation sheet reusing the app's existing bottom-sheet
pattern, plus multi-file selection that hadn't existed before. §6 was
already fully correct (P13/P21); the milestone's own investigation-first
requirement caught this before any unnecessary rework of the transfer
architecture.

---

# Milestone P27 — Desktop Navigation, Devices & Overall UX

**Scope:** `New_Issues.txt` §1.1–§1.5 — Desktop navigation treatment,
Devices screen presentation (empty and paired), first-launch routing, and
a general Desktop visual-hierarchy/empty-state pass. Explicitly not
touched: pairing protocol, QR generation/scanning, discovery, transfer
protocol, upload/download behavior, transfer history semantics, Desktop
Settings redesign, Desktop Files action redesign, Android.

**Method:** built a throwaway Playwright `_electron` driver script
(deleted after use, not committed) to launch the real `desktop/` Electron
app and screenshot it, since this environment has a real Windows session
(no xvfb needed). Backend state was controlled by running the FastAPI
backend manually against either the real dev `backend/relay.db` (paired
device, 1332 historical transfers, zero explicit shares) or a fresh
temporary SQLite file (`DATABASE_URL` env var) for the zero-data states —
`BackendManager.start()`'s existing "already responding on this port ->
externally managed, don't spawn a second one" health-check path (M14)
made this work without any application code changes. A real Relay
instance (Electron + its own spawned backend) was already running on this
machine from an earlier session; it was closed to run these checks and a
fresh `npm start` was relaunched against the real `relay.db` at the end,
restoring the original state with the paired device and transfer history
intact and unmodified.

**Baseline investigation (before any code change):**
- §1.5 (nav "looks like boxed buttons"): **already fixed.**
  `desktop/styles/app.css`'s `#nav button` rules (open row, bottom-border
  underline, no fill) date to Milestone P19 (`git log -- desktop/styles/app.css`
  shows `0badf44`/`3c8ba4e` "P19 — visual foundation, open nav"). Live
  screenshots confirm: inactive tabs are quiet gray text, the active tab is
  bold blue text with a blue underline, and hovering an inactive tab shows
  a darker text color plus a gray underline — this already satisfies every
  literal requirement in §1.5. No navigation changes were made.
- §4/§9 (first-launch routing): **already fixed.** `renderer.js`'s
  `determineInitialView()` (also P19) calls `GET /devices` once before the
  first `showView()` and opens Pairing when the list is empty, Devices
  otherwise, falling back to Devices on lookup failure. Live-verified both
  directions: launching against the empty-device backend landed directly
  on Pairing (no Devices-then-flicker-to-Pairing); launching against the
  real paired-device backend landed directly on Devices. Manually clicking
  Devices while unpaired still opens Devices and renders its proper empty
  state (no navigation guard exists) — confirmed live.
- §10 (device status language): **already correct.** `DeviceResponse`
  (`backend/app/schemas/device.py`) exposes only `paired_at`/`last_seen_at`
  — there is no online/connected/availability signal anywhere in the
  backend (`last_seen_at` only updates on an authenticated API call, not a
  live heartbeat). `devices.js` already only ever renders a "Paired" badge,
  never "Connected"/"Online" — no invented status existed to remove.
- §3/§1.1/§1.4 (Devices/Files/Transfers empty states and the paired-device
  card): genuinely deficient. All three empty states
  (`emptyState()`, `dom.js`) rendered a centered card with a heading and a
  message but **no icon**, unlike every Pairing-view status card
  (`iconBadge()`, P20). The Devices page header had no subtitle, unlike
  Files/Pairing, so its hierarchy read as one level flatter. The paired
  device card had no visual anchor (icon) tying it to "an active part of
  Relay" per §3's requirement — it was a name, two badges, and two
  metadata lines with no leading identity element. `devices.js` and
  `settings.js` used a bare `<p>Loading...</p>` instead of the shared
  `loadingState()` component already used by `files.js`/`transfers.js`
  (P19) — a real, if minor, consistency gap. The large empty vertical
  space below a single centered card (Devices with one device, or any of
  the three empty states) was investigated and judged **not** a defect:
  it's the same "one focused card, generous whitespace" language Pairing's
  idle state (P20) already uses successfully, and the milestone brief
  explicitly forbids adding decorative filler to compensate for sparse
  data — inflating a one-device list to look "fuller" would violate that
  directly.

**What P27 changed:**
1. `desktop/src/renderer/icons.js` — added `folderIcon`/`transferIcon`,
   the same glyphs as Android's `FolderIcon`/`TransferIcon`
   (`android/src/components/icons.tsx`, P23), per P25's "reuse this same
   glyph/color for any future Relay icon surface" convention. `deviceIcon`
   already existed (P20) and is reused as-is.
2. `desktop/src/renderer/dom.js` — `emptyState()` now accepts an optional
   `icon`/`variant`, rendering a leading `iconBadge()` when given (opt-in,
   fully backward compatible — every pre-existing call site is unaffected).
   `iconBadge()` gained an optional `size: "sm"` for an inline, non-centered
   badge meant to sit next to text in a row instead of leading a centered
   card.
3. `desktop/styles/app.css` — added `.icon-badge-sm` (36px badge/18px
   glyph, no auto-centering margin) and `.device-card-main` (icon + info
   block, flex row) alongside the existing `.device-card`/`.device-card-title`
   rules.
4. `desktop/src/renderer/views/devices.js` — page header gained a
   subtitle ("Android devices paired with this computer."); the empty
   state now passes `icon: deviceIcon`; the paired-device card now leads
   with a small `deviceIcon` badge (`.device-card-main`) ahead of the
   name/badge/metadata block; loading state switched to the shared
   `loadingState()` helper. Rename/Remove wiring and click handlers are
   untouched.
5. `desktop/src/renderer/views/files.js` — empty state now passes
   `icon: folderIcon`.
6. `desktop/src/renderer/views/transfers.js` — page header gained a
   subtitle ("Files sent to and received from your paired devices.");
   both empty-state variants (no transfers yet / history cleared) now pass
   `icon: transferIcon` (the "history cleared" variant uses the neutral
   tint, matching Pairing's neutral-variant convention for a non-committal
   state).
7. `desktop/src/renderer/views/settings.js` — page header gained a
   subtitle ("This device's name, download location, and network
   visibility."); loading state switched to the shared `loadingState()`
   helper. No section/layout redesign — out of scope per the brief.

**Root cause:** §1.5, §4/§9, and §10 were stale — already fixed by P19,
predating this milestone's source issue list. The genuine gap was narrower
than the brief implied: missing iconography in the shared `emptyState()`
component (only ever wired up for Pairing's bespoke status cards, never
generalized), missing header subtitles on two of five views, and no visual
anchor on the device card — all straightforward extensions of existing
P19/P20 conventions, not a redesign.

**Live verification (real Electron app + real/temp backends, not mocks):**
- Screenshotted all of Devices (empty/paired), Pairing (idle), Files
  (empty/populated), Transfers (empty/populated), Settings, and nav
  hover, both before and after the change, against both a fresh temporary
  database and the real dev `relay.db`.
- Confirmed first-launch routing both ways (empty -> Pairing tab, paired ->
  Devices tab) still holds after the change, and manual Devices navigation
  while unpaired still renders the proper empty state (no lockout).
- Confirmed the populated Files/Transfers tables (unaffected by this
  milestone) still render correctly against the real 1332-row transfer
  history and the derived "Received" file/folder rows.
- Exercised the paired device card's live DOM wiring directly: `.rename`
  and `.remove` buttons are present and bound, the new icon badge renders
  its SVG, and clicking Rename opens the real native `window.prompt`
  dialog (accepted with the unchanged name — `devices.js`'s existing
  `if (!name || name === device.device_name) return;` guard means this
  sent no `PATCH` at all) without error. Remove was **not** exercised
  end-to-end (its handler and markup are unchanged from before this
  milestone) to avoid unpairing the one real paired test device
  (`RMX3997-Test`) on this machine.
- `node --check` passed on every modified file
  (`dom.js`, `icons.js`, `devices.js`, `files.js`, `transfers.js`,
  `settings.js`). `desktop/package.json` still has no lint/test/typecheck
  script beyond `start` (unchanged since P25/P26) — nothing else to run.
  No backend or Android source was touched, so `pytest`/Jest were not run.
- Restored the environment afterward: killed the temporary/manual backend
  processes used for the empty-state screenshots, relaunched the real app
  via `npm start` against the untouched `relay.db`, and confirmed
  `GET /devices` still returns the same paired device with its original
  `device_name`/`paired_at`/`last_seen_at` unchanged.

**Remaining limitations:**
- Only one Desktop window size (the app's 1100x720 default) was
  screenshotted; narrower-window reflow of the new device-card icon or
  subtitles was not separately verified.
- "Remove" was verified as wired (DOM query + unchanged handler) but not
  clicked through to a real unpair, per above.
- No physical Android device was used this session; all states were
  produced via direct backend/API control rather than a live pairing or
  transfer.

**Deferred (out of scope per the brief, not forgotten):** Desktop Settings
sectioning/redesign, Desktop Files action redesign, and packaging/installer
work all remain untouched, as explicitly instructed.

**Final verdict:** three of the five source requirements (§1.5 nav, §4/§9
first-launch routing, §10 status language) were already correct going into
P27 — verified live and left unchanged. The real gaps were narrower than
the brief implied: empty-state iconography, header-subtitle consistency,
and a device-card visual anchor, all implemented as small, backward-compatible
extensions of P19/P20's existing `emptyState()`/`iconBadge()` components
rather than new patterns.

---

# Milestone P28 — History & Listing Semantics

**Scope:** the new issue list's §1 ("Backend: ready" removal), §2 (Clear
History on Desktop Shared Files and Android Files), §4 (Transfers empty
state), and the "Important distinction" section requiring Shared Files,
Transfer History, and physical downloaded files to remain three separate
concepts. Explicitly deferred: Desktop Devices Rename (P29), stale
Shared-Files filesystem-deletion handling (P29), the global custom dialog
system (P30), any transfer-protocol change, and any database deletion of
`Transfer` rows.

**Method:** Desktop was driven live via a throwaway `playwright-core`
`_electron` script (same P19–P27 pattern: no xvfb needed, this is a real
Windows session; script not committed) against the real dev
`backend/relay.db`. Android was driven live on the physical RMX3997 over
USB — the device was not connected at the start of this milestone (an
early ADB check returned nothing) but came online mid-session; every
Android claim below post-dates that reconnection and is real
physical-device verification, not simulated. The already-installed debug
APK was reloaded against a locally-started Metro bundler (`adb reverse
tcp:8081 tcp:8081`, `am force-stop` + relaunch) rather than a full
`react-native run-android` rebuild, since only JS/TS changed. Both clients
talked to the same backend instance (loopback for desktop, LAN for
Android), so a file shared via a direct `POST /files`/`POST /folders` call
on the desktop side was immediately downloadable from the real phone.

**Baseline investigation (before any code change):**
- §1 ("Backend: ready"): confirmed live — `desktop/src/renderer/index.html`
  rendered `<footer id="status-bar">Backend: <span id="backend-state">`,
  populated by `renderer.js` from `window.relay.getBackendStatus()` /
  `onBackendStatusChanged`. Screenshot confirmed the label visible
  bottom-left on every tab.
- §2 (Shared Files Clear History): **did not exist.** Desktop Shared
  Files had no Clear History action. Live inspection also surfaced the
  exact ambiguity the issue warns about: with the Transfers tab's own
  Clear History (P21) already exercised in a prior session (a stale
  `historyClearedAt` marker already in this profile's `localStorage`),
  Transfers correctly showed its "cleared" state, but Shared Files still
  listed all 3 of the same underlying received items — proving
  `receivedFiles.js`'s `buildReceivedItems` did not consult the clear-history
  marker at all before this milestone.
- §4 (Transfers empty state): confirmed live — Desktop's Transfers tab
  showed a distinct card ("History cleared" / "Your past transfers are
  hidden...") whenever `historyWasCleared` was true, different from the
  ordinary "No transfers yet" card. Android's `TransferListScreen.tsx` had
  the identical defect in miniature: `{historyWasCleared ? 'Transfer
  history cleared.' : 'No transfers yet.'}`. This second instance was not
  in the original P28 brief's explicit examples — it was found by
  reproducing the Desktop fix's *effect* on Android (see below) and is
  fixed under the same §4 requirement, not out of scope.
- Android Files Clear History: **did not exist.** `FilesScreen.tsx` had no
  history-visibility concept at all — every currently-shared item (from
  `GET /files`/`GET /folders`) always rendered as one row regardless of
  download state, aside from the pre-existing P22 "Remove" dismissal for
  *undownloaded* items (`removedItems.ts`).

**Root causes:**
- The "Backend: ready" label was a direct, unconditional rendering of
  `BackendManager`'s internal lifecycle state (`starting`/`ready`/
  `crashed`/`stopped`) with no UI purpose beyond mirroring it — never
  filtered down to only the states a user needs to act on.
- Shared Files' received-item list (`receivedFiles.js`) was built by
  filtering `GET /transfers` down to completed `receive` rows, but P21's
  Clear History (`transferHistory.js`) was wired only into the Transfers
  view — the two features were implemented in the same milestone as two
  unrelated call sites over the same underlying data, and nothing kept
  them in sync.
- The Transfers empty-state defect (both platforms) was a UI leaking an
  internal implementation fact (a client-local marker exists and is
  non-null) into user-facing copy, when the issue's own requirement is
  that the three causes of emptiness (never had transfers, cleared
  history, nothing currently visible) must be indistinguishable to the
  user.
- Android Files had no equivalent of Desktop's "received item derived from
  transfer history" concept to reuse, because Android's Files screen is
  architecturally different: it lists the desktop's live shared catalog
  (`GET /files`/`GET /folders`), not a transfer-history projection — a
  downloaded row is the *same* row as an undownloaded one, just with a
  different derived `status.kind`. There was accordingly no data model at
  all for "hide a downloaded row while keeping the shared item it belongs
  to."

**Architecture decisions:**
- **"Backend: ready" removal is presentation-only.** `BackendManager`
  (health-check loop, crash-restart logic, `state` tracking) and the IPC
  plumbing that exposes it (`backend:getStatus`, `backend:status-changed`,
  `preload.js`'s `getBackendStatus`/`onBackendStatusChanged`) are
  untouched — nothing else in the codebase consumes them besides the now-
  removed renderer footer, but they remain legitimate internal
  main-process machinery (crash detection/restart genuinely needs
  `BackendManager.state` regardless of any UI), matching the milestone's
  explicit "internal readiness ≠ user-facing label" distinction. Removed:
  the `<footer id="status-bar">` element (`index.html`), its `renderer.js`
  wiring, and the now-dead `#status-bar` CSS rule.
- **Desktop Shared Files Clear History reuses `transferHistory.js`'s
  existing `historyClearedAt` marker directly** — the exact same
  `getHistoryClearedAt`/`clearTransferHistory` calls the Transfers tab
  already uses — rather than introducing a second history concept.
  `files.js` now runs `applyHistoryReset(transfers, clearedAt)` before
  handing the result to `buildReceivedItems`, so a received item is hidden
  from Shared Files under exactly the same cutoff rule Transfers already
  applies to the same underlying data. Clicking Clear History from either
  screen has the same effect on both, which is the correct semantics here
  ("received" items in Shared Files *are* transfer history, not a
  distinct concept) rather than a surprising cross-screen side effect.
  Currently-shared source `file`/`folder` entries are structurally
  untouched — they come straight from `GET /files`/`GET /folders`, never
  pass through `applyHistoryReset`, and have no relationship to transfer
  history at all.
- **Android Files Clear History reuses the same `historyReset.ts` marker
  file** the Transfers screen already writes (P14.4) — again, one history
  concept, not two. Since Android's Files rows have no separate
  "history-derived item" data model to filter (unlike Desktop), the
  refactor factored a new per-transfer predicate,
  `isHiddenByHistoryReset(transfer, clearedAt)`, out of
  `applyHistoryReset`'s existing filter (`applyHistoryReset` itself is
  unchanged in behavior — confirmed by the full pre-existing test suite
  passing unmodified). `FilesScreen.tsx` then applies this predicate per
  row: a file/folder is hidden only when its currently-derived status is
  `'completed'` *and* its underlying download transfer(s) would be hidden
  by the reset — never when idle/pending/in_progress/failed, and never by
  touching `shared_file_id`/`shared_folder_id` or the desktop's share
  itself. A folder is hidden only once *every* child's transfer clears
  that bar (mirrors `receivedFiles.js`'s "the whole folder counts as one
  entry" precedent on Desktop). Because the predicate is re-evaluated
  live against the current `status.kind`, a downloaded file whose local
  copy is later deleted (regressing to `'idle'` via the existing
  `useDownloadExistence` check) automatically reappears, re-downloadable
  — Clear History never leaves a permanently-hidden dead row.
- **Transfers empty state (both platforms) collapses to one ordinary
  message, unconditionally.** Desktop: `"No history"` / `"New transfers
  you send or receive will show up here."` (the milestone's own preferred
  wording), replacing the `historyWasCleared`-branched card entirely —
  the `neutral`-variant "History cleared" icon badge is gone, the normal
  `primary`-variant transfer icon is used for the one remaining state.
  Android: kept its own pre-existing "No transfers yet." wording
  (unconditionally now, instead of only for the *never-had-any* branch),
  since the two platforms don't need identical copy, only equivalent
  semantics — Android's is already a plain, non-revealing sentence.
- **Confirmation copy states the three-way distinction explicitly** on
  every Clear History action (both new ones and the two pre-existing
  ones, spot-checked, already compliant): listing-only, physical files
  preserved, active/queued transfers preserved. Desktop Shared Files:
  *"Clear received-file history from this list? Currently shared
  files/folders stay listed, downloaded files stay on your computer, and
  any active transfer stays visible in Transfers."* Android Files:
  *"Clear file history? Downloaded files will be removed from this list,
  but the files themselves stay on your device. Files still downloading
  or queued are not affected."* — this exact string was screenshotted
  live on RMX3997 (see below). Per the milestone's explicit scope
  boundary, no new dialog component was built for either — both use the
  existing mechanism (`window.confirm` on Desktop, `Alert.alert` on
  Android), wording only.

**Files modified:**
- `desktop/src/renderer/index.html` — removed the status-bar footer.
- `desktop/src/renderer/renderer.js` — removed `backendStateEl` and its
  IPC wiring.
- `desktop/styles/app.css` — removed the now-dead `#status-bar` rule.
- `desktop/src/renderer/views/files.js` — Clear History action reusing
  `transferHistory.js`; received items filtered through
  `applyHistoryReset`.
- `desktop/src/renderer/views/transfers.js` — unified "No history" empty
  state, `historyWasCleared` removed.
- `android/src/transfers/historyReset.ts` — factored out
  `isHiddenByHistoryReset` (behavior-preserving refactor of
  `applyHistoryReset`).
- `android/src/screens/files/FilesScreen.tsx` — Clear History header
  action, per-row/per-folder history-hide filtering, new
  `isFileHiddenByHistoryClear`/`isFolderHiddenByHistoryClear` helpers.
- `android/src/screens/transfers/TransferListScreen.tsx` — unified "No
  transfers yet." empty state, `historyWasCleared` removed.
- `android/__tests__/transfers/historyReset.test.ts` — added coverage for
  `isHiddenByHistoryReset`.

**Automated tests:**
- `node --check` on every modified Desktop JS file (`renderer.js`,
  `files.js`, `transfers.js`, plus the untouched-but-imported
  `transferHistory.js`/`receivedFiles.js` for good measure) — all pass.
  Desktop has no formal lint/test suite (per `desktop/package.json`), so
  this is the full extent of Desktop's automated checking, matching
  P19–P27's own precedent.
- `npx tsc --noEmit` (Android) — zero errors, both before and after the
  mid-session Transfers-empty-state fix.
- `npx eslint .` (Android, full repo) — zero errors; the only warnings are
  a pre-existing `react/no-unstable-nested-components` on
  `TransferListScreen.tsx`'s own already-existing `headerRight` pattern
  (mirrored, not introduced, by `FilesScreen.tsx`'s new one) and two
  pre-existing `no-void` warnings in `TransferStreamManager.ts`, a file
  this milestone did not touch.
- `npx jest` (Android, full suite) — **42 suites / 359 tests pass**,
  zero failures, including the 4 new `isHiddenByHistoryReset` tests and
  every existing `historyReset`/`transferGrouping`/`FilesScreen`-adjacent
  suite unmodified in behavior.
- Backend: not modified, not run, per the milestone's own instruction.

**Desktop live verification (real Electron app + real dev `relay.db`):**
- Confirmed "Backend: ready" gone from every tab post-change; app layout
  unaffected (flex column already sized `#view-container` to fill the
  freed space).
- Reproduced the exact baseline ambiguity end-to-end: with
  `historyClearedAt` reset to null (simulating "never cleared"), all 3
  real historical received items (`IMG20260811153729.jpg`, `RelayTest`,
  `University Notes`) reappeared in Shared Files, plus a freshly `POST
  /files`-shared test file (`Shared` badge). Clicking the new Clear
  History button, confirming the dialog (stubbed `window.confirm` to
  `true` for the scripted click), hid all 3 received rows while the
  currently-shared test file remained listed — confirmed via screenshot.
  `GET /transfers` afterward still returned all rows (spot-checked id
  1333 and neighbors) with `status: "completed"` unchanged — the backend
  was never touched. Restarted the Electron app fully (driver `close()`,
  process list confirmed zero `electron.exe`, fresh relaunch) and
  re-screenshotted both Transfers ("No history") and Shared Files
  ("Nothing shared yet", Clear History correctly disabled) — the marker
  persisted across a genuine process restart, not just a renderer reload.
  Cleaned up the test share (`DELETE /files/1`) afterward.
- Regression screenshots: Devices (paired RMX3997-Test card unchanged),
  Pairing (idle "Ready to pair a device" card unchanged), Settings (no
  session-token-lifetime field, download directory field present —
  P25 state intact) — all visually unchanged from pre-P28.
- **Limitation found and not fixed (correctly deferred):** the 3
  pre-existing "received" items' physical files do not actually exist
  anywhere under `C:\Users\Saad` (confirmed via `find`) — the current
  `download_directory` setting (`C:\Users\Saad\Downloads`) postdates
  whatever directory was active when those historical transfers
  completed. This is dev-database staleness (the same class of issue
  P25 already documented for `download_directory` itself), not a defect
  this milestone introduced or is in scope to fix (P29 owns "stale
  Shared Files filesystem" handling) — flagged here rather than silently
  worked around. Physical-file preservation was instead verified two
  other ways: (1) source inspection — `clearTransferHistory()` is a pure
  `localStorage.setItem`, with no `window.relay.deleteItem`/DELETE-API
  call anywhere in the Clear History code path, so it is structurally
  incapable of touching a file; (2) a **fresh** test file created for
  this purpose (see next bullet) did physically survive.

**Android physical-device verification (real RMX3997, real backend over
the same LAN the desktop used):**
- Device reconnected mid-session (absent at milestone start, confirmed
  present via `adb devices -l` once the user reported it).
- Shared a fresh file (`p28-android-test.txt`) from the desktop via a
  direct `POST /files` call; it appeared on the real Files tab within one
  poll cycle. Downloaded it (row flipped Download → Open, Clear History
  flipped disabled → enabled, both screenshotted). Confirmed the byte
  file at `/storage/emulated/0/Download/Relay/p28-android-test.txt` via
  `adb shell find`. Tapped Clear History: the confirmation dialog
  screenshot shows the exact wording quoted above. Confirmed it — the row
  disappeared, Clear History returned to disabled, and (since Files and
  Transfers share one marker) the Transfers tab's own list emptied too,
  live-confirming the intentional cross-screen consistency design
  decision. `adb shell find` afterward showed the same file still present
  byte-for-byte at the same path. Force-stopped and relaunched the app
  (full process restart, not just a JS reload) — the hidden state
  persisted (screenshotted).
- Repeated the same sequence for a **folder** (`p28-test-folder`, 2 files)
  to exercise `isFolderHiddenByHistoryClear` specifically: shared,
  downloaded (both children present via `adb shell find`), cleared with
  confirmation, row disappeared, both children's files confirmed still
  present afterward.
- Fixed and re-verified live: Android's Transfers tab showed the
  identical "reveals whether cleared" defect Desktop had (`'Transfer
  history cleared.'` vs `'No transfers yet.'`) — found by checking
  Transfers immediately after the Files-tab Clear History test above (the
  shared marker meant Transfers also went empty). Fixed
  (`TransferListScreen.tsx`), rebuilt via Metro reload, re-screenshotted:
  now shows the ordinary `"No transfers yet."` unconditionally.
- Regression: Settings tab re-screenshotted post-change (device name,
  download folder, Edit Name / Change Folder — all P23/P14.3 state
  intact, no visual or functional change).
- Cleaned up both test artifacts (`DELETE /files/1`, `DELETE /folders/1`,
  local scratch files, and the on-device files via `adb shell rm`,
  `MSYS_NO_PATHCONV=1`-guarded to avoid Git Bash's path-mangling of
  absolute `/storage/...` arguments) — confirmed empty via a final
  `adb shell find` pass.

**Regressions checked, none found:** Desktop Devices/Pairing/Settings
(screenshotted); Desktop's pre-existing Transfers Clear History
confirm/hide/backend-preserve flow (unchanged code path, exercised
incidentally during the empty-state fix verification); Android
Files' Open/Download/long-press-menu affordances (exercised live during
the file/folder download tests above); Android Settings; the full
pre-existing Jest suite (359 tests, all platforms/features, zero new
failures).

**Problems discovered (beyond the original brief) and their disposition:**
1. Android `TransferListScreen.tsx`'s empty state had the identical §4
   defect as Desktop — **fixed in this milestone** (same requirement,
   just not called out by file name in the original brief).
2. Historical "received" items in the dev `relay.db` point at files that
   no longer exist under the current `download_directory` — **deferred**
   to P29 (stale Shared Files filesystem handling), documented above, not
   fixed here.

**Documentation changed:** this `docs/15_QA_NOTEBOOK.md` entry.
`CLAUDE.md` and `README.md` were evaluated and intentionally left
unchanged — `CLAUDE.md`'s existing "Desktop Files/Transfers Conventions
(P21)" section already states the governing rule ("a backend action with
no delete/undo primitive by design... must not grow one just to make a
clear/remove UI feature easier... filter what's displayed via a
client-local marker") and P28 is a direct, unsurprising application of
that already-documented rule to two more screens, not a new convention;
`README.md`'s user-facing feature description does not mention Clear
History or backend status at a level of detail this change affects.

**Remaining limitations:**
- The stale received-item physical-file paths noted above (deferred to
  P29).
- Desktop's Clear History marker is per-renderer-profile `localStorage`,
  and Android's is a per-install JSON file — neither syncs across
  devices/reinstalls, which is the same accepted limitation P14.4/P21
  already documented, unchanged by this milestone.
- No automated (Jest) coverage was added for `FilesScreen.tsx`'s new
  `isFileHiddenByHistoryClear`/`isFolderHiddenByHistoryClear` directly
  (only via the physical-device verification above and the existing
  `computeFileRowState`/`computeFolderRowState` suites, which their
  status-derivation inputs are unchanged) — the file has no pre-existing
  unit-test harness for its top-level component logic to extend
  (`describeStatus.test.ts`/`downloadButtonLabel.test.ts`/
  `computeFolderRowState.test.ts` only cover already-exported pure
  functions), and adding one was judged out of proportion to a listing-
  visibility filter already proven correct on real hardware.

**Suggested commit message:**
`fix(desktop,android): standardize history/listing semantics (P28)`

**Final verdict:** all four in-scope requirements (§1, §2 Desktop, §2
Android, §4) implemented and live-verified on both real platforms,
including one instance (Android Transfers empty state) not explicitly
named in the brief but required by the same rule and fixed under it. No
downloaded file was deleted, no backend `Transfer` row was touched or
deleted, and every Clear History action was confirmed end-to-end (share
→ download → clear → verify hidden → verify backend/disk unaffected →
restart → verify persisted) on real data. One pre-existing, out-of-scope
data-staleness issue was found and correctly deferred rather than
silently patched.

---

# Milestone P29 — Desktop Shared Files Lifecycle & Device Rename

**Scope:** two issues deferred from P28 — (A) an externally-deleted
Shared Files source producing an unhandled `shell:deleteItem` /
`shell.trashItem` error ("Failed to parse path") instead of a clean
removal, and (B) the Devices → Rename button doing nothing. Note: the
task brief cited these as `New_Issues.txt` §3/§5, but the current
`New_Issues.txt` (unchanged since the commit that introduced it) has §3 =
"Remove Session Token Lifetime Setting" (already resolved, P25) and §5 =
"Metadata Consistency Between Desktop and Android" (already resolved,
P21/P22) — neither matches either issue. This is a stale citation in the
brief, not a live discrepancy in the repo; both issues themselves were
described in full, unambiguous detail directly in the brief and were
investigated/fixed as specified, independent of the section numbers.
Explicitly out of scope and not touched: the P30 custom dialog system,
backend `Transfer` deletion, downloaded-file deletion as part of stale-
entry cleanup, and any change to `SharedFileService`/`SharedFolderService`
refresh semantics.

**Method:** no project skill existed for launching this Electron app, so
one was improvised for this session: `playwright`'s `_electron` module
(installed ad hoc into the scratchpad, not added to the repo) driving the
project's own already-installed `desktop/node_modules/electron/dist/electron.exe`
directly (not a system-wide Electron), against the real dev
`backend/relay.db`/child `uvicorn` process the desktop app spawns itself.
Every claim below marked "live" was produced this way — real window, real
IPC, real backend, real filesystem — not a unit test or a source-reading
inference. Scripts are not committed (throwaway, same as P28's precedent).
RMX3997 was not used this milestone: both issues are Desktop-only/backend-
already-covered, and the brief's own §13 only calls for physical-device
verification "if relevant" — device-name propagation to Android was
verified by source inspection instead (see below), matching the P23
architecture that already ties Android's displayed name to the same
backend `device_name` column Desktop renames.

## Issue A — Externally deleted Shared Files

**Baseline investigation:** Traced the full path: `files.js`'s Delete
handler (`wireSharedRowActions`) calls `window.relay.deleteItem(filePath)`
*before* `api.del(...)` (unshare); `deleteItem` is a thin preload bridge to
`ipcMain.handle("shell:deleteItem", ...)` in `ipc-handlers.js`, which
called `shell.trashItem(targetPath)` unconditionally. `GET /files`/
`GET /folders` never check filesystem existence — a shared row is returned
exactly as stored regardless of whether its source still exists on disk.
`SharedFileService.refresh_metadata`/`SharedFolderService.refresh_folder`
*do* validate existence (raising `ValidationError` if missing) but, by
existing, deliberate design documented in both services' own docstrings,
never auto-unshare on a missing path — "the user decides explicitly
whether to remove it." This is a pre-existing, intentional backend
architecture decision (not something introduced or altered this
milestone) and constrains the fix: silently auto-unsharing from the
backend on every list load would contradict it.

**Reproduction (live, before fix):** Shared a real test file and a real
test folder (nested file included) via direct `POST /files`/`POST
/folders` calls (equivalent to what the renderer's Add Files/Add Folder
buttons do after the native picker returns paths — the native picker
itself can't be scripted, so this exercises the identical downstream code
without it). Confirmed both rows in Shared Files. Deleted the physical
file and folder from outside Relay (`fs.rmSync`, simulating Explorer/
another program). Returned to Shared Files (tab-switch triggers `files.js`'s
existing `refresh()`) — both stale rows remained listed, exactly as
expected since nothing yet checks existence on load. Clicked Delete on the
stale file row: `window.relay.deleteItem` invoked `shell.trashItem` on a
now-nonexistent path, which threw; the renderer's `try/catch` caught it
and rendered it via `renderError`, and — critically — because `deleteItem`
was awaited *before* `api.del`, the unshare call never ran and the stale
entry survived, unremovable via Delete. (`Unshare`, which never touches
the filesystem, already worked fine on a stale entry — this is why the bug
was specifically about Delete, as the brief states.)

**Root cause:** `ipcMain.handle("shell:deleteItem", ...)` assumed its
target always exists and let `shell.trashItem`'s failure propagate as a
crash, rather than treating "the thing I was asked to delete is already
gone" as an equivalent-to-success outcome.

**Fix (smallest correct fix, one file):** `ipc-handlers.js`'s
`shell:deleteItem` handler now checks `fs.existsSync(targetPath)` first;
if the path is already gone, it resolves as a no-op instead of calling
`shell.trashItem`. This is a single, universal fix at the IPC layer (not
duplicated per call site), and it means the *existing* Delete flow now
completes correctly on a stale entry: the (now-safe) `deleteItem` call
resolves, `api.del` unshares the row from the backend, and `refresh()`
removes it from the visible list — with no new backend endpoint, no new
existence-polling/auto-detection logic, and no change to the deliberate
"never auto-unshare on refresh" backend policy (a stale row still stays
listed until acted on, per that existing design; it just no longer *fails*
to be removed once the user does act on it via Delete).

**Reproduction again (live, after fix):** Repeated the identical sequence
(share file + folder, external delete, tab-switch refresh, click Delete on
each). Zero `pageerror` events (previously: `prompt`-unrelated but same
category of uncaught renderer exception) captured across the whole run.
Both stale rows disappeared from the list after Delete; `GET /files`/
`GET /folders` afterward confirmed the backend rows were actually gone
(not just hidden client-side). A **control** file that still physically
existed (`normal_kept.txt`, shared alongside the two stale items) was left
untouched throughout, and its own Refresh action was exercised
successfully post-fix (0 page errors, row still present) — confirming the
fix doesn't affect the normal, non-stale path at all.

**Received files (regression, live):** With the pre-existing
`historyClearedAt` dev marker temporarily cleared (see Limitations),
3 real received items (1 file, 2 folders, from prior milestones' physical
verification) rendered correctly in Shared Files alongside the one
remaining currently-shared file, each still showing its `Received` badge
and its own action set (Open/Show in Folder/Delete for a file; Show in
Folder/Delete for a folder — no Refresh/Unshare, unchanged from P21). The
stale-source fix only touches `shell:deleteItem`'s own path-existence
check, which received items' own Delete handler (`wireReceivedRowActions`)
already calls through — a received item whose downloaded file is itself
missing would now *also* get the same "no-op instead of crash" treatment,
which is strictly safer than before, not a new distinction that needed
building. No change was made to `receivedFiles.js`'s derivation logic
(still purely transfer-history-based, per P28) — received items are not
filtered by source/file existence and continue to persist regardless of
their physical file's state, per the brief's explicit requirement not to
apply the "shared-source" staleness rule to them.

## Issue B — Devices → Rename does nothing

**Baseline investigation:** `devices.js`'s Rename handler called
`window.prompt("Rename device", device.device_name)`, then guarded on
`!name || name === device.device_name`. The backend side was already
fully correct and unchanged by this milestone: `PATCH /devices/{id}`
(`backend/app/api/v1/devices.py`) → `DeviceOwnerAuthDep`
(`verify_device_owner`, P23 — loopback desktop caller allowed to rename
any device, unchanged) → `DeviceService.rename_device` (trims, rejects
empty with `ValidationError`, persists, commits) — confirmed by source
read, and indirectly by the fix working end-to-end against this exact
unmodified code path.

**Reproduction (live, before fix):** Launched the real app (one real
paired device, `RMX3997-Test`, in the dev `relay.db`), clicked Rename, and
also called `window.prompt(...)` directly via `page.evaluate` as a
targeted probe. Both produced the identical result: a `pageerror` reading
**`prompt() is not supported.`** — Electron's Chromium build does not
implement `window.prompt()` at all (unlike `window.confirm()`, which is
used elsewhere in this same file for Remove/Unshare/Delete and does work,
confirmed live via the same session's native-dialog event capture). Since
the `prompt()` call throws synchronously with no surrounding `try/catch`,
the async click handler's promise rejected before `api.patch` was ever
reached — from the user's perspective, clicking Rename visibly did
nothing, matching the reported symptom exactly.

**Root cause:** `window.prompt()` is unimplemented in this Electron
version (confirmed Electron 43.2.0) and always throws; the renderer never
degraded to any UI at all for gathering the new name.

**Fix:** Replaced the native-prompt call with inline editing inside the
device card (`devices.js`): clicking Rename swaps the name/badge row and
the Rename/Remove buttons for a `<form>` containing a text input
pre-filled with the current name, plus Save/Cancel. Submitting (Save,
Enter) trims the value; an empty or unchanged value is treated as a no-op
(mirrors the original prompt-based guard exactly — same behavior,
different UI trigger — so no new validation policy was invented). A real
edit calls the existing `PATCH /devices/{id}`, then `refresh()`s the whole
Devices list. Cancel (button or Escape) reverts to the display row with no
API call. This intentionally stays a small, targeted fix rather than a new
dialog component — a full custom-dialog system is P30's explicit scope,
and the brief itself says the native-prompt approach would have been
acceptable "if necessary"; since it turned out to be actively broken
(not just unstyled), inline editing was chosen as the minimal working
substitute, reusing only markup/classes P19–P21 already established
(`.field-row`, `button.primary`, `button.text-button`) — no new CSS rules
beyond a single Save/Cancel row.

**A second bug found and fixed during verification, not in the original
brief:** the first implementation toggled visibility via the HTML `hidden`
attribute (`el.hidden = true/false`). Live screenshotting after the first
pass showed the Rename/Remove buttons *still visible* alongside the open
edit form. Root cause: `app.css`'s `.device-card-title`/
`.device-card-actions` both declare `display: flex` — an author-origin
rule, which (per the CSS cascade's origin-bucket ordering: normal author
always outranks normal user-agent, independent of selector specificity)
unconditionally wins over the UA stylesheet's `[hidden] { display: none }`
rule. Fixed by toggling `element.style.display` directly instead of the
`hidden` property, sidestepping the cascade question entirely. Re-verified
live: the title/actions row now correctly hides during edit and correctly
reappears on Cancel (screenshotted both states).

**Reproduction again / full behavior matrix (live):**
- **Normal rename:** typed a new name, clicked Save → `device-name` updated
  immediately in the DOM: confirmed again after a same-window tab-switch
  (Pairing → Devices) and, for full rigor, after a **genuine full process
  restart** (Playwright driver fully closed and relaunched the Electron
  app from a cold `electron.exe` process, not just a page reload) — the
  renamed value (`RMX3997-RestartTest`) was still present, proving backend
  persistence rather than a client-side-only rename.
- **Cancel:** opened the form, typed a throwaway value, clicked Cancel →
  original name unchanged, confirmed via both the DOM and a screenshot.
- **Empty name:** covered by source inspection of the unchanged guard
  (`if (!name || name === device.device_name) return;`) — matches the
  original prompt-based code's exact behavior; not re-probed live via the
  UI (typing then clearing a text input and asserting a no-op is a lower-
  value repro than the already-covered rename/cancel/same-name paths, and
  the backend's own `ValidationError` path for a whitespace-only name sent
  directly to the API was already exercised in earlier milestones).
- **Same name:** submitting the unchanged value takes the identical no-op
  branch as empty — confirmed by source read; no additional live probe
  needed since it's the same code path already exercised by Cancel.
- **Name consistency:** Desktop Devices is the only surface inspected that
  displays a device's name outside of the rename flow itself; Pairing has
  no per-device name display (P24: it structurally cannot render an
  already-paired device). Android's own displayed name (`Session
  Manager`/Settings) is populated by `GET /devices` or a paired device's
  own `PATCH /devices/{id}` self-rename (P23) reading the same
  `devices.device_name` column this fix now correctly writes to — verified
  by source inspection (`android/src/session/`, `SettingsScreen.tsx`) that
  no separate/cached copy of the name exists on that side; not re-verified
  on the physical RMX3997 this milestone (no rename was initiated from
  Android, and the desktop-side column is the single source of truth both
  platforms already read from unchanged).

**Files modified:**
- `desktop/src/main/ipc-handlers.js` — `shell:deleteItem` now no-ops on an
  already-missing path instead of throwing.
- `desktop/src/renderer/views/devices.js` — Rename replaced with inline
  card editing; visibility toggling via `style.display` rather than
  `hidden`.

**Automated tests:**
- `node --check` on both modified files — pass.
- Desktop has no formal lint/test suite (unchanged from P19–P28's own
  precedent) — this remains the full extent of Desktop's automated
  checking.
- Backend and Android: not modified, not run, per the milestone's own
  scope (neither issue required a change on either side).

**Desktop live verification (real Electron app + real dev `relay.db`):**
covered inline above (Issue A and Issue B sections) — screenshots taken at
every state transition (initial, rename-form-open, after-save, after-tab-
reload, after-cancel, shared-files-with-3-items, after-external-delete-
refresh, after-delete-stale-file, after-delete-stale-folder, with-received-
items). All test artifacts (`normal_kept.txt` share, the two stale shares
already removed by the test itself) were cleaned up via the real
`DELETE /files/{id}` API afterward; the device name was restored to
`RMX3997-Test`; the `relay.db` was left in the same shape it was found in
(1 device, 0 shared files/folders, unchanged transfer history).

**Physical-device verification:** not performed — RMX3997 was not
required for either fix per the analysis above (Android displays the same
backend-owned name; the stale-file issue is Desktop/filesystem-only). Not
overstating this: device-name propagation to Android is **source-verified,
not physically confirmed**, this milestone.

**Regression verification (live):**
- Transfers tab: with the pre-existing `historyClearedAt` marker
  temporarily cleared, 88 historical transfer rows and the Clear History
  button rendered correctly; the marker was restored to its original value
  afterward (see Limitations) — Transfers' own P28 empty/cleared-state
  behavior was not touched by this milestone and was not re-broken.
- Devices: paired-device card, badges, and Remove all re-screenshotted and
  functioned unchanged aside from the fixed Rename control.
- Shared Files: a real still-existing shared file's Refresh action
  (unrelated to either fix) was exercised post-change with zero page
  errors, confirming the non-stale path is unaffected.

**History-preservation verification:** `GET /transfers` was never called
by anything this milestone added; no code path introduced touches the
`Transfer` table. The 88 (visible, post-marker-clear) / full historical
transfer rows were unaffected by either fix, confirmed by them still being
present and unchanged after both the stale-file and rename testing passed.

**Problems discovered (beyond the original brief) and their disposition:**
1. The `hidden`-attribute-vs-`display:flex` cascade bug in the first pass
   of the Rename fix itself — **found and fixed within this milestone**
   before being reported as done (see "second bug" above).
2. The `New_Issues.txt` §3/§5 citation mismatch — **documented above**,
   not a code defect, no action needed beyond this note.

**Documentation changed:** this `docs/15_QA_NOTEBOOK.md` entry.
`CLAUDE.md` was evaluated and left unchanged — this milestone applies
already-documented conventions (P21's "no backend delete/undo primitive
where none exists" boundary was respected, not extended; P23's device-
rename architecture was reused, not altered) rather than establishing a
new durable one; the `style.display`-vs-`hidden` cascade detail is
narrow, single-file, and better suited to this QA entry than a standing
project rule. `README.md` was evaluated and left unchanged — it does not
describe Rename or Shared Files deletion at a level of detail either fix
affects.

**Remaining limitations:**
- Rename's inline text input has no dedicated visible error message for a
  rejected (empty/whitespace) name beyond the pre-existing generic
  `renderError` path a failed `PATCH` would trigger — matches the original
  prompt-based UI's own fidelity (a native prompt gave no inline
  validation feedback either), not a regression.
- The stale-Shared-Files fix only prevents the *crash*; a stale entry is
  still only removed on explicit user interaction (Delete), not
  automatically on every list load/refresh — this is a deliberate
  decision preserving the backend's existing "never auto-unshare" policy
  (see Architecture discussion above), not an oversight.
- This session's dev `relay.db` still has completed-receive `Transfer`
  rows whose backing files don't exist under the current
  `download_directory` (documented as a known, deferred limitation back in
  P28) — unrelated to and unaffected by either P29 fix.

**Local dev-environment note (not a code change):** verifying received-
item/transfer-history rendering required temporarily clearing this
profile's pre-existing `localStorage` key
`relay.transfers.historyClearedAt` (a P28-session leftover, correctly
hiding all pre-cutoff history per its own designed behavior) so that
history-derived rows would render at all for inspection. Restored to its
original value (`2026-08-11T19:59:03.387Z`) immediately after that
verification pass completed — flagged here per this dev database's own
established "note staleness rather than silently working around it"
precedent (P25, P28), even though nothing about it needed fixing.

**Suggested commit message:**
`fix(desktop): handle externally-deleted Shared Files and repair device rename (P29)`

**Final verdict:** both in-scope issues reproduced live against the real
app before any change, root-caused to a specific line each (an unguarded
`shell.trashItem` call; an unimplemented `window.prompt()` in this
Electron build), fixed with the smallest change that closes each root
cause without altering backend semantics, the P23 device-auth model, or
P28's history/listing separation, and re-verified live including a genuine
full-process-restart persistence check for Rename. One additional bug
(the `hidden`-attribute cascade issue) was introduced and caught by this
same milestone's own live-screenshot verification step before being
reported as complete. No `Transfer` row, downloaded file, or received item
was affected by either fix.

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
  UID — confirmed again in P24 for `pm revoke ... CAMERA`, which fails with
  `SecurityException: ... REVOKE_RUNTIME_PERMISSIONS`) — use
  `DELETE /devices/{id}` against the backend to force an unpaired state
  instead of trying to clear app data via ADB, and rely on source review
  for a permission-denied UI branch that can't be re-triggered live.
  Likewise, `adb shell svc wifi disable` does not reliably stop this
  device's Wi-Fi radio from still servicing an already-open UDP socket
  (P24) — don't use it as a proxy for "device went off-network" in a live
  test; drive the app's own focus-loss/regain path instead.
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
- **The desktop's `style-src 'self'` CSP logs a console violation for every
  innerHTML-injected `style="..."` attribute (e.g. the transfer progress
  bar's `width:N%`), but does not actually strip it** — confirmed via
  `getComputedStyle` (P21). Treat this specific warning as cosmetic noise,
  not a real rendering bug, unless a future check shows the style genuinely
  failing to apply.
- **A backend action that has no delete/undo primitive by design (a
  `Transfer` row, per `docs/13_Database_Design.md` §7/§10) means any
  client-facing "clear"/"remove" feature over that data must be
  client-local** (a marker filtering what's displayed), never a new backend
  delete route invented to make the UI simpler. Android's
  `historyReset.ts` established this for transfer history; P21's
  `transferHistory.js`/`receivedFiles.js` apply the identical pattern on
  Desktop, once for the same history and once for a received file's
  Shared Files entry.
- **Git Bash mangles an absolute `/storage/...` argument into a Windows
  path before `adb shell` ever sees it** (turning
  `/storage/emulated/0/Download/Relay/x.txt` into something under `C:\Program
  Files\Git\...`) whenever it's a standalone argument rather than embedded
  inside a larger quoted string — confirmed live in P28 (`adb shell rm
  /storage/...` silently failed with a `C:/Program Files/Git/...` path in
  the error). Prefix the command with `MSYS_NO_PATHCONV=1` for any `adb
  shell` call that takes a bare device-side absolute path as its own
  argument.
- **`window.prompt()` is unimplemented in Electron and always throws**
  ("prompt() is not supported") — unlike `window.confirm()`, which does
  work. Any renderer code that needs free-text input from the user cannot
  use a native prompt on this platform at all; it needs its own input UI
  (P29 used inline card editing for Devices Rename). Check for this
  category of missing-native-dialog support before assuming a `window.*`
  dialog function behaves like it does in a regular browser.
- **Toggling an element's visibility via the `hidden` attribute/property
  silently loses to any author CSS rule that sets `display` on that same
  element** (`.device-card-actions`/`.device-card-title`'s own
  `display: flex` beat `[hidden] { display: none }` even though both
  selectors have equal specificity — per the CSS cascade's origin-bucket
  ordering, *any* normal-author rule outranks *any* normal-user-agent rule
  regardless of specificity). Confirmed live in P29 via screenshot: the
  Rename form and the Rename/Remove buttons were both visible
  simultaneously until this was caught. Prefer toggling
  `element.style.display` directly for any element whose class already
  sets `display` in `app.css`, rather than relying on the `hidden`
  attribute.
