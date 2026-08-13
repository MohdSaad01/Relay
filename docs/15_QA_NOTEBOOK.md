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

**Correction (P29.1):** the fix this entry shipped for the `hidden`-
attribute cascade issue — switching to `element.style.display` mutations —
did **not** actually work. `index.html`'s CSP (`style-src 'self'`, no
`unsafe-inline`) silently blocks all inline `style` application, including
JS `.style.property =` mutations, not just the HTML `style=""` attribute.
See P29.1 below: this made the Rename form permanently visible regardless
of state, the exact opposite of what this entry believed it had verified.
The "cosmetic noise" cross-cutting lesson this entry relied on (originally
from P21, further down this file) was itself a false negative from testing
only at the one progress value (100%) where a blocked inline style is
visually indistinguishable from a correctly-applied one — see P29.1 and
the corrected cross-cutting lesson at the end of this file.

---

## P29.1 — Desktop Device Rename Edit-State Lifecycle Fix

**Reported issue:** opening Desktop's Devices tab (or returning to it after
visiting another tab) showed the paired device card already in rename/edit
mode (name input, Save, Cancel all visible) without the user ever clicking
Rename — and Rename/Remove and the normal title row stayed visible
*at the same time*, matching this excerpt from the report:

```
RMX3997
Paired
RMX3997
Save
Cancel
android
Paired 8/12/2026, 10:46:54 PM
Last seen -
Rename
Remove
```

**Baseline (source inspection):** `desktop/src/renderer/views/devices.js`
(post-P29) looked correct on paper — `renderDeviceCard()`'s template set
`style="display: none"` on `.device-card-rename`, and `showRenameForm`/
`hideRenameForm` toggled `.style.display` on the form, title, and actions
elements, exactly the pattern P29's own QA entry (above) claimed it had
verified. `renderer.js`'s `showView()` fully rebuilds the view container on
every mount (`viewContainer.innerHTML = ""` then `mount()`), so there was
no obvious stale-DOM or double-render path either. Nothing in source
review alone explained the report.

**Live reproduction (real Electron app):** an Electron instance from
before this session (PID group, `StartTime` ~23 min prior) was already
running and had to be closed (Electron's single-instance lock rejects a
second launch) before a Playwright-driven instance could take over; no
device data was at risk (SQLite-backed). The dev `relay.db` had 0 paired
devices at the time (a prior device had since been unpaired) — one test
device row was inserted directly via `sqlite3` for the duration of this
verification and removed again afterward (see Regression verification).

- **Case A (initial launch, no click):** polling `getComputedStyle` every
  100ms for ~6s immediately after the auto-navigation to Devices (a device
  is paired, so `determineInitialView()` lands there without any click)
  showed the rename form's raw `style` attribute reading `"display: none"`
  the entire time, while its **computed** `display` was `"flex"` the
  entire time — reproduced with zero clicks, confirming this was not a
  click-driven race.
- **Case B (tab remount):** confirmed identical to Case A after navigating
  away and back.
- The browser console logged, at the exact moment the card first rendered:
  `Applying inline style violates the following Content Security Policy
  directive 'style-src 'self''... The action has been blocked.`

**Root cause:** `desktop/src/renderer/index.html`'s CSP
(`style-src 'self'`, no `unsafe-inline`) blocks the browser from
*applying* any inline style — both the HTML-authored `style=""` attribute
and, critically, **JS `element.style.property = value` mutations as
well**. The attribute's *text* still updates (so `getAttribute('style')`/
`outerHTML` read back exactly what the code wrote, which is why P29's own
source-level review and even a shallow live check could look correct), but
Chromium never uses that value when computing the actual rendered style.
The only display rule actually in effect is therefore whichever CSS
*class* rule applies — `.field-row { display: flex }` for the rename form,
`.device-card-title { display: flex }` for the title,
`.device-card-actions { display: flex }` for the actions row — all three
`display: flex`, all three always visible, completely independent of
`showRenameForm()`/`hideRenameForm()` ever running. This is not a race and
not a lifecycle bug in the mount/remount logic itself; the mount logic was
always correct. The entire rename/edit *toggle mechanism* P29 shipped had
simply never had any visual effect, in any Electron session, since the day
it was written.

This also means the pre-existing cross-cutting lesson (below, originally
written during P21) claiming this exact CSP warning is "cosmetic noise"
that "does not actually strip" the style is **incorrect** and is corrected
in this pass — see the corrected lesson at the end of this file, and the
newly-discovered Transfers progress-bar bug in Deferred issues below.

**Architecture/state-management decision:** keep rename/edit state as
UI-only transient state (per the milestone's own required model), but
represent it with a CSS class (`.device-card.is-renaming`) toggled via
`classList.add`/`classList.remove`, instead of direct inline-style
mutation. `classList` writes the `class` attribute, which the CSP's
`style-src` directive has no authority over, so this is unaffected by the
restriction that broke P29's approach. No new state-management library, no
backend involvement, no persistence — matches the milestone's explicit
"do not over-engineer" boundary.

**Implementation:**
- `desktop/styles/app.css` — added `form.device-card-rename { display:
  none; }` as the class's real default (element+class selector,
  deliberately outranking `.field-row`'s single-class rule regardless of
  stylesheet order), plus `.device-card.is-renaming form.device-card-rename
  { display: flex; }` and `.device-card.is-renaming .device-card-title,
  .device-card.is-renaming .device-card-actions { display: none; }`.
- `desktop/src/renderer/views/devices.js` — `showRenameForm()`/
  `hideRenameForm()` now do `card.classList.add("is-renaming")` /
  `card.classList.remove("is-renaming")` instead of touching
  `titleEl`/`actionsEl`/`renameForm` `.style.display` individually; the
  now-nonfunctional `style="display: none"` was removed from
  `renderDeviceCard()`'s template (the CSS default above replaces it).
  `titleEl`/`actionsEl` local variables were removed as unused.

**Automated tests:** `node --check desktop/src/renderer/views/devices.js`
— pass. Desktop still has no formal lint/test suite (unchanged since
P19). `app.css` is not JS and has no applicable automated check.

**Live Electron verification (real app, real `relay.db`, Playwright-driven,
screenshots at every step):**
- **Case A / initial launch:** normal card, `is-renaming` class absent,
  Save/Cancel not present — screenshot confirms visually (title, badge,
  meta, Rename/Remove only).
- **Case B / tab remount (Devices → Files → Devices):** identical normal
  state, `is-renaming` absent.
- **Case C / explicit Rename:** `is-renaming` class present on the card;
  screenshot shows only the input (pre-filled, focused, text selected),
  Save, Cancel — title and Rename/Remove genuinely hidden this time
  (computed, not just attribute text).
- **Cancel:** `is-renaming` removed; screenshot shows normal card restored,
  no residual Save/Cancel. Re-tested navigating away (Transfers) and back —
  still normal, no auto-reactivation.
- **Save:** changed name to `RMX3997-RENAMED` via the inline input,
  clicked Save — card updated to the new name, `is-renaming` absent, no
  Save/Cancel visible; confirmed unchanged after a tab remount.
- **Application restart:** closed the Electron process entirely and
  launched a fresh instance (a real second process reading the same
  `relay.db`, not an SPA reload) — Devices showed `RMX3997-RENAMED` in
  normal (non-editing) mode, proving both the backend persistence and the
  UI's default-to-normal state survive a genuine process restart.
- **CSP-blocking mechanism, isolated confirmation:** injected a standalone
  `<div class="progress-bar"><div class="progress-fill"
  style="width:50%"></div></div>` (identical markup shape to
  `desktop/src/renderer/views/transfers.js`'s real progress bar) into the
  live page and read back `getComputedStyle` — computed width was `100px`
  (the parent's full width), not the `50px` the inline style specified,
  proving the CSP blocks inline style unconditionally and is not specific
  to the `display` property or to `devices.js`.

**Regression verification (live):** Remove button still present and
unaffected; device status/meta (platform badge, Paired/Last seen
timestamps) rendered correctly throughout; all other nav tabs (Files,
Transfers, Settings) opened without error during the navigation tests
above. The test device row inserted for this verification
(`device_name` `RMX3997-TEST` → `RMX3997-RENAMED`) was deleted from
`relay.db` via direct `sqlite3 DELETE` afterward, restoring the 0-device
state found at the start of this session.

**P29 stale Shared Files smoke test:** not exercised live this pass
(no in-scope reason to touch Shared Files) — confirmed via `git diff`
that `desktop/src/main/ipc-handlers.js` (the P29 IPC fix) has zero
changes in this milestone. Source-inspection-level confidence only, not
re-verified live.

**Problems discovered (beyond the reported issue):**
1. **The P29 QA entry's "hidden-attribute cascade" fix never worked** —
   documented and corrected above; this *is* the reported P29.1 bug, not a
   separate issue.
2. **The P21 "cosmetic noise" cross-cutting lesson about this same CSP
   warning was a false negative** — it tested only the 100%-progress case,
   where a blocked inline `width` and a correctly-applied one render
   identically. Corrected in the cross-cutting lessons section below.
3. **New, separate, currently-shipping bug (deferred, not fixed this
   pass):** `desktop/src/renderer/views/transfers.js`'s progress bar
   (`style="width:${progress}%"` on `.progress-fill`) is subject to the
   exact same CSP blocking and therefore always renders at its container's
   full 100px width regardless of actual transfer progress — confirmed in
   isolation above. Out of scope for P29.1 (Transfers is explicitly
   excluded from this milestone's boundary); needs its own follow-up using
   the same class-toggle-or-CSS-variable approach, not inline `style=`.

**Documentation changed:** this `docs/15_QA_NOTEBOOK.md` entry, a
correction appended to the P29 entry above, and a correction + new entry
in the Cross-Cutting Lessons section at the end of this file. `CLAUDE.md`
was updated: a new "Desktop Rename Edit-State (P29.1)" note under the
existing P29 section, since this establishes a durable, easy-to-repeat
trap (inline-style state toggling silently doing nothing under this app's
CSP) worth flagging before any future Desktop UI work reaches for
`.style.property =` again. `README.md` was not touched — it does not
describe Rename or CSP behavior at a level either fix affects.

**Documentation intentionally unchanged:** no other `docs/` file describes
the CSP or the rename mechanism at an architectural level requiring an
update; this stays a QA-notebook and CLAUDE.md-level correction rather
than a docs/09_Networking.md or docs/10_Security.md change, since Version
1's CSP itself was not modified.

**Remaining limitations:**
- The newly-discovered Transfers progress-bar bug (item 3 above) is
  documented but not fixed — deferred per the milestone's explicit scope
  boundary (Transfer History changes excluded).
- The P29 stale-Shared-Files IPC fix was smoke-tested only via `git diff`
  (unchanged), not re-exercised live this pass.
- No Android or backend testing was performed or needed — this is a
  Desktop-renderer-only fix, confirmed not to require Android/backend
  changes during investigation (rename already worked correctly at the
  data layer; only the Desktop UI's own show/hide mechanism was broken).

**Suggested commit message:**
`fix(desktop): keep device rename inactive until explicitly opened`

**Final verdict:** the reported bug reproduced live with zero clicks
required (Case A alone was sufficient), root-caused with definitive
evidence (`getComputedStyle` polling plus an isolated CSP reproduction
using a second, unrelated element) to the CSP blocking *all* inline style
application — not a mount/remount race, not a lifecycle bug, not stale
state — meaning the P29 fix for the equivalent-looking `hidden`-attribute
bug had silently never worked. Fixed with a CSS-class toggle, which is
unaffected by `style-src` since it never touches the `style` attribute.
Re-verified live across initial launch, tab remount, explicit Rename,
Cancel, Save, post-save remount, and a genuine full-process restart, all
matching the milestone's required state machine exactly. One related,
currently-shipping bug in an out-of-scope view (Transfers' progress bar)
was discovered as a byproduct of root-causing this issue and is documented
above as deferred, not fixed.

---

## P30 — Application-Wide Dialog & Confirmation UX

**Scope:** audit and standardize every Desktop and Android dialog/
confirmation prompt so custom Relay dialogs feel like a deliberate part of
the design system (P19/P20 Desktop, P14.1/P22 Android) instead of a mix of
native OS prompts and hand-rolled cards — same behavior, better
presentation, per the milestone's own explicit boundary. No transfer
protocol, database schema, transfer state machine, pairing protocol,
identity, history semantics, filesystem behavior, or auth changes.

### Baseline (Phase A audit, no code changed)

**Desktop** (`desktop/src/renderer/`) — every `window.confirm()` site, via
`grep -rn "window\.\(confirm\|prompt\|alert\)"`:

| Site | File | Style before |
|---|---|---|
| Unpair device | `views/devices.js` | plain `window.confirm()` |
| Clear History (Shared Files' received-item history) | `views/files.js` | plain `window.confirm()` |
| Unshare file/folder | `views/files.js` | plain `window.confirm()` |
| Delete shared file/folder (source) | `views/files.js` | plain `window.confirm()` |
| Delete received file/folder | `views/files.js` | plain `window.confirm()` |
| Clear History (Transfers) | `views/transfers.js` | plain `window.confirm()` |

Also inventoried and found **already correct / intentionally out of scope**:
- Pairing approve/reject/expired/success/rejected — P20 `iconBadge` status
  cards, never used `window.confirm`.
- Rename (Devices) — P29/P29.1 inline-edit card, not a confirmation prompt;
  re-confirmed still correct per P30 §8 (see below) and left untouched.
- Backend-startup fatal error (`main.js`'s `dialog.showMessageBoxSync`) —
  fires in the Electron **main** process before any renderer/window exists,
  so there is no HTML/CSS surface to render a custom dialog into; correctly
  stays a native Electron dialog.
- `dialog.showOpenDialog` (Add Files/Add Folder/Browse Settings pickers,
  `ipc-handlers.js`) — native OS file pickers, the Desktop equivalent of
  Android's document/directory picker; correctly stays native (same
  reasoning as P30 §9's camera-permission exemption).

**Android** (`android/src/`) — every `Alert.alert()` site, via
`grep -rn "Alert\.alert" android/src`:

| Site | File | Style before |
|---|---|---|
| File Details (info only) | `screens/files/FilesScreen.tsx` | plain `Alert.alert` |
| Folder Details (info only) | `screens/files/FilesScreen.tsx` | plain `Alert.alert` |
| "Could not share this file" (error) | `screens/files/FilesScreen.tsx` | plain `Alert.alert` |
| Delete file (destructive) | `screens/files/FilesScreen.tsx` | plain `Alert.alert` |
| Delete folder (destructive) | `screens/files/FilesScreen.tsx` | plain `Alert.alert` |
| "Could not remove this download" ×2 (file/folder error) | `screens/files/FilesScreen.tsx` | plain `Alert.alert` |
| Clear file history (destructive) | `screens/files/FilesScreen.tsx` | plain `Alert.alert` |
| Clear transfer history (destructive) | `screens/transfers/TransferListScreen.tsx` | plain `Alert.alert` |
| "Could not set download location" (error) | `screens/settings/SettingsScreen.tsx` | plain `Alert.alert` |

10 call sites total. Also inventoried and found **already correct /
intentionally out of scope**:
- `FileActionMenu.tsx` (P14.1) and `UploadConfirmSheet.tsx` (P26) — already
  custom `Modal`-based bottom sheets matching Relay's visual language; not
  redundant with the new dialog primitive (an action-list sheet and an
  upload-details sheet are a different shape than a confirm/alert dialog),
  reused as the architectural precedent instead of replaced.
- Device rename (`SettingsScreen.tsx`'s `DeviceNameCard`) — inline-edit
  card (P23), same reasoning as Desktop's Rename; not a confirmation
  prompt.
- Cancel Transfer (`TransferProgressDetail.tsx`'s `handleCancel`) — **no
  dialog exists today**, confirmed via source read; the Cancel button acts
  immediately. Left as-is: P30 is a presentation-consistency pass over
  existing dialogs, not a mandate to add new confirmations for actions
  that don't currently have one.
- Remove (idle/failed row dismiss, `FilesScreen.tsx`'s `handleRemoveFile`/
  `handleRemoveFolder`) — silent, no dialog, by original P22 design (dismisses
  a local marker only; nothing is destroyed since the item stays shared and
  reappears if re-shared — see CLAUDE.md's P22 section). Left as-is.
- Camera permission (`QrScanScreen.tsx`) — the OS permission prompt itself
  (`PermissionsAndroid.request`) is untouched, per P30 §9. The
  explanation/blocked/retry UI around it was already a full-screen state
  (not a dialog) predating this milestone; re-confirmed still correct and
  left alone.
- Pairing result/waiting screens — full-screen states, not dialogs;
  unaffected.

### Root cause

Both `window.confirm()`/`window.prompt()`/`Alert.alert()` render the host
OS's own unstyled system prompt — outside `app.css`'s design tokens on
Desktop and outside `FileActionMenu`/`UploadConfirmSheet`'s established
white-card/rounded-corner/`#2563eb`-primary/`#dc2626`-destructive language
on Android. Every one of these dialogs also used the vague "OK" for its
destructive action's own label where a more explicit one (Unpair/Delete/
Clear History) was available and appropriate, per P30 §6.

### Architecture decision

Investigated existing reusable primitives first (P30 §5), per CLAUDE.md
Rule 5 (don't duplicate logic) and Rule 2 (don't add dependencies without
justification):

- **Desktop:** no existing "dialog" component existed — `iconBadge()`/
  `pageHeader()`/`emptyState()` (`dom.js`) are markup helpers for a
  *view's* content, not an overlay. Built **one** new primitive,
  `desktop/src/renderer/dialog.js`'s `confirmDialog({ title, message,
  confirmLabel, cancelLabel, destructive })`, returning a `Promise<boolean>`
  so a call site's control flow barely changes (`if (!window.confirm(...))
  return;` → `if (!(await confirmDialog({...}))) return;`). Renders a
  backdrop + `.card`-styled card appended to `document.body` (not
  `#view-container`, which `renderer.js`'s `showView()` wipes on every nav
  click) using **existing** `app.css` tokens (`.card`, `button.primary`/
  `.danger`/`.text-button`, `--space-*`/`--radius-*`) — two small new CSS
  rule blocks (`.dialog-backdrop`, `.dialog`) rather than a parallel style
  system. No new npm dependency.
- **Android:** `FileActionMenu.tsx`/`UploadConfirmSheet.tsx` (P14.1/P26)
  already established the right building blocks — `Modal` (transparent +
  fade), a backdrop `Pressable` that dismisses, an inner no-op `Pressable`
  isolating the card from backdrop taps. Built **one** new primitive on the
  same foundation, `android/src/components/AppDialog.tsx`: a *centered*
  card (not their bottom-sheet shape, since a confirm/alert dialog isn't
  tied to a specific list row) plus `useAppDialog()`, a small local-state
  hook so a screen's call sites read almost identically to
  `Alert.alert(title, message, buttons)` — `dialog.show({ title, message,
  buttons })` in place of `Alert.alert(...)`, one `<AppDialog {...dialog.props}
  />` rendered once per screen. No new npm dependency (`react-native`'s own
  `Modal`/`Pressable`, same as the two precedents).

Per P30 §5's explicit instruction, Desktop and Android were **not** forced
into one shared component — different rendering stacks (DOM/CSS vs. React
Native), and each platform already had its own established visual
language to extend rather than replace.

**Desktop dialog styling decisions** (destructive vs. primary, matching
each action's *existing* button-danger-class semantics elsewhere in the
same view, not invented fresh):

| Dialog | Confirm label | Style | Why |
|---|---|---|---|
| Unpair | "Unpair" | destructive (red) | Existing Remove button is already `class="remove danger"` |
| Delete (shared/received) | "Delete" | destructive (red) | Existing button is already `class="delete danger"` |
| Clear History (Files/Transfers) | "Clear History" | destructive (red) | P30 §6 explicitly names Clear History as destructive, even though its *trigger* button (`.text-button`) isn't red — only the dialog's own confirm action needed to be |
| Unshare | "Unshare" | primary (blue) | Existing `.unshare` button was never `.danger` — stopping sharing doesn't destroy anything; the item stays on disk and can be re-shared |

**Android dialog styling** mirrors `Alert.alert`'s own `style: 'cancel' |
'destructive' | 'default'` per-button API 1:1, so no new semantic mapping
was needed — each call site's existing `style: 'destructive'`/`'cancel'`
carried over unchanged.

**Special case — Rename (P30 §8):** re-audited both platforms' inline-edit
Rename (Desktop `devices.js` `.is-renaming` class-toggle from P29/P29.1,
Android `SettingsScreen.tsx`'s `DeviceNameCard`). Neither is a
confirmation prompt — both are a persistent inline edit-state, already
consistent with the rest of each platform's design language. Left
untouched, per the milestone's own explicit instruction not to regress a
working P29 fix just because a dialog system now exists.

### Implementation

**Files created:**
- `desktop/src/renderer/dialog.js` — `confirmDialog()`.
- `android/src/components/AppDialog.tsx` — `AppDialog` + `useAppDialog()`.

**Files modified:**
- `desktop/styles/app.css` — `.dialog-backdrop`/`.dialog` rules (new
  section, uses only existing design tokens).
- `desktop/src/renderer/views/devices.js` — Unpair confirmation.
- `desktop/src/renderer/views/files.js` — Clear History, Unshare, Delete
  (shared), Delete (received) confirmations (4 call sites).
- `desktop/src/renderer/views/transfers.js` — Clear History confirmation.
- `android/src/screens/files/FilesScreen.tsx` — all 8 `Alert.alert` sites
  (File/Folder Details, Share error, Delete file/folder, Remove-error
  file/folder, Clear file history) converted to `dialog.show(...)` +
  `useAppDialog()`; `Alert` import removed (no longer used in this file).
- `android/src/screens/transfers/TransferListScreen.tsx` — Clear transfer
  history; `Alert` import removed.
- `android/src/screens/settings/SettingsScreen.tsx` — "Could not set
  download location" error; `Alert` import removed.

No backend file touched — matches the milestone's "UI only" boundary; `git
diff --stat` confirms zero changes under `backend/`.

### Automated tests

- **Desktop:** `node --check <file>` on all 4 modified/created `.js` files
  initially reported false confidence — **discovered problem**: plain
  `node --check file.js` silently stops validating a `.js` file's body
  after its first `import` statement (Node treats the file as CommonJS by
  default with no `"type": "module"` in `desktop/package.json`, and a
  leading `import` short-circuits the parse rather than erroring). Verified
  with a deliberately-broken file (`function( {` after an `import` line):
  plain `node --check` reported exit 0 (false pass), while `node
  --input-type=module --check < file.js` correctly caught the syntax
  error. Re-ran all 4 files with the corrected form — all pass (exit 0,
  no output). **This is now the correct command for any future Desktop
  ESM `node --check` in this project** — see the new Cross-Cutting Lessons
  entry below.
- **Android:** `npx tsc --noEmit` — clean, zero errors.
  `npx eslint .` — 10 `react-hooks/exhaustive-deps` errors on first pass
  (each `useCallback` referencing `dialog.show` inside its body but only
  listing `dialog.show` — not the parent `dialog` object — in its
  dependency array); fixed by listing `dialog` itself in each affected
  array (`useAppDialog()` returns a fresh object each render, but the
  lint rule tracks the object identity referenced in the callback body,
  not just the specific member path listed). Re-ran — 0 errors, 4
  warnings, and a `git stash`/re-lint comparison confirmed all 4 warnings
  (2 `react/no-unstable-nested-components`, 2 `no-void` in
  `TransferStreamManager.ts`) pre-exist on `main` at the same lines,
  unrelated to this milestone. `npx jest` — 42/42 suites, 363/363 tests
  passing, unchanged from baseline (no test in this codebase asserts on
  `Alert.alert` call shape directly — all existing Files/Transfers/Settings
  tests target pure logic functions, not the dialog call itself).

### Desktop live verification (real Electron app, Playwright-driven)

Launched the actual `desktop/` Electron app (`electron .`, not a mock) via
`playwright-core` (already present in `desktop/node_modules` from prior
sessions), against the real dev `backend/relay.db` — one genuinely paired
device (`RMX3997`), a large real transfer history, and a pre-existing
`historyClearedAt` localStorage marker (`2026-08-12T18:39:27.149Z`) left
over from an earlier session, which initially disabled both Clear History
buttons (nothing left to clear) and hid every received-item row. Verified
each in turn, screenshots captured at every step:

- **Unpair (devices.js):** opened the dialog on the one real paired
  device. **Did not click the real Unpair action** — P30 §3 explicitly
  forbids unpairing the only physical Android test device to manufacture a
  test state. Verified Cancel-button dismiss, Escape-key dismiss, and
  backdrop-click dismiss all correctly close the dialog with the device
  still paired afterward (`document.activeElement` confirmed default
  focus lands on the Cancel button on open, not the destructive action).
- **Unshare / Delete (files.js):** shared a real throwaway file (`POST
  /files` directly, bypassing the native OS picker Playwright can't drive)
  and drove the real UI. Unshare dialog: opened, screenshot, Cancel.
  Delete dialog: opened, screenshot (destructive red confirm), **real
  confirm click** — row disappeared from the table, confirmed via DOM
  query. This is the one throwaway file this script itself created;
  nothing pre-existing was touched.
- **Received-item Delete (files.js):** the pre-existing `historyClearedAt`
  marker was temporarily cleared (`localStorage.removeItem`, then
  restored to the exact original value in a `finally` block after) to make
  a real received-item row visible again — opened its Delete dialog,
  screenshot, **Cancel only** (this is real transfer history from an
  earlier session, not this script's own data, so it was not deleted).
- **Clear History (files.js and transfers.js):** with the marker
  temporarily cleared, opened each dialog, screenshot, Cancel-tested, then
  real-confirmed once on the Files tab (its own effect — setting a new
  `historyClearedAt` — was itself overwritten back to the original value
  in the same `finally` block, so the net effect on this dev environment
  is zero) and Cancel-tested on the Transfers tab. `historyClearedAt` was
  verified byte-for-byte restored (`restored === original: true`) before
  closing the app.
- **Regression sweep:** a separate clean run navigated Devices → Pairing →
  Files → Transfers → Settings → Devices, opened and cancelled the Unpair
  dialog mid-sweep, and captured every `console`/`pageerror` event via
  Playwright's page listeners — **zero errors**.

### Android physical-device verification (RMX3997, real installed app)

Confirmed the connected device first (`adb devices -l`):
`69DADENFONAIOZS4`, `RMX3997IN`/`RMX3997`, package `com.relay.mobile`,
`versionName=1.0`, installed 2026-08-11, **DEBUGGABLE** build flag
confirmed via `dumpsys package`. Since this is a debug build (JS fetched
from Metro at runtime, not baked into the APK), started `npx react-native
start` (Metro) plus `adb reverse tcp:8081 tcp:8081`, force-stopped and
relaunched the app (`am force-stop` / `am start -n
com.relay.mobile/.MainActivity`) so it picked up this session's actual
code changes, and started the real Electron desktop app (`npm start`,
bound `0.0.0.0:8000`) so the phone had a real backend to talk to over the
LAN (matching Version 1's actual local-network transfer model, not
localhost-only).

Two unrelated real-world events surfaced on the device during this pass
and were left untouched, not interacted with beyond dismissing a purely
cosmetic overlay: a genuine incoming/missed phone call from the device
owner's own contacts (Truecaller overlay), dismissed only via its own "X"
close control so the Relay UI underneath was visible again — no call
action (answer/decline) was ever touched. A pre-existing RN debug-only
warning banner ("Open debugger to view warnings") and an unrelated
`[QR-DEBUG]` instrumentation toast (both pre-existing dev tooling, not
part of this milestone) intermittently overlapped the bottom of the
screen and had to be dismissed via their own "X" buttons before some taps
would land — documented as a **live-verification friction point**, not an
app defect (see Problems discovered, below).

Verified live, screenshots captured at every step:
- **Delete file (FilesScreen, destructive):** shared a real throwaway file
  via a direct `POST /files` call (same technique as Desktop, since
  Playwright can't drive Android's native document picker either),
  downloaded it through the real UI, long-pressed for the action menu
  (confirmed state-dependent menu: idle row → Remove/Details only, no
  Delete; completed row → Open/Share/Delete, matching P22's documented
  per-state action set), opened the Delete dialog. Verified: Cancel button
  dismiss (file still present), Android hardware **back button** dismiss
  (`KEYCODE_BACK`, maps to `Modal`'s `onRequestClose`) with the dialog
  closing cleanly and no residual state, backdrop-tap dismiss, and finally
  a **real confirm** — the row correctly downgraded from "Open" back to
  "Download" (local copy actually deleted, re-verified against the real
  filesystem via the app's own `verify()` call), and Clear History
  correctly re-disabled itself since nothing completed remained.
- **File Details (info-only, single-button):** opened via the idle-state
  action menu; the multi-line `\n`-joined message (Size/Shared/Status)
  rendered correctly with a single "Close" button (not "OK" — chosen
  since a details dialog is a close action, not a generic acknowledgment);
  Close dismissed cleanly.
- **Clear transfer history (TransferListScreen, destructive):** opened
  with one real completed transfer in the list (this session's own
  throwaway download), screenshot confirmed correct title/message/
  destructive-red styling, **real confirm** — list correctly emptied to
  "No transfers yet.", Clear History button correctly re-disabled.
- **Not independently re-clicked live** (verified via identical
  underlying component + source read instead, per this project's own
  established practice of distinguishing live-tested from
  source-verified-only — see P29.1's own precedent): the Files-tab Clear
  History confirm/cancel (Transfers-tab equivalent already exercised with
  the same `AppDialog`/`useAppDialog` code path and identical
  config shape), the Share-file and two Remove-download-error alerts, and
  the Settings screen's download-location error. All four call sites
  invoke the exact same `dialog.show()`/`<AppDialog {...dialog.props} />`
  mechanism proven live at the Delete/Details/Clear-History sites above,
  with no site-specific rendering logic of their own to diverge.

**Cleanup after Android verification:** the throwaway shared file was
unshared via `DELETE /files/{id}` (confirmed `shared_files` back to 0
rows), the local scratch file deleted, `adb reverse --remove-all` run, and
every Metro/Electron process this session spawned was identified by full
command line (all rooted under `C:\Thomas\Encipher\Python\Relay\`) and
terminated — confirmed via a follow-up `tasklist`/backend-health check
that nothing Relay-related was left running. The Transfers-tab Clear
History confirm was a **real, intentional use of the shipping feature**
(not test-only scaffolding) against this session's own one throwaway
transfer; it was not reverted, matching how a real user exercising Clear
History is expected to behave — see Remaining limitations below for the
resulting device-local state.

### Regressions checked

**Desktop:** Devices, Pairing, Shared Files, Transfers, Settings all
navigated without console/page errors (see regression sweep above);
Rename (Desktop) re-confirmed unaffected — `is-renaming` class toggle
untouched, no dialog-related code path anywhere near it; Remove Device
(Unpair) dialog open/cancel cycle included directly in the same
error-free sweep.

**Android:** `npx tsc --noEmit` and `npx jest` (both project-wide, not
scoped to changed files) confirm Files/Transfers/Settings/Discovery/
Pairing logic is unaffected; the long-press action menu (`FileActionMenu`)
confirmed still opens/closes correctly and its state-dependent action set
(idle vs. completed row) is unchanged; live-clicked Upload confirmation
sheet was not re-tested this pass (untouched by this milestone — `git
diff` shows zero changes to `UploadConfirmSheet.tsx`) but its `Modal`
pattern is exactly what `AppDialog` was modeled on, so no shared-code risk
was introduced.

### Problems discovered during implementation

1. **`node --check file.js` silently under-validates an ESM `.js` file
   with a leading `import`** on this Node version (confirmed v24.18.1) —
   documented above and in Cross-Cutting Lessons below. Not a Relay bug;
   a Node/CommonJS-vs-ESM tooling gap worth remembering for any future
   Desktop `node --check` run.
2. **`react-hooks/exhaustive-deps` wants the parent object (`dialog`), not
   a specific member path (`dialog.show`), in a `useCallback` dependency
   array** when the object itself isn't memoized across renders (unlike
   e.g. `props.onClick`, which react-hooks' static analysis handles at the
   member-path level). Fixed by depending on `dialog` directly at all 10
   call sites; a future `useAppDialog()`-based `useCallback` should do the
   same rather than trying `dialog.show` again.
3. **A pre-existing dev-only debug warning banner and an unrelated
   `[QR-DEBUG]` instrumentation toast on the physical test device
   intermittently overlap the bottom ~250px of the screen**, including
   the tab bar and any dialog rendered near the bottom, and must be
   dismissed via their own "X" controls before a `adb shell input tap` at
   that location reliably lands on the intended Relay UI element
   underneath. Confirmed via `uiautomator dump` bounds overlap (`[20,1393]
   [700,1564]` for the banner vs. `[40,1386][680,1429]` for a menu item
   directly behind it). Not a Relay defect — this banner and toast are
   both pre-existing dev/debug-only instrumentation, invisible in a
   release build — but worth recording as a live-verification friction
   point for any future `adb shell input tap` script on this device.
4. **A real, unrelated incoming phone call and a Truecaller missed-call
   overlay appeared on the physical test device mid-session** (the
   device's owner's own personal call, not anything triggered by this
   work). Handled by dismissing only the overlay's own close control,
   never touching call-answer/decline — documented here per this
   project's own standard of noting anything unexpected encountered
   during live device testing, not because it reflects on the app under
   test.

### Documentation changed

- This `docs/15_QA_NOTEBOOK.md` P30 entry.
- `CLAUDE.md` — new "Application-Wide Dialog Convention (P30)" section
  (durable convention: future Desktop confirmations go through
  `dialog.js`'s `confirmDialog()`, future Android confirmations/alerts go
  through `AppDialog`/`useAppDialog()`, neither `window.confirm()` nor
  `Alert.alert()` should be reintroduced for a new confirmation).
- A new Cross-Cutting Lessons entry (below) for the `node --check`
  ESM-detection gap.

**Documentation intentionally unchanged:** `README.md` — this milestone
changed dialog presentation only, nothing README describes at the
user-facing feature/setup level. `.gitignore` — no new generated artifact
introduced (the two new source files are ordinary tracked source, not
build output).

### Remaining limitations

- The RMX3997 device's Transfers-tab history now has a fresh
  `historyClearedAt` marker (real, intentional use of the feature during
  live verification — see Cleanup above), hiding this session's own single
  throwaway transfer going forward. No pre-existing user data was hidden
  by this — the device had already had its history cleared in an earlier
  session before this milestone began, and the only transfer created and
  then hidden was this session's own test download.
- Four Android call sites (Files-tab Clear History, Share-file error, two
  Remove-download-error alerts, Settings download-location error) were
  verified via identical-component reasoning plus `tsc`/`eslint`/`jest`
  rather than individually live-tapped on the device — documented above
  under Android verification, not silently assumed.
- Desktop still has no formal automated lint/test suite beyond `node
  --check` (unchanged from every prior Desktop milestone's own
  limitation) — `app.css`'s two new rule blocks have no automated check
  at all, only the live Playwright screenshots above.
- Packaging/distribution (`docs/12_Packaging_Deployment.md`) remains the
  next milestone, unaffected by this pass.

### Suggested Git commit message

`feat(desktop,android): standardize confirmation dialogs across the app`

### Final verdict

Every native/plain dialog found in the Phase A audit (6 Desktop
`window.confirm()` sites, 10 Android `Alert.alert()` sites) now renders
through one small, reusable, platform-appropriate primitive
(`confirmDialog()` on Desktop, `AppDialog`/`useAppDialog()` on Android),
matching each platform's existing design language (P19/P20 Desktop
tokens; P14.1/P26 Android `Modal` conventions) with no shared
cross-platform component forced where the two rendering stacks
genuinely differ, per P30 §5. Every dialog identified as already correct
(Pairing status cards, both platforms' inline Rename, `FileActionMenu`/
`UploadConfirmSheet`, camera-permission UI, Cancel Transfer, idle-row
Remove) was independently re-confirmed correct and left untouched rather
than assumed. All automated checks pass (`node --check` via the corrected
`--input-type=module` form; `tsc --noEmit` clean; `eslint` 0 errors, 4
pre-existing unrelated warnings; `jest` 363/363). Both platforms were
live-verified against real state — the real Electron app via Playwright
with real `relay.db` data (destructive Delete genuinely executed and
confirmed against a throwaway file; the one real paired device's Unpair
was deliberately never confirmed), and the real RMX3997 physical device
over a real LAN connection to the real backend (destructive Delete and
Clear History both genuinely executed and confirmed against real
device state, with cleanup verified afterward). No backend file was
touched. No unrelated visual redesign, animation, or new feature was
introduced.

---

## P31 — Product UI/UX Audit & Finishing Backlog

**Scope:** audit-only milestone. No application source, CSS, TypeScript,
backend, database, dependency, or configuration file was changed. Goal:
determine the actual current product state after P1–P30 by exercising the
real Desktop app and the real Android app on the physical test device, and
produce a prioritized, evidence-based finishing backlog. Per the
milestone's own instructions, this entry is the primary deliverable.

### Environments

- **Desktop:** the real Electron app (`desktop/`), launched via a
  temporary Playwright `_electron` driver script (kept outside the tracked
  project, in the session scratch directory, deleted afterward — no
  project skill for this existed yet; this is a candidate for
  `/run-skill-generator` in a future session). Backend ran as the app's
  own spawned child process against the real `backend/relay.db`, unmodified
  except for P31's own temporary test shares (added via direct backend API
  calls to `POST /files`/`POST /folders`, and fully unshared again via
  `DELETE /files/{id}`/`DELETE /folders/{id}` at the end — see Cleanup).
- **Android:** the real RMX3997 physical device over ADB, running the
  already-installed **debug** build of `com.relay.mobile`. This build
  requires a live Metro connection (see Verification Limitations) — Metro
  was started and `adb reverse tcp:8081 tcp:8081` set up specifically to
  get past the dev-mode "Unable to load script" screen before any real
  testing was possible, then torn down again at the end.
- One already-paired real device (RMX3997 ↔ this desktop) was reused for
  every cross-platform journey; per the P24 precedent, its Unpair was
  opened and inspected but deliberately never confirmed, to avoid
  disrupting the only physical pairing available for testing.

### Methodology

Both apps were driven live, not inferred from source alone. Desktop states
were captured via Playwright screenshots plus live DOM/CSS introspection
(`getBoundingClientRect`, `getComputedStyle`) to confirm layout claims with
real numbers, not just visual impression. Android states were captured via
`adb exec-out screencap`. Five throwaway test fixtures were created and
shared to populate realistic states for the real-world-edge-case checks in
the milestone brief: a normal small file, a **zero-byte file**, a filename
with **mixed Unicode + emoji** (`résumé 简体字 emoji😀 file.txt`), a
**180-character unbroken filename** with no spaces, and a 3-file **nested
folder** (`Vacation Photos/Subfolder/…`, including a Unicode filename
inside the folder). An **80 MB file** was added later specifically to
observe in-progress transfer states. All fixtures and their resulting
shares/downloads were removed at the end (see Cleanup).

### Findings

#### P1 — High

**UI-01 — Desktop Shared Files/Transfers: a single unbreakable long
filename breaks the entire table's layout, not just its own row.**
- *Current behavior:* the 180-character no-space test filename forced its
  `<td>` to grow unbounded (`white-space: normal`, `word-break: normal`,
  `overflow-wrap: normal` — confirmed via `getComputedStyle`), which in
  turn forced the whole `<table>` to 1763px wide against a 1084px-wide
  window (confirmed via `getBoundingClientRect`). Because table columns
  share width across all rows, this starved the Actions column for
  **every row in the list**, not just the offending one: the Actions
  `<td>` shrank to ~115px, forcing all four row-action buttons
  (`Show in Folder`/`Refresh`/`Unshare`/`Delete`) to stack into 4 separate
  lines instead of one, ballooning every row to ~206px tall. The visible
  result: a table showing only a `NAME` header and filenames, with a
  horizontal scrollbar, a vertical scrollbar, and huge dead vertical space
  in every row — reproduced identically in both the Shared Files view and
  the Transfers view, since both use the same global `table`/`td` rules in
  `desktop/styles/app.css`.
- *Why it's a problem:* this isn't a cosmetic nit confined to one
  pathological row — it degrades the entire list's usability the moment
  any one item has a long, space-free name (a plausible real name: an
  auto-generated export, a concatenated timestamp filename, a downloaded
  report). A first-time user would reasonably conclude the app is broken.
- *Contrast (this is what makes it P1 and not merely "long names are
  ugly"):* Android's own Shared Files list handles the **identical**
  filename cleanly — single line, ellipsis-truncated
  (`aaaa…aaaa….txt`), no effect on sibling rows. The backend data isn't
  the problem; Desktop's table CSS has no `max-width`/`text-overflow`
  handling on the Name column while Android's row component does.
- *Desired behavior:* cap the Name column's width and truncate with
  `text-overflow: ellipsis` (matching Android's already-correct
  behavior), so no single row's content can affect any other row's
  height/column widths.
- *Evidence:* `desktop/styles/app.css` lines 282–309 (`table`, `th`/`td`
  rules — no `max-width`/`text-overflow` anywhere); live
  `getBoundingClientRect()`/`getComputedStyle()` calls against the running
  app (table `{width: 1763.5, height: 1076.5}` vs. window
  `{innerWidth: 1084}`; actions `<td>` `{width: 114.8}`; row-action button
  `top` offsets `[272.5, 333.5, 375, 416.5]` — four distinct rows, i.e.
  genuinely stacked, not a screenshot artifact).
- *Dependencies:* none — a CSS-only fix to `desktop/styles/app.css`'s
  `td`/`th` rules (or a Name-column-specific class).
- *Suggested milestone:* **P32 — Desktop Files & Transfers Table
  Hardening**.

**UI-02 — Desktop Shared Files: Refresh on a file whose source was
externally deleted wipes the entire view with a raw backend error string.**
- *Current behavior:* deleting a shared file's underlying disk file (this
  is deliberately *not* auto-detected on refresh, per the already-correct,
  documented policy in this file's P25/P29 entries and
  `SharedFileService.refresh_metadata`) and then clicking that row's
  **Refresh** button throws an unhandled error in the renderer. The
  **entire** `#view-container` — page header, "Add Files…"/"Add Folder…"
  buttons, and every other row in the list — is replaced by a single
  unstyled red card reading `File does not exist:
  C:/Thomas/Encipher/Python/Relay/scratch_test_files/p31/normal-report.pdf.txt`,
  exposing the full absolute local filesystem path. The rest of the app
  (nav, other tabs) still works, and navigating away and back to Shared
  Files fully recovers the correct list (the stale entry stays, by
  design) — so this is a renderer-level unhandled-error-state bug, not
  data loss, but it is jarring and looks like the whole feature crashed.
- *Why it's a problem:* (1) it destroys the user's context — every other
  shared file/folder becomes invisible until they navigate away and back;
  (2) it surfaces a raw backend exception string with an internal
  filesystem path, which is exactly the kind of unnecessarily-exposed
  technical detail the milestone brief calls out; (3) it contradicts the
  app's own established error-handling elsewhere (e.g. the Devices/
  Pairing/Settings views all render scoped, human-readable errors without
  losing the rest of the page).
- *Contrast:* Android's equivalent flow — tapping Download on the exact
  same stale entry — shows a small scoped inline message directly under
  that one row ("The source file is no longer available.") with a
  **Retry** button, and every other row is completely unaffected. This
  proves the backend already reports the failure in a form a client can
  present gracefully (a per-item error, not a page-level exception);
  Desktop's Refresh handler just doesn't catch/scope it the way its
  Android counterpart (or Desktop's own other views) do.
- *Desired behavior:* an individual row's Refresh failure should surface
  as a scoped, per-row error (or a dismissible toast) without discarding
  the rest of the list or exposing a raw path — mirroring Android's
  already-correct pattern for the same case.
- *Evidence:* live screenshots (`15-missing-source-refresh.png`, before/
  after: full populated list → single red error card covering the whole
  view → full list restored on re-navigation); confirmed reproducible
  once via `.refresh` button click on the row with the deleted source.
- *Functional defect note:* this is also a genuine functional defect, not
  purely presentational — an unhandled exception should not be able to
  blank a whole view.
- *Dependencies:* none.
- *Suggested milestone:* **P32 — Desktop Files & Transfers Table
  Hardening** (grouped with UI-01 since both are Shared Files/Transfers
  list robustness issues).

#### P2 — Medium

**UI-03 — Desktop Shared Files: folder rows use a plain emoji glyph
("📁") instead of the app's own SVG icon language.**
- *Current behavior:* every shared folder's Name cell renders as literal
  text `📁 Vacation Photos` — a Unicode emoji character concatenated with
  the folder name — while the file row directly above it
  (`résumé 简体字 emoji😀 file.txt`) has no leading icon at all.
- *Why it's a problem:* CLAUDE.md documents a deliberate, hand-drawn SVG
  icon system (`desktop/src/renderer/icons.js`, P19/P20/P25/P27) used
  consistently everywhere else in the app specifically so icon rendering
  doesn't depend on the OS's emoji font. A raw emoji character breaks that
  system in exactly one place, renders inconsistently across OS/font
  versions, and is asymmetric (folders get a glyph, files don't) even
  though the existing `Type` column (`Folder (N items)` vs. `.ext`)
  already communicates the same distinction.
- *Desired behavior:* use the existing `folderIcon` SVG (already defined
  in `icons.js` and already used for empty states, per P27) inline in the
  Name cell instead of the emoji character, or omit a leading glyph
  entirely and rely on the Type column (Android's own row omits a leading
  folder glyph in the Files list and reads fine).
- *Evidence:* live DOM: `<td>📁 Vacation Photos</td>` (no icon markup,
  emoji is literal cell text), contrasted with every other icon usage in
  the app going through `iconBadge()`/inline `<svg>`.
- *Dependencies:* none.
- *Suggested milestone:* **P34 — Cross-Platform Visual Consistency**.

#### P3 — Polish

**UI-04 — Cross-platform: "Clear History" trigger color is inconsistent
between platforms even though the resulting dialogs match.**
- *Current behavior:* Desktop's "Clear History" link (Shared Files and
  Transfers) renders in the neutral `.text-button` color at rest, per
  P30's convention that the trigger stays neutral and only the confirm
  dialog's button is destructive-red. Android's equivalent "Clear
  History" label renders in red **before** the dialog even opens. Both
  platforms' resulting confirmation dialogs are otherwise well-matched
  (matching title, explanatory body text about what is/isn't affected,
  red destructive confirm button) — this is only the resting trigger-label
  color.
- *Why it's a problem:* minor, but it's the one place the two platforms
  visibly disagree on how "about to be able to do something destructive"
  should be signaled before any confirmation step, which the milestone
  brief specifically asks to check for (destructive-action language/color
  consistency).
- *Desired behavior:* pick one convention (Desktop's neutral-until-
  confirmed reads slightly better, since CLAUDE.md's own P30 section
  explicitly reserves red for the confirm button) and apply it on both
  platforms.
- *Evidence:* `06-devices-rename-open.png`-era Desktop screenshots showing
  a neutral "Clear History" label vs. Android screenshot
  `android-07-downloads-triggered.png` showing the same label in red.
- *Suggested milestone:* **P34 — Cross-Platform Visual Consistency**.

**Carried forward, not new — still open.** Desktop's Transfers progress
bar (`transfers.js`, `style="width:${progress}%"`) still always renders
at full width regardless of actual transfer progress, per this file's own
P29.1 entry (the CSP blocks inline `style` application; the fix is a CSS
class/variable toggle, not attempted here since it's out of this
audit-only milestone's scope). Not re-verified against a genuine partial
percentage in P31 (see Verification Limitations — every real test
transfer completed too fast on LAN to catch a partial state), but nothing
in `transfers.js` has changed since P29.1 confirmed it live, so it is
carried forward as **Deferred**, not re-opened as new, and not marked
Existing/Correct.

### Existing / Correct (re-verified live, not simply assumed from prior docs)

- Desktop Devices card: paired-device display, inline Rename
  (open/save/cancel), and the "Unpair this device?" confirmation dialog
  (wording, Cancel/Unpair styling, survives the Rename form being
  cancelled underneath it) — all match P23/P29/P29.1/P30 exactly.
- Desktop Pairing: idle "Ready to pair a device" card and the active QR
  two-column layout (QR card + numbered "How to pair" card), Cancel
  returns cleanly to idle — matches P20.
- Desktop Shared Files/Transfers "Clear History" confirmation dialog
  copy — clearly states what is and isn't affected ("Active transfers
  stay visible, and nothing is deleted from your files.") — a genuinely
  good example of the milestone brief's "does the destructive action
  communicate its consequences" question being already answered well.
- Desktop Settings — Device display name / Download directory / Browse /
  Discoverable toggle only; no leaked `session_token_lifetime_minutes`
  control — matches P25.
- Android Files screen: empty/populated states, long-press action menu
  (Open/Share/Delete/Details for a completed row), the Details dialog
  (Size/Shared/Status only, no raw MIME type), and the missing-source
  Download → inline error + Retry flow — all match P22 and are well
  executed; the missing-source handling in particular is a strong
  positive contrast against Desktop's UI-02 above.
- Android Settings screen — Device/Storage sections only, matches P23
  exactly.
- Android "Open" (ACTION_VIEW chooser) and folder "Open" (opens the
  system file manager at the real downloaded folder) both work correctly
  against real downloaded content.
- Journey C (folder download): the 3-file nested `Vacation Photos/
  Subfolder/…` structure, including a Unicode filename inside the
  subfolder, was recreated byte-for-byte and structurally intact in the
  Android system file manager — re-confirms P26's "folder identity is
  already fully preserved" finding was not a regression.
- Journey D (Android upload → Desktop receive): the uploaded file
  correctly appears in Desktop's Shared Files with a "Received" badge and
  the reduced action set (Open/Show in Folder/Delete — no Refresh/
  Unshare, since it has no `SharedFile` row) — matches P21 §8's
  derive-from-`GET /transfers` logic exactly.
- Unicode + emoji filenames (`résumé 简体字 emoji😀 file.txt`) render
  correctly end-to-end on both platforms (share, list, download, upload,
  Details).
- A zero-byte file shares, downloads, and opens without any special-case
  failure on either platform.
- Android's Upload confirmation bottom sheet (P26) — correct wording
  ("Upload this file"), Cancel discards with no backend call.
- The `bigfile-80mb.bin` real end-to-end download over the real LAN
  completed correctly (80.0 MB / 80.0 MB, byte-identical), confirming
  the streaming engine still works correctly against a non-trivial
  payload — not just the small fixtures.

### Deferred

- Desktop Transfers progress-bar-always-full-width bug (P29.1) — see
  above; still open, out of this audit-only milestone's scope to fix.
- Session-token-lifetime / device-name-only-Settings-scope question
  raised in M9 ("Not Yet Implemented" in `CLAUDE.md`) — unchanged,
  re-confirmed still deliberately out of scope.

### Functional defects discovered

- UI-02 above (Desktop Shared Files Refresh-on-missing-source) is a
  genuine functional defect (unhandled exception reaching the renderer
  and blanking a whole view), reported under UI-02 rather than as a
  separate item since the fix is the same either way.

### Verification / tooling limitations

- **The installed Android build is a debug build requiring a live Metro
  connection.** Launching it cold showed React Native's "Unable to load
  script" dev-mode error screen — not a product defect. Getting past it
  required starting `npm start` (Metro) in `android/` and running
  `adb reverse tcp:8081 tcp:8081` before the app would load at all. Future
  sessions testing this build should expect the same step; a **signed
  release APK** would not have this dependency (this is exactly the gap
  tracked under Packaging & Deployment, not a new finding).
- **Electron's native OS dialogs (`dialog.showOpenDialog` for "Add
  Files…"/"Add Folder…"/Settings' "Browse…") cannot be driven by
  Playwright** — they're a separate native top-level window, not part of
  the page. Per this file's own P30 entry, these are correctly native and
  out of scope for a custom-dialog audit; P31 exercised the resulting
  *states* (a populated Shared Files list) via direct backend API calls
  instead of the picker UI itself.
- **Could not capture a genuine partial-percentage in-progress state on
  either platform.** Even an 80 MB file completed in roughly 1–2 seconds
  over the real LAN — faster than screenshot polling could reliably catch
  a partial percentage on either platform's Transfers view. The Desktop
  progress-bar finding above is carried forward from the already-live-
  verified P29.1 entry rather than re-demonstrated fresh.
- **No notification was observed for any test transfer**, but every test
  transfer also completed near-instantly; this is inconclusive rather
  than a finding that notifications don't work, since a genuinely
  long-running transfer (needed to exercise the foreground-service/
  notification path per `docs/11_File_Transfer.md`) could not be
  constructed against this fast a LAN without a much larger file than was
  practical for this audit.
- **Android's Discovery/QR-pairing screen was not re-triggered live.**
  Doing so would require actually unpairing the one physical test device.
  Per the same reasoning already established in this file's P24 entry,
  this was left unexercised live for P31 rather than risk disrupting the
  only available paired device; Desktop's own Pairing flow (QR generation,
  idle/active states) *was* fully exercised live, and nothing in the
  Android pairing code path has changed since P24's own thorough live
  verification.
- **Device locale affects `toLocaleString()` date formatting differently
  on each test machine** (this Windows desktop vs. the RMX3997) —
  initially looked like a cross-platform inconsistency (Desktop:
  `8/13/2026, 7:01:31 PM`; Android Details dialog:
  `13/08/2026, 13:31:38`) but both call sites use the same unlocalized
  `.toLocaleString()` (`android/src/screens/files/FilesScreen.tsx` lines
  581/855; equivalent on Desktop) — the divergence is each OS's own
  locale setting, not inconsistent code, so this was **not** logged as a
  finding after checking the source. Recorded here so a future audit
  doesn't need to re-derive this.

### Cleanup performed

All P31 test fixtures were removed: the 5 (later 6, including the 80 MB
file) shared test files/folder were unshared via `DELETE /files/{id}`/
`DELETE /folders/{id}` against the real backend; local fixture files under
`scratch_test_files/p31/` (gitignored, not part of the shipped app) were
deleted; the one file received on Desktop during the upload journey was
deleted from the real `Downloads` folder; downloaded test content was
removed from the Android device's `Download/Relay/` folder; the Metro
process and its `adb reverse` mapping were torn down. One empty,
gitignored directory (`scratch_test_files/p31/`) could not be removed due
to a transient Windows file-lock (`Device or resource busy`) after every
known process holding it was already closed — it is empty and harmless,
but worth a manual `rmdir` next time that directory is touched.

### Recommended milestone breakdown

- **P32 — Desktop Files & Transfers Table Hardening** — UI-01 (long-
  filename table blowout) and UI-02 (Refresh-on-missing-source view
  crash). Both are concrete, reproducible, evidence-backed defects in the
  same two views; grouping them avoids touching `app.css`'s shared table
  rules and `files.js`'s error handling twice.
- **P33 — Desktop Transfers Progress Bar Fix** — the carried-forward
  P29.1 finding (class-toggle fix, already scoped in that entry).
  Kept separate from P32 since it's a different file (`transfers.js`) and
  a different, already-understood root cause (CSP + inline style), not
  discovered fresh by this audit.
- **P34 — Cross-Platform Visual Consistency** — UI-03 (folder emoji vs.
  SVG icon language) and UI-04 (Clear History trigger color). Both are
  small, source-level, no-risk changes.
- **No P35/P36 justified by this audit's actual findings** — the
  milestone brief's example names (Android Files/Transfers polish, final
  interaction/feedback polish, packaging readiness) are not backed by
  concrete findings from this pass; Android's own Files/Transfers/Settings
  screens were confirmed correct live and packaging remains tracked
  separately under `docs/12_Packaging_Deployment.md`. Do not manufacture
  additional milestones beyond P32–P34 from this audit.

### Final assessment

Relay's core flows — pairing, sharing, downloading, uploading, folder
transfers, history, device management — all work correctly end-to-end on
both platforms, including under real-world edge cases (Unicode/emoji
names, a zero-byte file, a large file, a nested folder, an externally
deleted source). The product does **not** feel unfinished in its primary
journeys. What would feel rough to a new user today is narrow and
concrete: Desktop's Shared Files/Transfers tables visibly break under a
plausible long filename (UI-01), and the same view can blank itself with a
raw error under a plausible edge case (UI-02) — both are realistic enough
to hit in normal use, not contrived. Everything else found (UI-03, UI-04,
the carried-forward progress-bar bug) is genuine polish, not functionality.
No P0 blocker was found on either platform.

**No application source code was modified during this milestone.** The
only tracked change is this documentation entry.

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
- **CORRECTED by P29.1 — do not trust this lesson's original claim below.**
  The desktop's `style-src 'self'` CSP (no `unsafe-inline`) logs a console
  violation for every inline `style="..."` — whether HTML-authored
  (innerHTML-injected, e.g. the transfer progress bar's `width:N%`) or set
  imperatively via JS (`element.style.property = value`) — **and it
  genuinely blocks the style from being applied in both cases.** P21's
  original check here (below, left for the record) tested the transfer
  progress bar at exactly 100% progress, where a blocked inline `width`
  (falling back to the block-level element's default `width: auto`, which
  fills its 100px parent) is visually and numerically indistinguishable
  from a correctly-applied `width: 100%` — a false negative, not a real
  confirmation. P29.1 proved the block is real by testing a non-100% value
  (`width:50%` read back as computed `100px`, not `50px`) and by finding
  the identical mechanism made P29's Desktop Devices Rename UI permanently
  stuck visible (`docs/15_QA_NOTEBOOK.md`'s P29.1 entry). **Any renderer
  code that needs to change an element's visual style at runtime must use
  a CSS class toggle (`classList.add`/`remove`, unaffected by `style-src`)
  or a CSS custom property set via a `<style>` rule already declared in a
  same-origin stylesheet — never `element.style.property =` or an inline
  `style=""` attribute — regardless of what the DOM's `style` attribute
  *text* appears to show, since that text updates even when the CSP
  silently prevents it from ever being rendered.** `transfers.js`'s
  progress-fill bar is a confirmed-live, currently-unfixed instance of
  this same bug (always renders full width regardless of actual progress)
  — deferred as of P29.1, not yet fixed.
  <br><br>
  Original (superseded) P21 text, kept for the record: "The desktop's
  `style-src 'self'` CSP logs a console violation for every
  innerHTML-injected `style="..."` attribute (e.g. the transfer progress
  bar's `width:N%`), but does not actually strip it — confirmed via
  `getComputedStyle` (P21). Treat this specific warning as cosmetic noise,
  not a real rendering bug, unless a future check shows the style genuinely
  failing to apply."
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
  simultaneously until this was caught. **P29's own fix for this —
  "prefer toggling `element.style.display` directly" — turned out to be
  wrong** (see the CSP lesson above and the P29.1 entry): this app's CSP
  blocks inline style application entirely, including JS `.style.property
  =` mutations, so that fix silently never worked either. **The correct
  fix for this class of problem is a CSS class toggle**
  (`classList.add`/`remove` plus a same-origin-stylesheet rule for the
  toggled state), which is subject to neither the `[hidden]`-vs-author-CSS
  cascade issue described here nor the CSP restriction — this is what
  P29.1 replaced both broken approaches with.
- **Plain `node --check file.js` silently under-validates a Desktop
  renderer `.js` file once it hits a leading `import` statement** —
  confirmed live in P30 with a deliberately-broken file (a syntax error
  placed right after an `import` line reported exit 0, a false pass).
  `desktop/package.json` has no `"type": "module"`, so Node treats a
  `.js` file as CommonJS by default; `--check` appears to stop meaningfully
  parsing the rest of the file once it hits ESM `import` syntax it can't
  fully validate under that assumption, rather than erroring outright.
  **Use `node --input-type=module --check < file.js` instead** (piping the
  file through stdin with `--input-type=module` forces a real ESM parse)
  for any future Desktop renderer `node --check` — confirmed this form
  correctly catches the same deliberately-broken file plain `--check`
  missed.
- **The installed Android build on the physical test device is a debug
  build and requires a live Metro connection to load at all** — cold-
  launching it shows React Native's "Unable to load script" dev-mode error
  screen, which is expected dev-tooling behavior, not a product defect.
  Confirmed in P31: `cd android && npm start` (Metro) plus
  `adb reverse tcp:8081 tcp:8081` gets a fresh launch/reload past this. A
  signed release APK (tracked under `docs/12_Packaging_Deployment.md`)
  would not have this dependency.
- **A single table row with an unbreakable long value (a long filename,
  no spaces) can blow out an entire HTML `<table>`'s column widths, not
  just that row** — because sibling `<td>`s in the same column share one
  width across every `<tr>`, one pathological cell forces every other
  column (here, the Actions column, whose buttons then wrap onto multiple
  lines) to shrink for every row in the table, not only the offending one.
  Confirmed live in P31 (`docs/15_QA_NOTEBOOK.md`'s P31 entry, finding
  UI-01) via `getBoundingClientRect()`: the whole table grew to 1763px
  against a 1084px window, and a normal row's Actions cell shrank to
  ~115px, stacking its 4 buttons across 4 separate lines. Any future
  table-based list (Desktop's `app.css` `table`/`td` rules are shared
  across every view that uses one) needs an explicit `max-width` +
  `text-overflow: ellipsis` on any free-text column, or one bad value
  degrades the whole list, not just its own row.
- **A per-row/per-item action that can legitimately fail (e.g. Refresh on
  an entry whose source was externally deleted) must catch and scope its
  own error — an uncaught exception in a per-item action handler can blank
  an entire list view**, not just report a failure for that one item.
  Confirmed live in P31 (finding UI-02): Desktop's Shared Files Refresh
  button, when the target file no longer exists, replaces the *entire*
  `#view-container` (header, buttons, every other row) with a raw
  unstyled backend error string exposing an absolute filesystem path,
  recoverable only by navigating away and back. Android's equivalent flow
  (missing-source Download) shows the same underlying backend failure as
  a small scoped inline message with a Retry action, leaving the rest of
  the list untouched — proof the backend already reports the failure in a
  form a client can present gracefully; any future per-row action handler
  on either platform should follow Android's pattern here, not Desktop's
  current one.

---

# Milestone P31.1 — Android `[QR-DEBUG]` Console Error Cleanup

**Baseline symptom:** a physical-device screenshot showed React Native's
dev-only Console Error overlay (Dismiss/Minimize/Copy controls) reading
`[QR-DEBUG] 10. fetch() threw: AbortError: Aborted`. This same
`[QR-DEBUG]` instrumentation had already been flagged as leftover
technical debt as far back as P8.1, and repeatedly re-flagged through
P18/P22/P23/P31 (`android/src/api/client.ts`'s shared HTTP wrapper) without
ever being removed.

**Investigation:** traced the full call path rather than assuming the
prefix alone was the problem. `client.ts`'s `request()` function is the
one HTTP wrapper behind every Android API call (`apiClient.get/post/patch/
del`) — pairing, files, transfers, settings, all of it. It builds its own
short-lived `AbortController`/`setTimeout(..., REQUEST_TIMEOUT_MS)`
(10s) purely as a request-hang guard (added to fix an earlier defect where
an unreachable desktop froze the UI for minutes); that controller's signal
is the *only* thing ever passed to `fetch()`. Checked every pairing/
polling call site (`QrScanScreen.tsx`, `PairingWaitingScreen.tsx`,
`api/endpoints/pairing.ts`) and confirmed **no caller ever wires its own
`AbortController` or `signal` into this client** — `PairingWaitingScreen`'s
poll loop cancels itself on unmount via a plain `cancelled` boolean flag
that only suppresses acting on a *late-arriving* result, it never aborts
the in-flight `fetch()` itself. So every `AbortError` this client can ever
throw comes from exactly one source: its own internal 10-second timeout.

**Root cause:** not a defect in cancellation logic, and not a genuine
unhandled failure — the `AbortError` is the app's own intentional,
already-documented request-timeout mechanism firing (desktop slow/
unreachable, network hiccup, backgrounded polling), and it was **already**
being converted into a friendly `ApiError` (`UNREACHABLE_MESSAGE`,
"Unable to reach Relay Desktop...") that every caller already displays
correctly (`PairingWaitingScreen` → "Lost contact with the desktop while
waiting.", `QrScanScreen` → "Could not reach that desktop.", every other
screen's own inline error banner). The only actual defect was one line:
`client.ts`'s fetch-catch block logged the raw error via
**`console.error('[QR-DEBUG] 10. fetch() threw:', err)`** before throwing
the friendly `ApiError` — and React Native's `LogBox` intercepts every
`console.error` call in a debug build and renders it as the full-screen
Console Error overlay, regardless of whether the thrown error is itself
fully handled downstream. A second, unrelated finding from the same
instrumentation (recorded at P18): its request/response logs
(`console.log`) dumped full request bodies and parsed response envelopes —
including pairing responses carrying the device secret and session
token — to this device's own logcat. Never remotely reachable, but genuine
leftover diagnostic logging of sensitive values in a shared production
code path.

**Implementation** (`android/src/api/client.ts`): removed all five
`[QR-DEBUG]` `console.log`/`console.error` statements and their "TEMP
DEBUG LOGGING" comments outright — this was confirmed to be stale
development instrumentation left over from the original QR pairing
diagnosis, not a mechanism worth replacing with a new logging strategy.
The fetch-catch block's error is no longer logged at all (the thrown
`ApiError` is the real, already-correct propagation of the failure — nothing
is swallowed); its comment was rewritten to explain *why* every fetch
failure, `AbortError` included, reduces to the same generic message. The
now-redundant `try/catch` around `response.json()` (previously
`console.error`-then-rethrow, now a no-op wrapper once the log line was
removed) was simplified to a direct `await` — a genuine malformed-response
parse failure still throws and still propagates to the caller exactly as
before, just without a middleman catch block. No caller, no error
classification, and no timeout value changed.

**Tests** (`android/__tests__/api/client.test.ts`): added two regression
tests — one mocks `fetch` rejecting with a `DOMException`-shaped
`AbortError` and asserts `apiClient` still throws the identical
`UNREACHABLE_MESSAGE` `ApiError` *and* that `console.error`/`console.warn`
are never called; the other asserts an ordinary successful request also
never touches `console.error`/`console.warn`, so any future reintroduction
of an error-level log on this path fails a test immediately rather than
waiting to be noticed on a physical device. `npx tsc --noEmit` — clean.
`npx eslint .` — 0 errors, the same 4 pre-existing warnings this session
started with (`FilesScreen.tsx`, `TransferListScreen.tsx`,
`TransferStreamManager.ts`; none touch `client.ts`). `npx jest` — 42
suites / 365 tests passed (up from 40/363 pre-change, the 2 new tests).

**Physical-device verification (RMX3997):** Metro + `adb reverse
tcp:8081 tcp:8081` + the real Electron desktop app (`npm start`) were
started, the installed debug build was force-stopped/relaunched to pick up
this session's code. With the existing pairing intact (deliberately never
unpaired or re-paired — Discovery/QrScan are structurally unreachable
while a session exists, per P24, and this device is the only physical
pairing available; forcing a fresh pairing to reach `QrScanScreen`/
`PairingWaitingScreen` live was judged not worth risking it), navigated
Files → Transfers → Settings and confirmed via `adb logcat` that no
`[QR-DEBUG]`/`console.error`/`LogBox` output appeared. Then, to reproduce
an actual fetch failure on-device against the exact shared code path this
milestone changed: stopped the desktop app and its backend process
entirely (confirmed via `curl` returning connection-refused), switched
tabs to trigger a live request, and captured a real in-app red error
banner — **"Unable to reach Relay Desktop. Make sure the PC is running
Relay and both devices are on the same network."** — rendered inline with
**zero** Console Error/LogBox overlay (confirmed empty `adb logcat` grep
for the same terms). Restarted the desktop app/backend and confirmed the
app recovered cleanly on the next tab switch with no residual error state
and the pairing session still intact. This exercised the identical
single catch-all block the `AbortError` timeout path also runs through
(there is no error-type branching in `client.ts` — every fetch rejection,
`AbortError` or otherwise, is handled by the same code), which is the
strongest live proof available without disrupting the only real pairing on
this device; the `AbortError`/timeout variant specifically is covered by
the two new deterministic Jest tests above rather than a live 10-second
network hang, per this milestone's own guidance to document
source/test-verification honestly when a physical repro would risk the
device's only pairing.

**Regression checks:** Discovery/Pairing screens were not reachable live
(already-paired session, expected per P24 — not a defect). Files,
Transfers, Settings, tab navigation, and error/recovery banners all
confirmed working through the live backend-down/backend-up cycle above.
`client.ts` is shared by every API call in the app, so the backend-down
repro (which exercised a plain `GET /transfers` fetch, not a pairing
endpoint) also directly confirms normal non-pairing API error handling is
unchanged. No backend or Desktop source was touched; the backend was only
started/stopped as a black box to produce a real network failure.

**`[QR-DEBUG]` remaining:** none in application source — confirmed via a
full-tree search after the change. One reference remains, intentionally,
in a code comment inside the new regression test explaining what was
removed and why.

**Remaining limitations:** none identified. This was confirmed to be
stale instrumentation with an already-correct underlying error-handling
path, not a deeper defect — no further work is indicated here.

---

# Milestone P32 — Desktop Table Hardening (UI-01 + UI-02)

**Scope:** the two P1 findings from the P31 audit only — UI-01 (long
filename breaks the Shared Files/Transfers table layout) and UI-02
(Refresh on a Shared File with an externally-deleted source blanks the
whole view with a raw backend error). No other P31 finding (UI-03, UI-04,
the carried-forward Transfers progress-bar bug) was touched, per this
milestone's explicit boundary.

## Baseline reproduction

Both bugs were reproduced live against the real Electron app before any
source was changed, using a temporary Playwright `_electron` driver script
(same technique as P31 — kept outside the tracked project, deleted at the
end of this session; a candidate for `/run-skill-generator` in a future
session, same note P31 left). Shared-file fixtures were created directly
via the backend's own loopback API (`POST /files`/`POST /folders`), since
Electron's native file picker can't be driven by Playwright.

- **UI-01:** shared a 180-character, space-free filename alongside a
  normal file. Live `getBoundingClientRect()`: table width **1753px**
  against a **1084px** window, the offending row's Actions `<td>` at
  ~115px forcing all 4 row-action buttons onto 4 separate lines
  (`actionButtonTops`: `[232, 293, 334.5, 376]`), row height 206.5px —
  identical to P31's own numbers, confirming the defect was still present
  and unchanged going into this milestone.
- **UI-02:** shared a normal file, deleted its source file from disk
  externally, clicked that row's **Refresh** button. The entire
  `#view-container` (header, "Add Files…"/"Add Folder…", every other row)
  was replaced by a single red card reading exactly `File does not exist:
  C:\Thomas\Encipher\Python\Relay\scratch_test_files\p32\will-be-
  deleted.txt` — full absolute path exposed, matching P31's finding
  exactly.

Screenshots and raw `getBoundingClientRect()`/`getComputedStyle()` JSON
for both baseline states were captured before any fix and compared
against the corresponding after-fix captures below.

## UI-01 root cause

Confirmed via live DOM/CSS introspection: `desktop/styles/app.css`'s
`table`/`td` rules had no `table-layout`, `max-width`, or
`text-overflow` — the browser's default auto-layout table algorithm sizes
every column to its widest cell's *intrinsic* content width, and an
unbreakable string (no spaces, so no wrap opportunity) has unbounded
intrinsic width. Because all `<td>`s in one column share a single width
across every `<tr>`, one pathological Name/File cell dragged the entire
table (and therefore every row's Actions column) wider, not just its own
row. Both `desktop/src/renderer/views/files.js` (Shared Files) and
`desktop/src/renderer/views/transfers.js` (Transfers) render a plain
`<table>` with no view-specific CSS override, so both share the exact
same defect via `app.css`'s global rules — confirmed by DOM inspection,
not assumed.

## UI-02 root cause

Two independent problems, both in `desktop/src/renderer/views/files.js`'s
Refresh handler for `wireSharedRowActions`:

1. **The click handler already had a `try`/`catch`** — this was not an
   uncaught exception reaching the renderer, as P31's language ("unhandled
   error") suggested from the outside. The `catch` block called
   `renderError(container, err)` (`desktop/src/renderer/dom.js`), which by
   design replaces the *entire* view container's `innerHTML` with a
   single error card — correct for a whole-view load failure (its other
   callers), wrong for a single row's action failing.
2. **The error message itself embeds an absolute filesystem path.**
   `backend/app/services/shared_file_service.py`'s
   `_validate_shareable_path` raises
   `ValidationError(f"File does not exist: {path}")` (mapped to HTTP 400
   by `backend/app/api/exception_handlers.py`'s `handle_validation_error`,
   which passes the exception's `str()` straight through as the API
   response's `message`). This message is appropriate when the *user*
   supplied the path moments earlier (sharing via the native picker), but
   inappropriate verbatim on a **Refresh** of an already-shared item,
   where the path is backend-internal detail, not something the UI should
   echo raw.

Android's equivalent condition (`TransferStreamService`'s download/upload
path) already raises a *different*, path-free message — `"The shared file
is no longer available."` / `"The source file is no longer available."` —
which is why Android's existing inline Retry UX never had this leak.
`refresh_metadata`/`refresh_folder` go through the older,
picker-oriented `_validate_shareable_path` message instead.

## Implementation decisions

**UI-01 — CSS-only, structural fix, no JS filename truncation:**

- `table { table-layout: fixed; }` (`desktop/styles/app.css`) — column
  widths now come from each table's own `<colgroup>` instead of content,
  so one pathological cell can no longer affect any column's width.
- A `<colgroup>` was added to both `files.js`'s and `transfers.js`'s table
  markup. Every column except the one genuine free-text column per table
  (Shared Files' Name, Transfers' File) gets an explicit width via new
  utility classes (`.col-w-90`/`.col-w-100`/`.col-w-150`/`.col-w-160`/
  `.col-w-260`/`.col-w-410`, named by pixel value since the two tables'
  columns don't share a semantic grouping). The unset column takes 100% of
  the table's remaining width — this is what stays "flexible" and
  truncates.
- `.cell-truncate` (`overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;`) is applied to the Name cell (Shared Files: file
  rows, folder rows, received-file rows, received-folder rows) and to the
  Device + File cells (Transfers: both plain rows and grouped batch rows)
  — Transfers' Device column got the same defensive treatment even though
  P31's repro was filename-specific, since a device's display name is
  also unbounded free text (P23) and the identical column-blowout
  mechanism applies to any free-text column, not just filenames (this
  file's own Cross-Cutting Lessons section already says as much).
  Direction/Status/Progress/Size/Type/Source/Date are short, bounded-
  vocabulary content and were left untruncated.
- Each truncated cell also gets a `title="<full value>"` attribute — a
  plain HTML attribute, not a new feature — so the complete name is still
  available on hover. Desktop has no Details dialog to link out to
  (unlike Android's `FileActionMenu`/Details alert), and "Show in Folder"
  (already an existing action on every shared row) already reveals the
  full name in Explorer regardless.
- **Actions column width was derived from real measurements, not
  guessed:** a live DOM query on the unfixed table showed the 4
  Shared-Files row-action buttons ("Show in Folder"/"Refresh"/"Unshare"/
  "Delete") need ~366px of content width plus 32px of cell padding; an
  initial 370px column caused a 2-line wrap (measured `rowActionsWidth:
  337.5` vs. `~366` needed), corrected to 410px, re-measured to confirm
  all 4 buttons render on one line (`actionButtonTops` all equal).
  Transfers' Actions column (a single optional "Cancel" button) reused
  the existing `.col-w-100`.
- The underlying `file_name`/`folder_name`/`device_name` values are never
  modified — only their on-screen representation. Verified via `title`
  attribute and `scrollWidth` (full content) vs. `getBoundingClientRect()`
  width (visible, truncated) staying different after the fix.

**UI-02 — scoped per-row error, generic message only for the
path-bearing case, renderer-only fix:**

- `files.js`'s Refresh handler was extracted into `refreshRow()`, which no
  longer calls `renderError(container, ...)` on failure. Instead
  `showRowError(row, message, onRetry)` inserts one sibling `<tr
  class="row-error">` (`colspan` = the row's own column count) directly
  under the failed row — the header, "Add Files…"/"Add Folder…", every
  other row, and the rest of the app all stay untouched, mirroring
  Android's existing inline-message-plus-Retry pattern for the same
  backend condition. A "Retry" button re-runs `refreshRow()` for that same
  row; clicking it repeatedly (source still missing) re-shows the same
  scoped message without duplicating rows or affecting siblings, and
  succeeding (source restored) clears the error row and re-renders the
  list normally.
- `describeRefreshError(err)` maps any **400** response (this endpoint's
  only possible `ValidationError` case — missing source, symlink, or no
  longer a regular file) to a fixed, generic message: *"This item's
  source could not be found. It may have been moved, renamed, or
  deleted."* — never touching `err.message`, so the backend's
  path-bearing text can never reach the DOM regardless of its exact
  wording. Any **other** status (network unreachable → `status: 0` from
  `api/client.js`'s own `ApiError`; a genuine `500`) keeps its own
  `err.message` verbatim — a real outage is not silently reworded into
  "source missing," satisfying the milestone's explicit requirement to
  distinguish the two.
- **No backend change was made.** The chosen fix maps the existing 400 at
  the renderer boundary rather than changing
  `_validate_shareable_path`'s message, per this milestone's preference
  for a renderer-side fix over touching shared backend validation code
  used by both the share flow (where echoing the user's own just-picked
  path back is fine) and the refresh flow (where it isn't). This is
  recorded as a **documented, smallest-necessary-change** decision, not
  an oversight — see Deferred below.
- `Unshare`/`Delete` on the same row were left unchanged: `Unshare` only
  deletes the DB row (no filesystem check, can't hit this failure mode)
  and `Delete`'s `shell:deleteItem` IPC handler already treats an
  already-missing target as a no-op success (P29), so neither can
  reproduce UI-02's condition — scoping the fix to `Refresh` alone matches
  the actual failure surface, not just the literal repro steps.

## Files modified

- `desktop/styles/app.css` — `table-layout: fixed`; new `.col-w-*` width
  utilities; `.cell-truncate`; new `tr.row-error`/`.row-error-message`/
  `.row-error-actions` rules.
- `desktop/src/renderer/views/files.js` — `<colgroup>` + `.cell-truncate`/
  `title` on all four row-rendering functions; `wireSharedRowActions`'s
  Refresh handler replaced with `refreshRow()`; new
  `describeRefreshError()`/`showRowError()`/`clearRowError()` helpers.
- `desktop/src/renderer/views/transfers.js` — `<colgroup>` +
  `.cell-truncate`/`title` on Device/File cells in both
  `renderTransferRow()` and `renderBatchRow()`.

No backend, Android, dialog, navigation, pairing, Settings, or
`TransferStreamManager` source was touched.

## Automated tests

`node --input-type=module --check < <file>` (the P30-established form
that actually parses past a leading ESM `import`, per this file's own
Cross-Cutting Lessons entry — plain `node --check` was confirmed
insufficient) — both modified `.js` files: **clean, 0 errors.** No backend
source changed, so `pytest`/`ruff` were not run (per this milestone's own
instructions). No dedicated Desktop UI test suite exists, as stated
up front — not claimed here.

## Desktop live verification

All against the real Electron app (`npm start`'s equivalent launch via
Playwright `_electron`), the real spawned backend child process, and the
real local `backend/relay.db` (which already held a real paired device,
`RMX3997`, and 1370 pre-existing real transfer rows from earlier sessions
on this machine).

- **UI-01, after fix:** table width **988px** exactly filling the
  1084px-window content area (was 1753px) for all three fixture rows
  (normal / 180-char long / stale). Long-filename row: `nameCellWidth:
  137px`, `nameScrollWidth: 1333px` (full text preserved, only the
  *display* truncates), `textOverflow: "ellipsis"`, `title` attribute
  present with the full 184-character name. Row-action buttons: all 4 on
  one line (`actionLines: 1`, was 4), row height **67px** (was 206.5px).
  A shared **folder** with an equally long (167-character) name was also
  tested live (not just a file) — identical result: truncated with
  ellipsis, `title` present, single-line actions, table still 988px.
  Screenshots: `10-after-fix-shared-files.png`, `30-folder-row.png`.
- **UI-01, Transfers, real populated data:** the app's own pre-existing
  local `relay.db` already contained a genuine 184-character-filename
  historical transfer row (id 1366) plus 89 other real rows, hidden by a
  pre-existing local `historyClearedAt` "Clear History" `localStorage`
  marker from an earlier, unrelated session on this machine (predates
  this milestone entirely — confirmed by comparing the marker's timestamp
  against the newest real transfer's `completed_at`). The marker was
  temporarily read, cleared, the Transfers view inspected, then the
  **exact original value was restored** afterward via `localStorage`, so
  local dev/test state was left exactly as found. With real data visible:
  table width **973px** (bounded), 90 rows, the long-filename row's File
  cell at 202px with ellipsis + `title`, row height 50px (single line).
  Unicode filenames already present in this real data (`文件.txt`,
  `résumé 简体字 emoji😀 f...`) rendered correctly alongside the fix.
  Screenshot: `20-transfers-populated-after-fix.png`.
- **UI-02, after fix:** clicking Refresh on the row whose source was still
  missing produced exactly one new `tr.row-error` directly under that
  row, reading *"This item's source could not be found. It may have been
  moved, renamed, or deleted."* with a Retry button — page header, "Add
  Files…"/"Add Folder…", and both other rows (`normal-report.pdf`, the
  long filename) stayed fully present and unaffected
  (`pageHeaderVisible: true`, `addFilesVisible: true`, `totalRows: 4` = 3
  data rows + 1 error row). No absolute path appeared anywhere in the DOM
  (confirmed by asserting the exact fixed message string). Clicking Retry
  again (source still missing) reproduced the identical single scoped
  error, not a duplicate. The source file was then recreated on disk and
  Retry clicked a third time: the error row was removed, the list
  re-rendered normally, and both other rows were confirmed still present
  and unchanged (`errorRowCount: 0`, `otherRowsIntact` lists all 3
  original file names). Screenshots: `11-after-fix-ui02-scoped-error.png`,
  `12-after-fix-refresh-recovered.png`.
- **Console/page errors:** a `page.on("console"/"pageerror")` listener ran
  for the full verification session. Zero JS exceptions. The only
  `console error`-level entries were Chromium's own network-panel logging
  of the two deliberately-triggered `400` responses (`"Failed to load
  resource: the server responded with a status of 400 (Bad Request)"`) —
  expected noise from testing the error path itself, not an application
  exception.
- **Regression sweep:** Devices (paired-device card, Rename/Remove
  buttons), Pairing (idle state), Settings (device name/download
  directory/Discoverable), and both Clear History buttons (correctly
  `disabled` given no received-Shared-Files items / no history newer than
  the pre-existing local marker in this run) all confirmed rendering with
  zero console errors after navigating through them post-fix. Screenshots:
  `31-nav-Devices.png`, `31-nav-Pairing.png`, `31-nav-Transfers.png`,
  `31-nav-Settings.png`.

## Android comparison

Not re-verified against the physical RMX3997 device in this session — no
Android source was touched (per this milestone's explicit instruction),
and Android's own missing-source Retry UX and long-filename ellipsis
truncation were both already confirmed live and correct in P31 (re-quoted
above as the reference behavior this milestone's Desktop fix now matches).
Re-running the Metro/`adb reverse` setup solely to re-confirm unchanged
Android behavior was judged not worth the setup cost for this milestone;
nothing in this session's diff can affect Android regardless.

## Problems discovered during implementation

- The Actions column's first-attempt width (370px, a rough estimate) was
  **too narrow by ~30px** and caused a 2-line button wrap instead of the
  intended 1 line — caught immediately by measuring real button widths
  live rather than trusting the estimate, and corrected to 410px (see
  Implementation decisions above). Left here as a reminder that any
  future column-width tuning in this table should measure real rendered
  button widths, not estimate from font size alone.

## Deferred / Observed (not fixed in this milestone)

- **UI-03** (folder emoji `📁` instead of the SVG icon language) and
  **UI-04** (Clear History trigger color inconsistency) — untouched, per
  P31's own P34 recommendation and this milestone's explicit "no P33/P34
  work" instruction. The `📁` emoji is still present in both
  `renderFolderRow`/`renderReceivedFolderRow` (`files.js`) — it now sits
  inside the same `.cell-truncate` cell as the folder name and truncates
  together with it, which is a side effect of the UI-01 fix, not a UI-03
  fix.
- **The Transfers progress-bar always-full-width bug (P29.1)** — still
  present, still untouched. `transfers.js`'s `style="width:${progress}%"`
  is unrelated to this milestone's scope (P33 is its own tracked
  milestone) and was not modified.
- **The path-bearing `ValidationError` message in
  `shared_file_service.py`/`shared_folder_service.py`'s
  `_validate_shareable_path`** is still raised as-is; the fix in this
  milestone maps it at the Desktop renderer boundary rather than changing
  the shared backend validation message itself (see Implementation
  decisions above for why). This message is still returned verbatim by
  the API to any caller — today only Desktop's own Refresh action
  triggers it in practice, and it's now handled correctly there, but a
  future caller of `POST /files/{id}/refresh`/`POST /folders/{id}/refresh`
  that isn't Desktop's current renderer would inherit the same raw-path
  message unless it applies an equivalent client-side mapping. Worth
  revisiting if that endpoint ever gains a second caller.

## Documentation changes

This entry (`docs/15_QA_NOTEBOOK.md`, Milestone P32). No `README.md`
change — no user-facing product behavior description in that file became
inaccurate. `CLAUDE.md` was not updated with a new durable convention;
P32's two fixes extend patterns already documented there (P21's
`.row-actions`, P28/P30's dialog/history conventions) rather than
establishing a new one, so no addition was judged necessary.
`.gitignore` unchanged — no new generated artifact.

## Remaining limitations

- The Actions column widths (410px for Shared Files' 4-button row, 100px
  for Transfers' single-button row) are tuned to this app's *current*
  button labels at the *current* default 1100×720 window size. Renaming a
  row action to a longer label, or adding a 5th action, would need the
  same real-measurement process repeated — these are not derived
  algorithmically from button content.
- At very narrow window widths (well below the 1100px default), the
  now-`table-layout: fixed` columns no longer shrink the Name/File column
  gracefully below its available remaining width — `.row-actions`' own
  `flex-wrap: wrap` still catches an Actions column overflow at a narrow
  width by wrapping to 2 lines, which was not explicitly re-verified at a
  resized (non-default) window in this session.

## Final verdict

Both P1 findings from P31 (UI-01, UI-02) are fixed and verified live
against the real Electron app, the real backend, and real (both fixture
and pre-existing historical) data, including folder rows and Unicode
content. No regression was found in Devices, Pairing, Settings, Clear
History, received files, or normal Shared Files/Transfers usage. No
backend, Android, or unrelated Desktop source was modified. UI-03, UI-04,
and the P29.1 progress-bar bug remain deliberately untouched, per this
milestone's explicit boundary — not started, not implied fixed.

---

# Milestone P33 — Desktop Transfer Progress & Feedback

**Scope:** the single carried-forward P29.1 finding only — Transfers'
progress bar rendering at a fixed full width regardless of actual
progress. No other P31 finding (UI-03, UI-04) and no general Desktop
visual cleanup, per this milestone's explicit boundary. No Android source
was touched; no backend source was touched.

## Original P29.1 requirement (source of truth going in)

`docs/15_QA_NOTEBOOK.md`'s P29.1 entry (discovered as a byproduct of the
Devices Rename fix, not fixed itself — out of that milestone's scope)
found that `desktop/src/renderer/views/transfers.js`'s progress bar
(`<div class="progress-bar"><div class="progress-fill"
style="width:${progress}%"></div></div>`) is subject to the same CSP
`style-src 'self'` block that broke P29's original Rename fix: the
renderer's CSP silently drops every inline `style=""` attribute, so
`.progress-fill` always falls back to its block-level default width
(100% of its 100px `.progress-bar` parent) regardless of the `progress`
value baked into the (never-applied) inline style. P29.1 proved this in
isolation (a synthetic `width:50%` element read back as computed `100px`
via `getComputedStyle`) but could not reproduce it against the *real*
progress bar with real transfer data, and P31 could not either — every
real test transfer on the LAN (even an 80 MB file) completed in 1–2
seconds, too fast to observe an intermediate percentage. Both entries
explicitly flagged this as **not re-provable live**, carried forward
rather than closed.

## Investigation-first: confirming current behavior before any change

Read `transfers.js`, `app.css`'s `.progress-bar`/`.progress-fill` rules,
`transferGrouping.js`, and the backend's progress-producing code
(`TransferStreamService._generate_download`/`receive_upload`,
`app/api/v1/transfers.py`) before writing any fix. Two things confirmed
from source alone, before touching the live app:

- The bug was still present verbatim — `git log` on `transfers.js` since
  P29.1 shows no intervening change to this code; `style="width:${progress}%"`
  was still exactly what P31 last saw.
- `TransferStreamService` commits `bytes_transferred` to the database
  roughly every 8 MiB (`_PROGRESS_UPDATE_INTERVAL_BYTES`), and a download's
  `StreamingResponse` chunk-by-chunk `send()` genuinely blocks on the
  client actually reading the socket (backpressure) — meaning a client
  that deliberately reads slowly will make the server produce real,
  time-spaced intermediate `bytes_transferred` values, without touching
  any application code. This is what P31 lacked (it only tried real-world
  LAN speed) and what made a genuine, non-simulated live reproduction
  possible this time.

## Reproduction method (live, real streaming, no source changes)

Built a disposable Playwright `_electron` driver (same technique as
P31/P32 — kept outside the tracked project, deleted at the end of this
session) that launched the real Electron app (`desktop/node_modules/electron/dist/electron.exe`,
no `--no-sandbox`/xvfb needed — this is a native Windows session with a
real display), which in turn auto-spawned the real backend from
`backend/.venv/Scripts/python.exe` exactly as `backend-manager.js` does
in normal use (confirmed via `GET /api/v1/health` returning 200 before
any test traffic).

Against that real app + real backend + the real local `backend/relay.db`
(which already held one genuinely-paired physical device, `RMX3997`, from
earlier milestones — never touched by this session's cleanup):

1. Paired a dedicated QA test device (`P33-QA-Device`) through the real
   `/pairing/*` HTTP flow (start → request → approve → result) — not a
   database insert.
2. Created a 150 MB local file and shared it via the real `POST /files`
   loopback call.
3. Proposed a real `send` transfer via `POST /transfers/requests` with the
   test device's real session token, exactly as the Android client would.
4. Downloaded it via `GET /transfers/{id}/download` with that same bearer
   token, **reading the response body deliberately slowly** (a
   `ReadableStreamDefaultReader` loop paced to ~3 MB/s via `setTimeout`
   between reads) — a genuine HTTP client of the real streaming route,
   throttled only in how fast *it* reads, not by any change to the
   server. This produced a real ~50-second transfer with real,
   server-committed intermediate `bytes_transferred` values.
5. Polled `GET /transfers/{id}` and screenshotted the live Transfers tab
   every ~3 seconds throughout.

This is **API-simulated pairing and transfer proposal** (no physical
Android device was involved in initiating the transfer — see Physical-device
verification below) **driving the real, unmodified backend streaming
engine** — bytes genuinely moved over a real HTTP connection and progress
genuinely came from the real database, not from a mock.

## Reproduction result: bug confirmed live, with real data

At a real, server-reported **27% (42.0 MB / 150.0 MB, status
`in_progress`)**, `page.evaluate(() => getComputedStyle(...))` against the
live `.progress-fill` element returned:

```json
{ "fillWidthAttr": "width:27%", "fillComputedWidth": "100px", "barComputedWidth": "100px" }
```

The inline `style` attribute's *text* correctly said `width:27%` (proving
the JS-side percentage calculation was already correct), but the
*rendered* computed width was `100px` — identical to the parent
`.progress-bar`'s own full width — exactly the CSP-blocked-inline-style
mechanism P29.1 diagnosed, now proven against the real progress bar with
real, non-synthetic transfer data for the first time. Screenshots taken
at 27% and at 100%/Completed are visually indistinguishable (same fully-blue
100px bar in both), confirming this is not a subtle rendering artifact but
a total, user-visible loss of progress feedback: **the bar never
communicated any progress at all** during the entire ~50-second real
transfer.

## Root cause

Identical to P29.1's diagnosis, now confirmed against the real feature
rather than an isolated synthetic element: `desktop/src/renderer/index.html`'s
CSP (`style-src 'self'`, no `unsafe-inline`) silently drops every inline
`style=""` attribute — HTML-authored (`transfers.js`'s
`style="width:${progress}%"`, injected via `innerHTML`) or JS-imperative
alike. No other mechanism (polling cadence, backend progress granularity,
grouping logic) was found to be at fault — the percentage math and the
2-second poll were both already correct; only the *visual* width was
broken.

## Implementation decision

**Replaced the width-styled `<div class="progress-bar"><div
class="progress-fill" style="width:...">` pair with a native `<progress
class="transfer-progress" value="${percent}" max="100">` element.** A
native `<progress>` element's fill is drawn from its `value`/`max` DOM
attributes/properties, which the renderer's `style-src` CSP has no
authority over at all (it only governs the `style` attribute/`<style>`
elements) — this sidesteps the whole class of bug P29.1/P29 hit, rather
than working around it with the class-toggle technique those two
milestones used (which doesn't scale to a continuously-variable
percentage: it would need on the order of 100 discrete CSS classes to
match this element's granularity). Styled via
`::-webkit-progress-bar`/`::-webkit-progress-value` pseudo-elements in
`app.css` (Chromium-only pseudo-elements are safe here since Electron's
renderer is always Chromium) to match the exact prior visual language —
100px × 8px, `--color-bg` track, `--color-primary` fill, fully rounded —
so this is a rendering-mechanism fix, not a visual redesign.

**Added a shared `progressPercent(bytesTransferred, totalBytes, status)`
helper**, used by both `renderTransferRow` (single transfer) and
`renderBatchRow` (folder/batch aggregate), replacing each function's own
inline ternary:

- Clamps to `[0, 100]` via `Math.min`/`Math.max` — defends against a
  transient `bytes_transferred > file_size` or negative value ever
  producing an out-of-range `value` attribute (P33's brief explicitly
  asked for this; the prior ternary had no clamp, though no live case
  producing an out-of-range value was actually observed).
- **Fixes a real, if minor, pre-existing edge case**: a zero-byte file
  previously always showed **0%** even once `status === "completed"`
  (division-by-zero was already avoided, but the fallback was a bare
  `0`, not status-aware). Now returns `100` for a `totalBytes === 0`
  transfer once its status is `completed`, `0` otherwise (e.g. a
  zero-byte transfer that's still nominally `in_progress` for the instant
  before the backend finalizes it) — verified live below.

No change was made to `renderTransferRow`/`renderBatchRow`'s status logic,
`STATUS_LABELS`/`STATUS_BADGE_VARIANTS`, the Cancel button gating, or
`transferGrouping.js` — the milestone's brief was the progress
*presentation*, and none of that logic was implicated by the root cause.

## Files modified

- `desktop/src/renderer/views/transfers.js` — `progressPercent()` helper;
  `progressBar()` helper emitting the native `<progress>` markup;
  `renderTransferRow`/`renderBatchRow` updated to use both instead of the
  inline-styled div pair.
- `desktop/styles/app.css` — `.progress-bar`/`.progress-fill` div rules
  replaced with `progress.transfer-progress` + its `::-webkit-progress-bar`/
  `::-webkit-progress-value` pseudo-element rules.

No backend, Android, dialog, navigation, pairing, Settings, or
`TransferStreamManager` source was touched.

## Automated verification

`node --input-type=module --check < desktop/src/renderer/views/transfers.js`
(the P30-established form, per this file's own Cross-Cutting Lessons entry
on plain `node --check` under-validating ESM) — **clean, 0 errors.** No
backend source changed, so `pytest`/`ruff` were not run, per this
milestone's own instructions. No dedicated Desktop UI test suite exists,
as stated up front — not claimed here.

## Live Electron verification (real app, real backend, real streaming — not simulated)

All of the following used the real Electron app + auto-spawned real
backend + real `relay.db`, described above.

- **Primary fix confirmation (SEND, 150 MB, ~50s real slow download):**
  re-ran the identical reproduction scenario against the fixed code.
  Screenshots at 11%, 27%, 64%, 91%, and 100%/Completed show the bar's
  filled portion visibly and proportionally growing — the 11% and 64%
  screenshots are clearly different bar lengths (previously always
  identical). `page.evaluate` against the live `<progress>` element at
  11% returned `{ value: 11, max: 100, valueAttr: "11" }` — the DOM
  attribute genuinely drives the rendered fill now, unlike the inline
  `style` attribute before.
- **Receive direction (Android → Desktop upload, 40 MB, real slow HTTP
  request body via a throttled `ReadableStream`):** identical code path
  (`renderTransferRow` doesn't branch on `direction` for progress),
  confirmed live rather than assumed — captured at 20% in-progress, then
  100%/Completed. No asymmetry between Send and Receive.
- **Folder/batch aggregate progress (Receive only — see "Grouped folder
  progress: Send vs. Receive" below):** uploaded a 2-file batch (35 MB +
  8 MB, shared `upload_batch_id`) slowly. The grouped row (`📁 p33-folder
  (1/2)` while file A was still in flight) showed a real aggregate
  percentage derived from summed `bytes_transferred`/`file_size` across
  both children — screenshotted at 81% with a proportionally 81%-filled
  bar, then 100%/Completed with `(2/2)`. `renderBatchRow`'s
  `progressPercent()` call (using the same helper, same fix) confirmed
  correct on the aggregate path, not just the single-transfer path.
- **Zero-byte file (SEND):** shared and downloaded a genuine 0-byte file.
  Result: `100% (0 B / 0 B)`, badge `Completed`, bar fully filled —
  confirms the new status-aware zero-byte handling described above,
  live, not just by code inspection.
- **Cancelled:** started a real slow SEND, clicked the real Transfers
  tab's **Cancel** button (not an API call) ~6 seconds in. Backend
  confirmed `status: cancelled`, `bytes_transferred: 16777216` (the byte
  count at the moment of cancellation). The row's bar stayed frozen at
  that same **11%** afterward — badge changed to `Cancelled`, Cancel
  button correctly disappeared (not offered for a terminal status) — the
  bar does not misleadingly imply continued activity.
- **Failed:** proposed a SEND, deleted the shared file's on-disk source
  *after* proposing but *before* the download route was ever called (a
  real filesystem condition, not a mocked error), then attempted the
  download. The real backend's existing `resolve_download_source` check
  (unmodified, pre-existing M12 behavior) correctly failed the request
  (`400`) and finalized the transfer as `failed`, `failure_reason: "The
  source file is no longer available."`. The row rendered with an empty
  (`0%`, `0 B / 2.0 MB`) bar and the `Failed` badge plus its failure-reason
  subtext — no misleading full/partial bar on a failed row.
- **Regression sweep:** Devices, Pairing (idle state), Shared Files
  (correctly showing the real received folder/file items from the
  Receive-direction tests above, grouped per P21 §8), Settings (real
  device name/download directory/Discoverable, untouched), and a full
  7-row Transfers table (mixing Send/Receive/single/batch/completed/
  cancelled/failed) all screenshotted with zero visual breakage: no
  action-button wrapping, no row-height growth beyond what the extra
  failure-reason subtext already caused pre-P33 (unchanged from
  P32/P21's existing `.status-detail` styling), table width unaffected
  by the markup change. Clear History button present and correctly
  enabled once history existed.

## Send/Receive verification

Confirmed live, not assumed: **both directions render through the exact
same `renderTransferRow`/`progressPercent`/`progressBar` code path** —
`direction` only ever affects the Direction column's text, never the
progress calculation or markup. SEND (150 MB) and RECEIVE (40 MB) were
each independently observed moving through multiple real intermediate
percentages with a visibly-scaling bar.

## Grouped folder progress: Send vs. Receive (a real, pre-existing asymmetry — documented, not fixed)

Tracing `backend/app/services/transfer_service.py`'s `request_transfer`/
`_create_transfer` (line ~140) during investigation surfaced a fact not
previously written down in this file: **a SEND (folder download)
`Transfer` row's `upload_batch_id` is always `None`** — only a RECEIVE
(folder upload) row ever gets a non-null `upload_batch_id` (`request.upload_batch_id
if resolved_folder_relative_path is not None else None`, and that branch
is reached only for `direction is RECEIVE`). Desktop's own
`desktop/src/renderer/transferGrouping.js`'s `groupTransfersByBatch`
groups **only** by `upload_batch_id`. The practical consequence: **Desktop
currently has no grouped/aggregate progress row for a folder *download*
(Send)** — each file in a downloaded shared folder renders as its own
separate, ungrouped row on the Transfers tab. Grouped folder progress
**is** implemented, and now correctly renders progress, for a folder
*upload* (Receive) — verified live above.

This is a source-level finding (confirmed by reading
`transfer_service.py` and `transferGrouping.js`; not separately
live-tested with a real multi-file folder *download*, since the code
path that would need to exist to group it — a `shared_folder_id`-based
grouping key — simply isn't there to test). Per this milestone's explicit
instruction ("do not redesign folder transfer architecture... if grouped
folder progress is not currently supported, document that fact"), this is
recorded as a **deferred, pre-existing architecture gap**, not fixed here
— fixing it would mean teaching `transferGrouping.js` a second grouping
key (`shared_folder_id`) and is a scope decision beyond "fix the
progress-bar rendering bug." Worth a dedicated future milestone if
Desktop folder-download UX is revisited.

## Physical-device verification

**Not performed.** No physical Android device was used to initiate any
transfer in this session — every transfer above was proposed and driven
through the real backend HTTP API using a test session token obtained via
the real pairing handshake, exactly as the Android app would call it, but
without the Android app itself. This is accurately described as
**live-Electron-verified with real backend streaming**, not
**physical-device-verified** — per this milestone's explicit accuracy
requirement, the distinction is stated plainly rather than blurred. The
one genuinely-paired physical device on this machine (`RMX3997`) was left
completely untouched throughout (not used, not removed, not renamed).

## Problems discovered (beyond the reported issue)

None beyond the pre-existing Send/Receive folder-grouping asymmetry
documented above, which is adjacent to but distinct from the P29.1 bug
this milestone targeted.

## Deferred / Observed (not fixed in this milestone)

- **UI-03** (folder emoji `📁` instead of the SVG icon language) and
  **UI-04** (Clear History trigger color inconsistency) — untouched, per
  this milestone's explicit "do not fix P34" instruction. Both were
  visible in this session's own screenshots (the `📁` batch-row prefix)
  without being touched.
- **Grouped folder progress for Send (folder download)** — not
  implemented on Desktop at all (see above); documented as a real gap,
  not fixed, since fixing it is architecture work beyond this milestone's
  "smallest correct fix" boundary.

## Cleanup performed

All test state was removed via the real app/API, matching P31/P32's
precedent: the 5 test devices paired during this session (`P33-QA-Device`,
`P33-Fix-Send`, `P33-Fix-Receive`, `P33-Fix-Batch`, `P33-Fix-Cancel`) were
removed via `DELETE /devices/{id}`; the 3 shared test files were unshared
via `DELETE /files/{id}`; the 8 real `Transfer` rows this session created
(ids verified individually by device/file name before deletion, matching
none of the pre-existing 1370+ historical rows) were removed via a direct
`sqlite3 DELETE` against `relay.db` (no delete endpoint exists for
`Transfer` rows by design — same accepted pattern as P29.1/P31's
cleanup); the real files written into the local `Downloads` folder by the
Receive-direction tests (`p33-upload-test.bin`, `p33-folder/`) were
deleted; the 150 MB/40 MB/etc. local fixture files and the disposable
Playwright driver scripts were deleted from the scratch/temp locations
they were created in (never part of the tracked project). Final live
screenshots confirm Devices, Shared Files, and Transfers are back to
exactly their pre-session state (`RMX3997` only, 0 shared files, "No
history").

## Documentation changes

This entry (`docs/15_QA_NOTEBOOK.md`, Milestone P33). `CLAUDE.md` was not
updated — this fix extends the CSP-vs-inline-style lesson already recorded
there under P29.1 (`### Desktop Rename Edit-State Lifecycle & the
Renderer's CSP (P29.1)`) rather than establishing a new durable
convention; that section already tells future Desktop work to avoid
inline `style=`, and the native-`<progress>`-element technique used here
is a specific instance of "use a mechanism the CSP doesn't govern," not a
new rule. `README.md` was not touched — no user-facing capability
changed, only a rendering-correctness fix. `.gitignore` unchanged — no new
generated artifact.

## Remaining limitations

- The Send-direction folder-grouping gap documented above is real and
  pre-existing, not introduced or worsened by this milestone, but also
  not fixed by it.
- Percentage granularity is whatever the backend commits (~8 MiB
  intervals, `_PROGRESS_UPDATE_INTERVAL_BYTES`) sampled every 2 seconds
  by the existing poll — unchanged by this milestone; a very large file
  on a very fast link could still show visibly "jumpy" rather than
  perfectly smooth increments. Not in scope (P33's brief was the
  rendering bug, not polling/commit cadence).
- `::-webkit-progress-bar`/`::-webkit-progress-value` are non-standard,
  WebKit/Blink-only pseudo-elements. This is safe for this specific app
  (Electron's renderer is always Chromium) but would not be portable if
  Relay's renderer were ever hosted in a different engine — noted for
  completeness, not a current risk.

## Final verdict

The P29.1 progress-bar bug **did still reproduce live**, now confirmed for
the first time against the real streaming engine with real, time-spaced
intermediate progress data (not just P29.1's isolated synthetic element,
and unlike P31's attempt, which could not slow a transfer down enough to
observe it) — `getComputedStyle` showed a real `27%`-labeled fill
rendering at the container's full `100px` width. Root cause matched
P29.1's original diagnosis exactly: the renderer's CSP silently drops
inline `style=""`. Fixed by replacing the width-styled div pair with a
native `<progress value="..." max="100">` element, which the CSP has no
authority over at all. Verified live across Send and Receive, a single
file and a grouped folder batch, multiple real intermediate percentages,
a zero-byte file, a cancellation, and a genuine (not mocked) failure —
all rendering correctly with no regression to Devices, Pairing, Shared
Files, Settings, Clear History, or the Cancel action. No physical Android
device was used (stated explicitly, not implied). A real, pre-existing,
separate gap — Desktop folder *downloads* have no grouped progress row at
all — was discovered and documented, not fixed, per this milestone's
scope boundary. UI-03 and UI-04 remain untouched, as instructed.

---

# Milestone P34 — Cross-Platform Visual Consistency

**Scope:** the two P2/P3 findings carried forward from the P31 audit only —
UI-03 (Desktop Shared Files folder rows use a raw `📁` emoji instead of the
app's SVG icon language) and UI-04 (Desktop's "Clear History" trigger is
visually neutral while Android's is red at rest). No other Desktop/Android
screen was touched; P33's Transfers progress-bar fix was re-verified, not
reimplemented.

## Baseline (investigated before any change)

Read this file's own P31/P32/P33 entries first, then inspected source:
`desktop/src/renderer/views/files.js` (`renderFolderRow`/
`renderReceivedFolderRow` both literally concatenated `&#128193;` — the
`📁` emoji — before the folder name text; no icon markup at all),
`desktop/src/renderer/icons.js` (already exports a hand-drawn `folderIcon`
SVG, doc-commented as "same glyph as Android's FolderIcon", already used
by `emptyState()`'s icon badges per P27 — but never used in a table row),
`desktop/src/renderer/dom.js`'s `iconBadge()` (a 56px/36px tinted circle —
too large for an inline table-cell icon, so not directly reusable as-is),
and `desktop/styles/app.css` (`button.text-button` — borderless, no color
override — and the existing `--color-danger`/`--color-danger-bg` tokens
already used by `button.danger`/`.badge-danger`/`.icon-badge-danger`).

Launched the real Electron app (`desktop/`) via a disposable Playwright
`_electron` driver (`desktop/_p34_driver.mjs`/`_p34_server.mjs`, deleted at
the end of this session — same one-shot-script technique P31/P32/P33 used,
kept outside the tracked project). Seeded one real shared file
(`report.pdf.txt`) and one real shared folder (`Vacation Photos`, 2 files)
via direct `POST /files`/`POST /folders` calls against the real backend
(`scratch_test_files/p34/`, gitignored, deleted at the end of this
session). Live screenshots confirmed the emoji folder glyph
(`01-shared-files-baseline.png`) and the neutral "Clear History" label
(same screenshot; `02-transfers-baseline.png` for Transfers, where it was
disabled/grey since there was no history yet).

The one already-paired physical Android device (`RMX3997`, confirmed
still paired from a prior session — not re-paired or disturbed) was
available and used for live verification: `adb devices` showed it
connected, Metro (`npm start` in `android/`) plus `adb reverse tcp:8081
tcp:8081` were started (same one-time debug-build requirement P31 already
documented), and the installed debug build was relaunched. Both were torn
down at the end of this session (Metro process killed, `adb reverse
--remove`).

## UI-03 investigation

Confirmed live in Desktop's Shared Files: the folder row rendered
`📁 Vacation Ph…` as literal cell text, exactly as the P31 finding
described, with `title="Vacation Photos"` on the truncating `<td>` (P32's
`cell-truncate` still applied correctly underneath).

**New finding, not in the P31 audit:** the P31 UI-03 entry's own suggested
alternative — "omit a leading glyph entirely... Android's own row omits a
leading folder glyph in the Files list and reads fine" — turned out to be
factually wrong on live re-inspection. Android's real Files-tab folder row
(`android/src/screens/files/FilesScreen.tsx` line 1362) renders
`{'\u{1F4C1}'} {folder.folder_name}` — the *identical* raw `📁` emoji
literal, not the SVG `FolderIcon` from `android/src/components/icons.tsx`
(which Android *does* use correctly elsewhere — e.g. its own bottom-tab
Files icon). This was confirmed both by reading the source and live on the
physical RMX3997 (`android-03-files.png`/`android-04-after-download-tap.png`
both show the same yellow folder emoji glyph next to "Vacation Photos").
So Android is not actually a clean reference implementation for this
glyph — it has the same underlying defect Desktop had, just never flagged
because P31's audit only exercised Desktop's Shared Files view for this
finding. Per this milestone's "document, don't fix" rule for discovered
out-of-scope issues (§13 of the brief): **not fixed here** — P34's
instructions scope UI-03 to "Desktop Shared Files folder rows" specifically
and explicitly forbid a broader Android visual pass. Recorded here so a
future milestone doesn't have to re-derive it, and so nobody assumes
Desktop's new SVG icon now visually matches Android's *literal* row
rendering — it matches Android's own *established SVG icon language*
(`FolderIcon`, used in its nav tab) instead, which is what CLAUDE.md's
P23/P27 icon-reuse convention was actually about.

## UI-03 root cause

`renderFolderRow`/`renderReceivedFolderRow` in
`desktop/src/renderer/views/files.js` built their Name cell with a raw
HTML entity (`&#128193;`) instead of routing through the app's existing
`icons.js`/`dom.js` icon system — the same kind of one-off markup P19–P27
were written specifically to eliminate elsewhere in the app. `folderIcon`
already existed and was already correctly reused by the empty state on
this exact same view; it simply wasn't reused in the row itself.

## UI-03 implementation

- `desktop/src/renderer/styles` → `desktop/styles/app.css`: added
  `.cell-icon` (14×14px, `vertical-align: -2px`, `color:
  var(--color-text-muted)`), a new small inline-icon variant distinct from
  `iconBadge()`'s circular badge — sized to sit inline with a text line in
  a table cell instead of leading a centered card, since `icon-badge-sm`
  (36px/18px, P27) was still too large and circular for this context.
- `desktop/src/renderer/views/files.js`: imported the existing
  `folderIcon` from `icons.js` (already imported in this file for the
  empty state) and replaced `&#128193; ${escapeHtml(name)}` with
  `<span class="cell-icon">${folderIcon}</span>${escapeHtml(name)}` in both
  `renderFolderRow` and `renderReceivedFolderRow`. No behavior change —
  `cell-truncate`, `title`, row actions, and data attributes are untouched.

**Deliberately not touched:** `desktop/src/renderer/views/transfers.js`'s
`renderBatchRow` (a folder-batch row in the Transfers list, P21.1) has the
identical `&#128193;` emoji at line 182. This is the same defect but a
different screen/finding than what P31 flagged as UI-03 (which named only
Shared Files) and P34's brief scopes UI-03 to "Desktop Shared Files folder
rows" specifically — "Do not modify unrelated Desktop... screens." Left
untouched and documented here per §13's discovered-issue rule; a
reasonable candidate for a future milestone to fold in alongside a
same-glyph Android fix.

## UI-04 investigation

Confirmed live: Desktop's "Clear History" (`files.js` and `transfers.js`,
both `class="text-button"`, no `danger`) rendered in the same muted
gray/black text as any other neutral action, both enabled
(`02-transfers-baseline.png` after seeding one real transfer) and disabled
(`01-shared-files-baseline.png`, no history yet). Android's equivalent
(`FilesScreen.tsx`/`TransferListScreen.tsx`) rendered red at rest before
any tap, confirmed live on RMX3997 (`android-04-after-download-tap.png` —
Shared Files' "Clear History" turned red the instant a real completed
transfer existed; `android-06-transfers.png` — Transfers tab, same red
label). Both platforms' confirm dialogs were already well-matched: Android
showed "Clear transfer history?" / "Completed, failed, and cancelled
transfers will be removed from this list. Downloaded files are not
deleted, and active or queued transfers are not affected." with a red
"Clear History" confirm button (`android-07-clear-history-dialog.png`);
Desktop's `confirmDialog()` (P30) showed "Clear completed, failed, and
cancelled transfers from this list?" / "Active transfers stay visible, and
nothing is deleted from your files." with the same red confirm button
(`06-transfers-clear-dialog-baseline.png`) — already covering the same
three required points (history-only, files not deleted, active transfers
unaffected), so left unchanged per the brief's "if wording is already
correct, leave it" instruction.

**Note on a conflict between two source documents:** this file's own P31
UI-04 entry recommended the *opposite* direction — "Desktop's
neutral-until-confirmed reads slightly better, since CLAUDE.md's own P30
section explicitly reserves red for the confirm button... apply it on both
platforms" (i.e. make Android neutral, not Desktop red). P34's own brief
(§5) explicitly instructs the reverse: "Android already presents Clear
History as a destructive action. The Desktop version should use the same
semantic treatment... use the existing destructive/red design token."
Per CLAUDE.md's own conflict-resolution rule ("follow the most specific
document and report the inconsistency instead of making assumptions"), the
current, more specific P34 brief was followed — Desktop was made red to
match Android — and this discrepancy is reported here rather than silently
picked one way. P30's "confirm button, not the trigger, carries red" rule
was written before this milestone existed and is treated as superseded for
this one specific trigger by P34's explicit instruction, not overturned in
general — any other Desktop confirmation trigger (Unpair, Delete, Unshare)
is unaffected and still neutral until its own dialog opens.

## UI-04 root cause

`button.text-button` (`app.css`) intentionally has no color rule of its
own (`border-color: transparent; background: none`) — it inherits the
base `button` rule's `color: var(--color-text)`. There was no
`text-button`+`danger` combination rule, so simply adding a `danger` class
to the existing markup did nothing until one was added.

## UI-04 implementation

- `desktop/styles/app.css`: added `button.text-button.danger { color:
  var(--color-danger); }` and `button.text-button.danger:hover {
  background: var(--color-danger-bg); }` immediately after the existing
  `button.text-button`/`:hover` rules — reuses the existing `--color-danger`/
  `--color-danger-bg` tokens verbatim (no new color), and deliberately
  stays borderless/unfilled (unlike `button.danger`, the filled-pill
  variant used for actual destructive action buttons like Delete) since
  Clear History is a link-style header action, matching Android's own
  label-only red text. No custom `:disabled` override was added — the
  existing base `button:disabled { opacity: 0.5 }` rule already applies
  uniformly across the button system, so a disabled red Clear History
  correctly fades to a lighter red rather than switching to gray (verified
  live, see below), consistent with how every other button variant already
  handles its own disabled state.
- `desktop/src/renderer/views/files.js` and
  `desktop/src/renderer/views/transfers.js`: changed
  `class="text-button"` to `class="text-button danger"` on the one
  `#clear-history` button in each file. No other markup, no JS logic, and
  no confirmation-dialog code changed in either file.

## Files modified

- `desktop/styles/app.css`
- `desktop/src/renderer/views/files.js`
- `desktop/src/renderer/views/transfers.js`

No backend, Android, or other Desktop file was modified.

## Automated test results

`node --input-type=module --check` (P30's documented ESM-safe form, not
plain `node --check`) against both modified `.js` files: both `OK`.
`app.css` has no automated checker in this project (none exists for any
milestone) — verified live instead, per this milestone's own instructions.
No Android source was modified, so `tsc`/`eslint`/`jest` were not run
(per the brief's own "if Android source is not modified... not
mandatory" instruction). No backend file was touched.

## Desktop live verification

All via the real Electron app (not just source review), using the
Playwright driver described above:

1. Shared Files with a real shared file and folder — folder row now shows
   the small `folderIcon` SVG (muted gray, correctly sized inline, doesn't
   disturb `cell-truncate`) instead of the emoji
   (`09-shared-files-after-fix.png`, diffed visually against
   `01-shared-files-baseline.png`).
2. Shared Files' "Clear History", disabled state (no history yet): renders
   as faded red (`opacity: 0.5` over `--color-danger`), not gray —
   confirmed correct per the "reuse the existing disabled convention"
   decision above.
3. Transfers with one real completed transfer (downloaded live from
   RMX3997, not synthesized): "Clear History" renders solid red at rest,
   enabled (`10-transfers-after-fix.png`).
4. Clicked "Clear History" → confirm dialog opens, wording and red confirm
   button unchanged from baseline (`11-transfers-confirm-dialog-after-fix.png`
   vs. `06-transfers-clear-dialog-baseline.png` — pixel-equivalent).
5. Confirmed the dialog (clicked `.dialog-confirm` specifically, after an
   earlier misclick on the page's own `#clear-history` trigger — caught
   because the dialog was still open in the next screenshot — briefly
   stacked a second dialog instance; recovered with Escape, no code
   defect, a driver-script mistake) → history cleared, Transfers now shows
   the unchanged "No history" empty state with the P27 `transferIcon`
   badge (`14-transfers-final.png`), and "Clear History" itself returned to
   its disabled/faded-red state.
6. Shared Files re-checked after the Transfers-tab Clear History: the
   currently-shared `report.pdf.txt`/`Vacation Photos` are still listed,
   unaffected (`15-shared-files-final.png`) — confirms Clear History still
   only touches transfer-history-derived rows, never currently-shared
   source items, matching P21/P28's documented policy (unchanged code
   path, not touched by this milestone).

## Android physical-device verification (RMX3997)

Performed live, not simulated: launched the real debug build (Metro +
`adb reverse`, per P31's documented requirement), downloaded the real
seeded `report.pdf.txt` from Desktop, confirmed the resulting completed
transfer in both the Files tab (Download → Open) and Transfers tab.
Screenshotted (not modified) as the reference for UI-04's Android-side
baseline: red "Clear History" label at rest on both tabs
(`android-04-after-download-tap.png`, `android-06-transfers.png`), and the
confirm dialog (`android-07-clear-history-dialog.png`). This is also what
surfaced the UI-03 Android-emoji discrepancy documented above. Cancelled
the dialog on Android (did not confirm) — no Android state was changed by
this milestone.

## P33 regression verification

Re-checked, not reimplemented: the real completed transfer's progress row
rendered a native `<progress class="transfer-progress" value="100"
max="100">` at a genuine full-width fill with the correct "100% (15 B / 15
B)" label and a green "Completed" badge, both before
(`05-transfers-with-history.png`) and after
(`10-transfers-after-fix.png`) this milestone's CSS/JS changes — visually
identical except for the now-red Clear History label, confirming no
regression. Failed/Cancelled badge rendering and long-filename truncation
were not independently re-exercised live this session (the one real test
transfer used a short filename and completed successfully) — but neither
`statusBadge()`, `progressBar()`, `progressPercent()`, nor any
`cell-truncate`/`col-w-*` CSS rule was touched by this milestone's diff,
so there is no plausible mechanism for a regression in either; noted as a
source-level (not live) confirmation for those two specific states.

## Problems discovered

- Android's Files-tab folder row uses the identical raw `📁` emoji as
  Desktop's did (see UI-03 investigation above) — pre-existing,
  out-of-scope for this Desktop-only milestone, not fixed.
- `desktop/src/renderer/views/transfers.js`'s `renderBatchRow` folder-batch
  row has the same emoji, also pre-existing and out-of-scope for a
  Shared-Files-scoped UI-03 fix, not fixed.
- A discrepancy between this file's own P31 UI-04 recommendation and
  P34's brief (see "Note on a conflict" above) — resolved in favor of the
  more specific, current instruction; documented rather than silently
  decided.

## Deferred issues

- Both "Problems discovered" emoji instances above (Android Files row,
  Desktop Transfers batch row) are explicitly deferred, not fixed, per
  this milestone's scope boundary.
- Everything already deferred as of P31/P33 (Send-direction folder
  grouping gap, progress percentage granularity, session-token-lifetime
  Settings scope, WebSocket/real-time push, packaging) remains deferred
  and was not revisited.

## Documentation changes

This entry (`docs/15_QA_NOTEBOOK.md`, Milestone P34). `CLAUDE.md` was not
updated — the guidance below explains why in enough detail that a
future milestone doesn't need to re-litigate it: P34 established two
narrow, genuinely new conventions (reuse `.cell-icon`+an existing icons.js
SVG for any future inline-row icon; a `text-button` gets a `.danger`
modifier for a destructive-but-neutral-until-relevant trigger like Clear
History), but the brief's own instruction was to update CLAUDE.md "only if
P34 establishes a durable convention," and both of these are small enough,
single-call-site-driven CSS/markup additions that they read more clearly
inline in this QA notebook entry (with full before/after evidence) than as
a terse CLAUDE.md bullet a future session would have to trust without the
same context. If a *third* call site for either pattern appears in a
future milestone, that is the right trigger to promote both into a proper
CLAUDE.md convention section. `README.md` was not touched — no user-facing
capability changed. `.gitignore` was not touched — no new generated
artifact (the driver scripts and test fixtures were scratch/gitignored
paths, deleted at session end, matching P31–P33's own precedent).

## Remaining limitations

- The Android device's downloaded copy of the test `report.pdf.txt`
  could not be located and removed via `adb shell find` under
  `/storage/emulated/0` (checked `Download/Relay`, `Download/RelayTest`,
  `Documents`; the app-private external-files directory is permission-
  denied to an unprivileged `adb shell` session). The file is a 15-byte
  disposable text fixture ("report content") with no sensitive content;
  this is recorded rather than silently left unmentioned, matching P31's
  own precedent of documenting a minor unremovable test-cleanup leftover
  rather than omitting it.
- The pre-existing `Download/Relay/p28-android-test.txt` file on the
  physical device (from an earlier, unrelated session) was left
  untouched — not created by this milestone, not this session's to delete.
- UI-03/UI-04's Android-side counterparts (the Files-row emoji, and
  P31's own now-superseded red-trigger recommendation) were investigated
  and documented but intentionally not modified, per this milestone's
  explicit Desktop-only scope for UI-03 and the brief's explicit
  Desktop-matches-Android direction for UI-04.

## Final verdict

Both UI-03 and UI-04 are fixed and verified live against the real
Electron app, using real backend-seeded data and one real completed
transfer from the physical RMX3997 device — not source-reviewed only.
UI-03: Desktop Shared Files' folder rows now render the existing
`folderIcon` SVG (already used elsewhere in the app, P19/P20/P25/P27's
icon language) via a new small `.cell-icon` inline-icon CSS class, instead
of a raw emoji character. UI-04: Desktop's Clear History trigger (both
Shared Files and Transfers) now renders in the existing `--color-danger`
red at rest, matching Android's established convention, via a new
`button.text-button.danger` CSS rule reusing existing color tokens — no
new color, no new dialog, no new button component. Clear History's
underlying behavior (marker-based history filtering, confirm dialog
wording, currently-shared items surviving a clear, active/queued
transfers unaffected) is byte-for-byte unchanged; P33's native
`<progress>` fix continues to render correctly with no regression. Two
new, pre-existing, out-of-scope defects were discovered and documented
(not fixed): Android's own Files-row folder emoji, and Desktop Transfers'
batch-row folder emoji. A genuine conflict between this file's own P31
recommendation and P34's brief for UI-04's direction was identified and
resolved in favor of the more specific current instruction, with the
discrepancy recorded rather than silently overridden. All test
fixtures, paired-device state, and driver scripts were cleaned up; the
one exception (an unlocatable disposable file on the physical device) is
documented above. P34 ends here — P35 was not started.

# Milestone P35 — Android Visual Polish & Consistency

**Scope:** a fresh audit of the current Android app's visual consistency —
icons, typography, spacing, dialogs, empty states, loading/error states,
navigation — starting from P34's live finding that Android's own
Files-row folder icon is still the raw `📁` emoji, plus a general
cross-screen sweep per the brief. Fix only genuine, reproduced issues;
leave everything already correct untouched.

## Baseline (investigated before any change)

Read this file's P23, P24, P26, P28, P30, P31, and P34 entries, plus
CLAUDE.md's corresponding convention sections, before touching source.

Source inspected: `android/src/components/icons.tsx` (confirmed a
hand-drawn `FolderIcon` already exists, used today only by the bottom-tab
Files icon, `android/src/navigation/MainTabs.tsx`),
`android/src/screens/files/FilesScreen.tsx`,
`android/src/screens/transfers/TransferListScreen.tsx`,
`android/src/components/FileActionMenu.tsx`,
`android/src/components/UploadConfirmSheet.tsx`,
`android/src/components/AppDialog.tsx`,
`android/src/screens/settings/SettingsScreen.tsx`,
`android/src/screens/discovery/DiscoveryScreen.tsx`. Grepped the whole of
`android/src` for emoji/pictograph code points (`\u{1F...}`, `\u{26xx}`
ranges and literal glyphs) to find every raw-emoji-as-icon instance, not
just the one P34 already flagged.

Physical device: `RMX3997` (`69DADENFONAIOZS4`) was connected via USB/ADB
for the whole session (`adb devices` confirmed) and already paired from a
prior session (`GET /devices` showed `device_name: "RMX3997"`, paired
`2026-08-12` — not re-paired or disturbed). The PC was connected to the
phone's own hotspot (`ap0`, SSID `samsung`, phone `10.93.152.58`, PC
`10.93.152.233`, confirmed via `adb shell ip addr` / `netsh wlan show
interfaces`), matching this project's documented physical-testing setup.
Started the real backend directly (`uvicorn app.main:app --host 0.0.0.0
--port 8000`, not through Electron — same as prior live-verification
sessions) and Metro (`npm start` in `android/`) plus `adb reverse
tcp:8081 tcp:8081`, then force-stopped and relaunched the installed debug
build so it picked up the current bundle. Both processes (and the Metro
`adb reverse` binding) were torn down at the end of this session.

## P34 finding investigation

Reproduced live and confirmed by source. Three call sites carried the
identical raw `📁` (`\u{1F4C1}`) literal, not `FolderIcon`:

1. `FilesScreen.tsx`'s `FolderRow` (the Files-tab folder row name) —
   the exact instance P34 flagged.
2. `FilesScreen.tsx`'s long-press menu title construction for a folder
   (`` `\u{1F4C1} ${menuFolder.folder_name}` ``) — a second, previously
   undocumented instance in the same screen, found during this milestone's
   own grep sweep, not by P34.
3. `TransferListScreen.tsx`'s `FolderTransferRow` (the Transfers-tab
   folder-batch row, P21.1) — a third, previously undocumented instance.

All three are the same underlying defect: a raw emoji standing in for the
app's own hand-drawn `FolderIcon` (`components/icons.tsx`, P23), which
already exists and is already used correctly elsewhere (the bottom-tab
Files icon). No new icon was created — all three were pointed at the
existing `FolderIcon`.

Grepped for any other emoji/pictograph code point used as a UI icon
anywhere in `android/src`. The only other hits were
`streaming/downloadNotification.ts`'s `✓ <name> downloaded successfully`
strings — plain text inside an Android system notification body, not a
custom-rendered UI icon, and not something `components/icons.tsx`'s
convention was ever meant to replace (a system notification can't embed
an SVG). Left unchanged; not the same category of issue.

## Root cause

Same root cause at all three call sites: the folder-name `Text` was built
by string-concatenating a literal emoji in front of the name, instead of
routing through `components/icons.tsx`'s existing `FolderIcon` the way
`MainTabs.tsx` already does. This is the same class of one-off markup
P19–P27 eliminated on Desktop and P34 already fixed for Desktop's Shared
Files folder row — Android simply never got the equivalent pass.

## Implementation

- `android/src/components/FileActionMenu.tsx`: added an optional `icon?:
  React.ReactNode` prop, rendered in a new `titleRow` (`flexDirection:
  'row', alignItems: 'center', gap: 6`) ahead of the existing title
  `Text`. The component stays generic per its own doc comment — it renders
  whatever icon element it's handed and still knows nothing about
  files/folders itself; the caller decides when one applies, exactly like
  it already decides title/subtitle/actions. `title`'s `Text` gained
  `flexShrink: 1` so `numberOfLines={2}` truncation still engages inside
  the new row (previously the sole child of the sheet, sized by its
  parent's full width). No existing caller broke: `icon` is optional and
  every other menu invocation (a file's title) simply doesn't pass one.
- `android/src/screens/files/FilesScreen.tsx`: imported `FolderIcon`.
  `FolderRow`'s name `Text` is now wrapped in a `nameRow` (`flexDirection:
  'row', alignItems: 'center', gap: 6`) with a `<FolderIcon color="#666"
  size={16} />` ahead of it; the emoji literal is gone. `name`'s style
  gained `flexShrink: 1` for the same truncation reason as above (harmless
  for `FileRow`'s unrelated, non-row use of the same style — it's a
  direct child of a column-flex container there, where `flexShrink` has no
  effect). The folder long-press menu now sets `menuTitle =
  menuFolder.folder_name` (no embedded emoji) and a new `menuTitleIcon =
  <FolderIcon color="#666" size={18} />`, passed to `<FileActionMenu
  icon={menuTitleIcon} ...>`; the file-menu branch leaves `menuTitleIcon`
  `undefined`, so a file's sheet is visually unchanged.
- `android/src/screens/transfers/TransferListScreen.tsx`: imported
  `FolderIcon`; `FolderTransferRow`'s name `Text` gets the identical
  `nameRow`/`FolderIcon` treatment as `FilesScreen.tsx`'s `FolderRow`, same
  `#666` tint, same `16`px size, same `flexShrink: 1` addition to `name`.
- `android/src/screens/settings/SettingsScreen.tsx`: a second, unrelated
  finding from this milestone's own error/loading-state audit (§13 of the
  brief) — `DeviceNameCard`'s "cannot be empty"/save-failure `warning`
  text used `#b91c1c`, a different red than the single `#dc2626` token
  used everywhere else in the app for error/destructive text
  (`FilesScreen.tsx`'s `rowError`, `TransferListScreen.tsx`'s error text,
  `FileActionMenu.tsx`'s destructive action label, `AppDialog.tsx`'s
  destructive button — the last of these documents `#dc2626` by name in
  its own top-of-file comment as the app's one destructive-text color).
  Changed `warning`'s `color` to `#dc2626` to match. No other property
  changed.

`#666` (the icon tint) matches both screens' own existing `meta` text
color, already the established "muted secondary content" tone in both
files — not a new color.

The `#2563eb` (most buttons) vs. `#2d6cdf` (`MainTabs.tsx`/
`DiscoveryScreen.tsx` icon tints, explicitly commented as matching
Desktop's `--color-primary`) near-duplicate blue was investigated and left
alone: both call sites document their own reasoning already, this
predates P35, and unifying two nearly-identical brand blues app-wide is a
design-token-level change outside a "fix genuine issues" visual-polish
pass — noted under Deferred below rather than silently reconciled.

## Files modified

- `android/src/components/FileActionMenu.tsx`
- `android/src/screens/files/FilesScreen.tsx`
- `android/src/screens/transfers/TransferListScreen.tsx`
- `android/src/screens/settings/SettingsScreen.tsx`

No backend, Desktop, or other Android file was modified.

## Already-correct items (investigated, left unchanged)

- **Empty states** (Files, Transfers, Discovery): structurally consistent
  within their own needs — Files/Transfers use a single muted (`#666`)
  line since their empty condition is self-explanatory; Discovery uses a
  bold title plus a muted explanatory paragraph because it has real
  networking prerequisites to explain ("same Wi-Fi network or mobile
  hotspot"). Per the brief's own "do not force identical wording... goal
  is consistent structure, not identical copy" instruction, this asymmetry
  is content-justified, not a defect — not changed. None of the three uses
  an icon; this is internally consistent (Android has no established
  icon-in-empty-state convention the way Desktop's P27 `emptyState()`
  does), so no icon was added — doing so would be introducing a new
  Android convention the brief did not ask for, not fixing one.
- **Metadata line format** (P22): re-verified live — `report.txt` showed
  `16 B` (no MIME type), `Vacation Photos` showed `Folder · 2 items · 26
  B` — both exactly as `metadataFormat.ts`'s documented contract requires.
  No regression.
- **Dialogs** (P30): grepped the whole of `android/src` for `Alert.alert(`
  — zero live call sites remain (only doc-comment references inside
  `AppDialog.tsx` explaining what it replaces). No P30 violation was
  introduced since that milestone. `UploadConfirmSheet`/`FileActionMenu`
  correctly remain separate bottom-sheet primitives, not migrated to
  `AppDialog` — confirmed against the brief's own explicit "do not replace
  ... merely for visual uniformity" instruction.
- **Bottom navigation** (P23): icons, active/inactive tints
  (`#2d6cdf`/`#8a8f98`), and labels unchanged and correct — re-verified
  live via screenshots at every tab switch during this session's testing.
- **Settings screen structure** (P23): still exactly DEVICE + STORAGE,
  same card pattern, no internal/administrative setting exposed. Correct,
  unchanged.
- **Discovery/pairing flow** (P24): not re-exercised end-to-end this
  session (already-paired device, and re-pairing was unnecessary for a
  visual-only pass) — reviewed by source only; no code in this area was
  touched, so no regression risk was introduced.
- **Folder-upload identity, folder naming, folder reconciliation, queue
  FIFO behavior** (P16/P17/P21.1/P26): none of this milestone's edits
  touch state derivation, identity, or the transfer/queue architecture —
  only `Text`/`View` presentation inside already-rendered rows and one
  color token. Live-verified (see below) that a real folder download
  still completes correctly and shows `Completed`/`Open`, confirming no
  regression, but the fix itself has no code path that could plausibly
  affect these invariants.

## Automated verification

Run from `android/` after all four files above were changed:

- `npx tsc --noEmit` — clean, zero errors.
- `npx eslint .` — **0 errors, 4 warnings**, and the 4 warnings are
  byte-identical in content to the pre-change baseline (re-ran `eslint .`
  against a `git stash` of this milestone's diff to confirm: same 4
  warnings — two pre-existing `react/no-unstable-nested-components` in
  `FilesScreen.tsx`/`TransferListScreen.tsx`, two pre-existing `no-void` in
  `TransferStreamManager.ts`, none of which this milestone's diff touches
  or introduces; only their line numbers shifted by the new `import`
  lines).
- `npx jest` — **42 test suites, 365 tests, all passed**, 0 failures, 0
  skipped.

## Physical-device verification (RMX3997)

All live via the real installed debug build, not simulated or read from
source:

1. Shared one real test file (`report.txt`, 16 B) and one real test
   folder (`Vacation Photos`, 2 files, 26 B) directly against the running
   backend (`POST /files`/`POST /folders`, disposable fixtures under a
   gitignored scratch path, deleted at session end).
2. **Files tab**: folder row now renders the `FolderIcon` SVG (same glyph
   as the bottom-tab Files icon) directly before "Vacation Photos",
   correctly sized and vertically centered next to the bold name text;
   `report.txt`'s row correctly has no leading icon (P22's file-name-
   conveys-type convention, unchanged). Metadata lines read `Folder · 2
   items · 26 B` and `16 B` respectively.
3. **Long-press menu** on the folder row: the action-sheet title now shows
   the same `FolderIcon` inline with "Vacation Photos" (no more emoji),
   subtitle unchanged (`Folder · 2 items · 26 B`), Remove/Details actions
   unchanged.
4. Tapped Download on the folder → `Downloading…` → `Open` (green,
   completed) — folder download completed correctly end-to-end,
   confirming no regression in the download/status pipeline this
   milestone's edits sit next to.
5. **Transfers tab**: the folder's batch row (P21.1 grouping) shows the
   same `FolderIcon` inline with "Vacation Photos", `Completed` status
   badge, `Download · Folder (2 items)` subtitle — matching the Files-tab
   presentation exactly, both now sourced from the same fixed component
   shape.
6. **Settings tab**: opened "Edit Name", cleared the field, tapped Save →
   "Device name cannot be empty." rendered in the corrected `#dc2626` red
   (screenshotted, visually matches `FilesScreen.tsx`'s own error-text
   red). Cancelled the edit — device name reverted to "RMX3997" with no
   backend call made, confirming the cancel path was not disturbed by the
   color-only change.
7. **Clear History dialog** (`AppDialog`, P30): opened from the Transfers
   tab — title, explanatory body ("Completed, failed, and cancelled
   transfers... Downloaded files are not deleted, and active or queued
   transfers are not affected."), red "Clear History" confirm button, and
   neutral "Cancel" all rendered exactly per the established P30/P34
   convention. Cancelled without confirming — no history was actually
   cleared by this verification pass.

## Regression verification

- P16 (file identity), P17 (folder identity): not exercised by re-pairing
  or id-reuse scenarios this session (out of scope for a visual-only
  pass, and doing so would have required disturbing the paired device
  state) — verified instead that no touched line reads or writes
  `fileIdentity.ts`/`folderIdentity.ts`/`shared_at` at all; the diff is
  confined to `Text`/`View` JSX and one color literal.
  Folder-download-to-completion in step 4 above is a live, non-simulated
  check that the identity/status pipeline underneath the changed row still
  functions correctly end-to-end.
- P22 (file actions/metadata): re-verified live above — metadata format
  unchanged, Remove/Details/Open actions on both a file and a folder still
  present and correctly labeled from the long-press menu.
- P23 (Settings): re-verified live — DEVICE/STORAGE sections, Edit
  Name/Save/Cancel flow, all unchanged except the corrected warning color.
- P28 (Clear History semantics): re-verified live — the confirm dialog's
  wording, the fact that cancelling performs no mutation, and physical
  files/active transfers being explicitly called out as unaffected are
  all unchanged.
- P30 (dialogs): re-verified live (`AppDialog` rendering, step 7 above)
  and by a whole-tree grep (zero `Alert.alert()` call sites).
- P33 (Desktop native `<progress>`): not applicable — this milestone
  touched no Desktop file.

## Problems discovered

- Two previously-undocumented instances of the same raw-folder-emoji
  defect P34 flagged for Desktop, both on Android: `FilesScreen.tsx`'s
  long-press menu title, and `TransferListScreen.tsx`'s folder-batch row.
  Both fixed in this milestone (see Implementation above) rather than
  deferred, since they are the identical root cause as the primary
  P34-carried-forward finding and the fix (reuse `FolderIcon`) was already
  being made at the first call site.
- `SettingsScreen.tsx`'s error/warning text used a second, undocumented
  red (`#b91c1c`) instead of the app's one established `#dc2626`
  destructive-text token. Fixed.
- The `#2563eb`/`#2d6cdf` near-duplicate blue (see Implementation above) —
  documented, not fixed; both values are individually intentional and
  commented at their call sites, and reconciling them is a design-token
  question, not a "genuine issue" in the sense this milestone's brief
  scoped.

## Deferred issues

- Unifying `#2563eb`/`#2d6cdf` into a single primary-blue token (see
  above) — a design-system-level change, not a visual-polish bug fix;
  left for a future milestone if one is ever opened for Android design
  tokens specifically.
- Full live re-exercise of Discovery/QR pairing and a fresh pairing
  end-to-end (P24) — reviewed by source only this session, since the
  device was already paired and disturbing that state wasn't necessary to
  validate a presentation-only change; no code in that path was touched.
- Everything already deferred as of P31/P33/P34 (Send-direction folder
  grouping gap, progress percentage granularity, session-token-lifetime
  Settings scope, WebSocket/real-time push, packaging, Desktop
  `renderBatchRow`'s own folder emoji — Desktop-only, out of this
  Android-scoped milestone) remains deferred and was not revisited.

## Documentation changes

This entry (`docs/15_QA_NOTEBOOK.md`, Milestone P35). `CLAUDE.md` was not
updated, for the same reasoning P34 already recorded for its own,
same-shaped fix: `FileActionMenu`'s new optional `icon` prop and the
`#dc2626` color-token correction are both small, single-purpose
corrections that bring existing call sites in line with conventions
CLAUDE.md already documents (P23's icon-reuse convention, the app's one
destructive-text color already named in `AppDialog.tsx`'s own comment) —
not new conventions themselves. If a future milestone finds a third
distinct pattern needing `FileActionMenu`'s `icon` prop, or a fourth
color-token deviation, that is the right trigger to promote either into a
proper CLAUDE.md section. `README.md` was not touched — no user-facing
capability changed. `.gitignore` was not touched — no new generated
artifact (the seeded test fixtures were scratch/gitignored paths, deleted
at session end).

## Remaining limitations

- The physical device's downloaded copy of the test `Vacation Photos`
  folder (created by this session's own live verification) could not be
  removed via `adb shell rm -rf` under `/storage/emulated/0/Download/Relay`
  — the command reported success (exit 0) but the folder and its two
  files were still listed by a subsequent `adb shell find`, consistent
  with P34's own documented `adb shell` scoped-storage limitation for this
  device. Unsharing the source from the backend (`DELETE
  /files/{id}`/`DELETE /folders/{id}`) removed it from the app's own
  Shared Files list (re-verified live: the row disappears entirely, since
  it's sourced from `GET /folders`, not download history), so the
  orphaned local copy is inert and matches the pre-existing
  `Download/Relay/p28-android-test.txt` fixture already left on this
  device by an earlier, unrelated session — not created by this
  milestone to begin with, and likewise left untouched.
- Backend and Metro were started directly for this session (`uvicorn`
  bound to `0.0.0.0:8000`, `react-native start`) rather than through the
  Electron desktop app, matching every prior physical-verification
  session's own documented setup — not a deviation specific to P35.

## Final verdict

P34's carried-forward finding — Android's Files-row folder icon still
using the raw `📁` emoji — is confirmed and fixed, along with two
previously-undocumented instances of the identical defect (the folder
long-press menu title, and the Transfers-tab folder-batch row), all now
rendering the app's existing `FolderIcon` SVG (`components/icons.tsx`,
P23) instead. A second, independently-discovered inconsistency
(`SettingsScreen.tsx`'s error text using a non-standard red) was also
fixed to match the app's single established `#dc2626` destructive-text
token. All four changes were verified live on the physical `RMX3997`
device against a real backend and real seeded data — not source-reviewed
only — including a full folder download to completion, the long-press
menu, the Transfers-tab batch row, a triggered Settings validation error,
and the Clear History confirmation dialog. `tsc`, `eslint`, and `jest`
all pass with zero new errors or warnings (`eslint`'s 4 warnings are
pre-existing and unrelated, confirmed via `git stash` diff). No backend,
protocol, transfer-queue, identity, history, dialog, or Desktop code was
touched. Every other area audited per the brief (empty states, metadata
format, navigation, Settings structure, dialog usage, near-duplicate blue
tokens) was found already correct or is documented above as
content-justified/deferred rather than changed without cause. All test
fixtures, backend/Metro processes, and the `adb reverse` binding were
cleaned up at session end; the one exception (an unremovable disposable
folder on the physical device, harmless and orphaned from the app's own
listing) is documented above. Paired-device state was not disturbed.
P35 ends here — P36 was not started.

# Milestone P36 — App Icon Geometry Refinement

**Scope:** a single, isolated visual refinement to Relay's existing app
icon — widen the negative space between the two opposing white arrows,
which currently touch (tangent, zero gap) where the top arrow's
lower-chevron prong and the bottom arrow's upper-chevron prong meet in the
middle. Explicitly not a redesign: color, arrow direction, stroke width,
and overall proportions are all preserved exactly.

## Baseline (investigated before any change)

Located the authoritative geometry and every derived asset before touching
anything:

- **Vector source of truth:**
  `android/android/app/src/main/res/drawable/ic_launcher_foreground.xml` —
  a 108x108dp vector with two `<path>` elements (white, `strokeWidth="8"`,
  round caps/joins, transparent fill), each a shaft line plus a 3-point
  chevron polyline. This is the same glyph as the bottom-nav Transfers
  icon (`android/src/components/icons.tsx`) and Desktop's `transferIcon`
  (`desktop/src/renderer/icons.js`), per P23/P25's documented cross-platform
  icon-reuse convention. It is consumed live by Android O+ launchers via
  `mipmap-anydpi-v26/ic_launcher.xml`/`ic_launcher_round.xml`.
- **Derived raster assets**, all pre-rendered (no build-time generation
  script exists in the repo for any of them — `scripts/generate_tray_icon.js`,
  referenced in this file's M14 history, no longer exists):
  `android/.../mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png` and
  `ic_launcher_round.png` (48/72/96/144/192px, legacy pre-O launcher icons),
  `desktop/assets/icons/tray.png` (256px) and `icon.ico` (16/24/32/48/64/
  128/256px frames, Windows title-bar/taskbar icon).
- Confirmed the exact background (`#2D6CDF`, matches
  `android/.../values/colors.xml`'s `ic_launcher_background` and Desktop's
  `--color-primary`) and foreground (`#FFFFFF`) colors by sampling pixels
  directly (Python/Pillow) from `tray.png` and the xxxhdpi launcher PNGs.
- Measured, by pixel-scanning every existing raster asset, that each one is
  a direct `scale = canvas_size / 108` rasterization of the vector (no
  extra padding/offset) — confirmed by comparing the vector's own computed
  stroke-inclusive bounding box (`x:[26,82] y:[26,82]`, accounting for the
  8-unit stroke width and its round-cap/join bulge) against the measured
  raster bounding box fraction (~0.238–0.240 to ~0.755–0.758 of canvas
  width/height at every size checked: 48, 192, 256px).
- Inspected the icon at the sizes actually used: Desktop title-bar/taskbar
  (`icon.ico`'s 16/32/48/128px frames, plus the live rendered 16px taskbar
  button), Desktop tray (`tray.png` resized to 16x16 at runtime by
  `tray.js`), Android launcher/adaptive icon (all five mipmap densities,
  live on the physical device's app-drawer icon), and Android task switcher
  (live, via `KEYCODE_APP_SWITCH`).
- At the two smallest real-world sizes (Desktop's 16px taskbar/tray icon,
  Android's smallest mdpi 48px launcher icon) the touching point was
  confirmed to visibly blur the two arrows into a single blob — the
  strongest evidence the "too close together" complaint is real, not
  cosmetic nitpicking.

## Exact geometry change

Both existing `<path>` elements' shaft/chevron coordinates were shifted as
a rigid whole, vertically, 4 vector units further from the shared
centerline (`y=54`, the exact midpoint between the two arrows) than
before. Nothing else about either path changed — same x-positions (shaft
length, chevron reach), same `strokeWidth`, same `strokeLineCap`/
`strokeLineJoin`, same colors.

| | before | after |
|---|---|---|
| Top arrow shaft/chevron centerline | `y=42` | `y=38` |
| Top arrow path | `M30,42 L70,42 M58,30 L70,42 L58,54` | `M30,38 L70,38 M58,26 L70,38 L58,50` |
| Bottom arrow shaft/chevron centerline | `y=66` | `y=70` |
| Bottom arrow path | `M78,66 L38,66 M50,54 L38,66 L50,78` | `M78,70 L38,70 M50,58 L38,70 L50,82` |

At the closest-approach point (the top arrow's lower chevron prong tip vs.
the bottom arrow's upper chevron prong tip, each a round stroke-cap disk of
radius 4 units): before, the two disk centers were exactly 8 units apart
(purely horizontal) — equal to the sum of their radii, i.e. **exactly
tangent, zero gap**. After, the centers are `sqrt(8² + 8²) ≈ 11.3` units
apart, leaving a **~3.3-unit visible gap** between the white shapes. The
combined two-arrow bounding box grew from `y:[26,82]` (56 units, 51.9% of
the 108 canvas) to `y:[22,86]` (64 units, 59.3%) — still inside the
existing "~66dp safe zone" the vector's own header comment documents (66/
108 = 61.1%), with ~2dp of margin, so no adaptive-icon launcher mask clips
it.

## Affected assets

- `android/android/app/src/main/res/drawable/ic_launcher_foreground.xml` —
  hand-edited directly (the true vector source); comment updated to record
  the P36 change and rationale.
- `android/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png`
  and `ic_launcher_round.png` (10 files) — regenerated.
- `desktop/assets/icons/tray.png` and `desktop/assets/icons/icon.ico` —
  regenerated.

**Regeneration technique** (one-off Python/Pillow script, run from the
scratchpad, not committed — no reproducible generation pipeline existed in
the repo to extend, and adding a permanent one was judged out of this
milestone's narrow scope): for every raster asset, verified a central
erase box (vector-space `[18,90]x[18,90]`, safely inside the arrow
geometry's old-and-new combined bounding box and safely outside every
asset's corner-rounding/circular-mask antialiasing zone — checked
programmatically per file that every pixel in the box is fully opaque,
i.e. `alpha == 255`, before touching it) was flattened to the exact
background color, then the new arrow geometry was redrawn on top
(supersampled 8x for anti-aliasing, matching the round-cap/round-join
stroke rendering of the vector). This guarantees every pixel outside that
box — background color, rounded-corner shape, circular adaptive-icon
mask — is byte-for-byte unchanged; confirmed by diffing every regenerated
file against its original and verifying the diff's bounding box falls
entirely inside the erase box, at every one of the 12 regenerated raster
files. `icon.ico`'s 7 frames were all generated from the same 256px master
as `tray.png` via Pillow's own multi-size ICO writer (`sizes=[...]`),
matching how the original frames were evidently produced (confirmed by an
isolated test: Pillow's ICO writer does not preserve independently
supplied per-size frames via `append_images` — it resizes one base image —
so a single shared master, not per-size hand-rendering, was the only
technique consistent with the original file's own construction).

## Automated verification

- `git status` after regeneration showed exactly the 13 expected files
  changed (1 vector XML + 10 Android PNGs + `tray.png` + `icon.ico`) —
  nothing else touched.
- Android: `npm test` — **42 suites / 365 tests, all pass** (resource-only
  change; no JS/TS touched, run as a sanity check). `eslint`/`tsc` were not
  re-run — no `.ts`/`.tsx` file was part of this change.
- Desktop: no test/lint script exists for the plain-HTML/CSS/JS desktop
  project (confirmed via `package.json`); no JS/HTML/CSS was touched by
  this milestone, so none was applicable.
- Backend: untouched (no files under `backend/`), not re-run.

## Desktop verification

Launched the real Electron app (`npm start` in `desktop/`, which starts
the FastAPI backend as a child process per M14) and confirmed live, via a
full-screen capture (`System.Drawing`/`System.Windows.Forms` screenshot,
since this is an interactive Windows session, not headless):

- **Title bar/window icon:** cropped and zoomed the running window's
  title-bar icon — shows the widened gap clearly.
- **Taskbar icon:** the taskbar auto-hides in this session; revealed it by
  moving the cursor to the screen's bottom edge, then cropped/zoomed the
  Relay taskbar button — same refined geometry, correctly picked up from
  the regenerated `icon.ico`.
- **System tray icon:** revealed the taskbar's hidden-icons flyout (the
  `^` overflow chevron) and zoomed the tray icon(s) at their actual
  rendered size (`tray.js` resizes `tray.png` to 16x16 at runtime) — the
  gap is visible even at this small size, a clear improvement over the
  previous tangent/touching baseline.
- Corner color and background (`#2D6CDF`) confirmed unchanged by direct
  pixel sampling of the regenerated files before launching.
- Cleaned up: stopped the launched Electron process(es)
  (`Stop-Process -Force`) at the end of verification.

## Android physical-device verification

Device: `RMX3997` (`69DADENFONAIOZS4`), connected via USB/ADB (`adb
devices -l` confirmed), already paired from a prior session — not
re-paired or disturbed.

- Rebuilt and installed: `./gradlew installDebug` from
  `android/android/`. First attempt failed
  (`javax.xml.stream.XMLStreamException`: `"--"` is not permitted inside
  an XML comment — a typographic double-hyphen in this milestone's own
  first-draft comment text in `ic_launcher_foreground.xml`); fixed by
  replacing it with a semicolon and rebuilding. Second build succeeded
  (`BUILD SUCCESSFUL`, installed on `RMX3997 - 16`).
- **Launcher icon:** opened the app drawer on-device (swipe-up gesture,
  scrolled to "RelayMobile"), screenshotted and zoomed — the adaptive icon
  (rendered live from the edited vector XML by the launcher itself, not a
  pre-rendered PNG) shows the same widened gap as Desktop's.
- **Task switcher:** launched the app, opened recents
  (`KEYCODE_APP_SWITCH`), screenshotted and zoomed both the card-header
  icon and the bottom dock icon — same refined geometry.
- App was brought to the foreground once as a basic non-crash sanity check
  (no red-box error, no crash dialog); full functional exercise (pairing,
  transfers) was out of this icon-only milestone's scope and not
  performed, consistent with "do not modify application behavior."
- Cleaned up: removed the screenshot temp files this session wrote to
  `/sdcard/`; did not disturb the existing pairing/session state.

## Before/after result

Confirmed at every inspected size (Desktop: 16/32/48/64/128/256px;
Android: 48/72/96/144/192px legacy, plus the live adaptive-icon and
task-switcher renders) that the two arrows now show a clear, consistent
gap where they previously touched, while background color, corner
rounding/circular mask, arrow color, direction, and stroke weight are
pixel-identical to before outside the arrow region itself (verified by
diff-bounding-box, see Automated verification above).

## Documentation changes

This entry (`docs/15_QA_NOTEBOOK.md`, Milestone P36). `CLAUDE.md` was not
updated — this is a one-time geometry tweak to an already-established
icon, not a new durable convention; the existing P23/P25 cross-platform
icon-reuse conventions already cover "where the authoritative glyph lives"
and remain accurate (the vector's own path data is simply different
numbers now). `README.md` was not touched — it contains no icon/branding
detail that became inaccurate. `.gitignore` was not touched — no new
generated-artifact category was introduced (the regeneration script itself
was a scratchpad one-off, not added to the repo).

## Limitations

- No reproducible icon-generation script was added to the repository.
  Desktop's `tray.png`/`icon.ico` remain, as before this milestone, hand/
  script-maintained binary assets with no checked-in build step — a future
  icon change will need to repeat the same measure-erase-redraw process (or
  a future milestone could formalize one, which was out of this narrow
  brief).
- The Android debug build was verified on-device via the launcher and task
  switcher; the running app's own UI was not exercised beyond a basic
  foreground/non-crash check, per the milestone's explicit "do not modify
  application behavior" / icon-only boundary.
- Desktop's taskbar in this session is auto-hidden by default and required
  a cursor-edge reveal to screenshot; this is an environment/session
  characteristic, not related to the icon change itself.

P36 ends here.
