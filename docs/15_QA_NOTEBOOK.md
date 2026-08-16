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

# Current Status / Baseline (as of P50)

This section is a short orientation pointer, not a replacement for the
milestone entries below — it exists so a reader doesn't have to scan the
full chronological history to answer "where does the project actually
stand right now." Update it when a milestone materially changes the
answer to one of these; do not expand it into a second changelog.

- **Version 1 is feature-complete** (`CLAUDE.md`) and packaging is done:
  a PyInstaller backend bundle (P38), an NSIS Windows installer (P39), and
  an Android release APK (P40) all exist and were verified together
  end-to-end over a real LAN with no release blockers (P41). Repository
  cleanup (P42), device lifecycle/re-pairing correctness (P43, P43.1),
  stale received-item handling (P44), and packaging/branding metadata
  (P45) are also complete — the packaged backend bundle and installer
  have been rebuilt with every fix through P45 and physically verified.
  **P46 (release candidate audit) re-verified all of the above directly
  against the real artifacts and found one new, physically-reproduced
  issue** — see below and this file's P46 entry.
- **Known limitations, deliberately deferred (not defects):**
  - The Windows installer is not code-signed (out of scope for V1, see
    `docs/12_Packaging_Deployment.md`). Android's release signing identity
    was a local verification keystore through P48 — **P50 replaced it
    with a real production keystore** (see this file's P50 entry); the
    Android signing item from P37/P40 is resolved.
  - Windows Firewall's first-run consent prompt has never appeared in
    this development environment (P39, P41) — **P46 confirmed live that
    functional connectivity works regardless, even on a Public-categorized
    network profile with no bundled firewall rule** (this file's P46
    entry, §5/§6).
  - Android's Files and Transfers screens share one Clear History marker
    but don't live-sync it across an already-mounted screen (P41 entry).
  - `fileIdentity.ts` has the same `shared_files.id` reuse gap P17 fixed
    for `folderIdentity.ts` (`docs/14_Testing_Plan.md` §6) — accepted
    technical debt, not reachable via normal use.
  - Backend/Desktop/Android version strings have not been unified
    (`0.1.0` / `0.1.0` / `1.0`/`1`) — cosmetic, does not affect packaging;
    re-confirmed still unresolved at P46.
  - Automatic Desktop address rediscovery — P47 deliberately implemented
    only a *user-triggered* local recovery ("Forget this desktop"), not
    automatic reconnection or network re-scanning; see this file's P47
    entry §10.
- **P48 (final production rebuild & release sign-off) issued a SHIP
  verdict** — all three artifacts rebuilt fresh from `main` and physically
  re-verified end-to-end; Relay V1 is technically ready to ship (see this
  file's P48 entry).
- **P49 (zero-cost distribution architecture & release strategy)** is an
  investigation-only milestone — no application source changed — that
  decided *how* the already-shipped V1 reaches users: GitHub Releases as
  the sole artifact host, GitHub Pages for a small static website, an
  unsigned Windows installer for V1 (with SignPath Foundation flagged as
  the $0 signed-release path for a later milestone), a new production
  Android keystore required before public distribution (not generated in
  P49), and a `1.0.0` versioning convention to be applied in a later
  milestone. See this file's P49 entry for the full investigation and
  `CLAUDE.md`'s "Zero-Cost Distribution Architecture & Release Strategy
  (P49)" section for the durable decisions. **No public release has
  happened yet** — no GitHub Release, no published website, no production
  Android keystore.
- **P46 (release candidate audit)** found one new release blocker: an
  Android device that pairs once and later can't reach the desktop at its
  originally-stored address (e.g. switching between local Wi-Fi and
  mobile hotspot) had no in-app recovery path — only uninstalling and
  reinstalling the Android app worked. Verdict at the time: **HOLD**.
  **P47 (Android Session Recovery & "Forget This Desktop") resolved this
  blocker** — a Settings action that calls the already-existing
  `SessionManager.clearSession()` on user confirmation, returning the app
  to the pairing flow. Physically verified on RMX3997, including two full
  re-pair cycles confirming P43's identity-reconciliation contract still
  holds (see this file's P47 entry). **The P46 blocker is resolved; no
  milestone is currently HOLD.**
- **P50 (Production Android Signing) is complete.** A real production
  Android release keystore now exists (stored outside the repository,
  never committed), and `app-release.apk` is now signed with it —
  `CN=Relay Labs, OU=Relay` — replacing every prior build's local
  verification identity (`CN=Relay Local Verification, OU=Relay P40`,
  P40/P46/P48). Physically verified on RMX3997: install, launch, QR
  pairing, an authenticated file share/download round trip, and a
  same-key update-continuity test (a second production-signed build
  installed in place over the first, session/pairing data preserved) all
  passed. `versionName`/`versionCode` remain `1.0`/`1`, unchanged — P51
  owns final versioning. See this file's P50 entry for full detail,
  including one OEM-level anomaly discovered (not a signing defect, not
  fixed, documented for the record). No milestone after P50 has begun.

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

**Problem:** At 100-file folder scale, the Files-screen folder button oscillated rapidly between "Downloading..." and "Queued" throughout the download (194 label changes in one run) — read by users as constant flickering, not the "reverts to Download" symptom originally suspected.

**Root cause:** Every child transfer (not just the first) passes through `TransferStreamManager.start()`'s brief `PermissionsAndroid.request()` gate before flipping to `'streaming'` (the same startup gap `P13.3 Correction` designed around for a single transfer). During that gap, `isActive()` is false for every id in the folder while the other ~98 not-yet-started children are genuinely queued, so `computeFolderRowState`'s old `queued` check read `true` at every single child boundary — invisible at small scale (P21.1's 6–12-file tests), continuous at 100 files.

**Fix:** `computeFolderRowState` now treats the folder as "underway" (never `Queued`) once any child has completed or one is genuinely active (`folderDownloadUnderway = anyActive || completedCount > 0`); a folder that hasn't started at all still correctly reports `Queued` behind an unrelated active transfer.

**Verification:** 4 new unit tests (inter-child gap, full 100-child simulation, not-yet-started still queued, active child keeps folder out of queued) — `npx jest` 40 suites/343 tests passing. Live on RMX3997: a fresh 100-file/200MB folder download captured at 0/25/51/75/95/100% showed a stable "Downloading..." throughout with zero flicker, ending "Open" with all 100 files present; P21.1's single-row Transfers grouping confirmed unaffected.

**Known limitation:** `handleFolderDownload`'s sequential propose loop has no per-child retry — a transient failure mid-loop would abort remaining proposals with no auto-resume. Theoretical, not reproduced.

---

# Milestone P22 — Android Files Screen & File Actions UX

**Problem:** The long-press menu offered only Open/Details regardless of an item's state (`New_Issues.txt` §12), and a file's meta line redundantly repeated its MIME type next to an ordering inconsistency with a folder's meta line (§5's Android half).

**Fix:** Per-state action sets — a downloaded file gets Open/Share/Delete(red)/Details; a downloaded folder gets Open/Delete/Details (no Share); anything not-downloaded or downloading/queued gets Remove/Details. **Share** required a new dependency (`react-native-share` `^12.3.1`), since neither RN's own `Share` module (drops `url` on Android) nor `react-native-blob-util` (`ACTION_VIEW` only) can do `ACTION_SEND`; file-only (no folder Share), and unavailable for a custom SAF download location (a confirmed library limitation — detected and rejected with a plain message rather than a broken share). **Delete** is local-only and direction-blind (this screen only ever lists downloadable items) and recursively removes the on-device path. **Remove** is state-dependent: idle/failed dismisses via a new client-local marker (`removedItems.ts`, mirroring `folderIdentity.ts`'s shape including the P17 `shared_at`-reuse guard); pending/in_progress cancels via the same active-vs-queued branch the Transfers tab's own Cancel already uses. New `metadataFormat.ts` (`fileMetaLine`/`folderMetaLine`) is now the single source for the meta line, dropping the MIME type and fixing the ordering.

**Verification:** `npx tsc`/`eslint` clean; `npx jest` 42 suites/357 tests. Live on RMX3997 (full native rebuild for `react-native-share`'s TurboModule): every per-state action set confirmed; Share opened the real `ACTION_SEND` chooser; Delete removed the on-device file/folder and reverted the row; Remove dismissed and survived an app restart without unsharing; a P17 id-reuse regression check (unshare/re-share) correctly un-hid the item; an in-progress Remove genuinely cancelled a 1.6GB transfer mid-stream (`Transfer.status` → `cancelled`).

**Known limitation:** Share is unavailable (with a clear message) for a custom SAF download location; `removedItems.ts`, like every other private-storage registry in this app, is lost on reinstall.

---

# Milestone P23 — Android Settings, Navigation & App Identity

**Problem:** `New_Issues.txt` §3 (no device display-name editing; a download-folder audit), §14 (bottom-nav icons were RN's bare `MissingIcon` placeholder), §13/§1.7 (no real app icon), §15 (Clear History placement).

**Fix:** Added a device display-name edit card to Settings, backed by a new `PATCH /devices/{id}` auth path — `verify_device_owner` (`backend/app/api/dependencies.py`) extends M10's `RequestingDeviceDep` pattern: the loopback desktop caller may rename any device; any other caller must present a session token for that exact `device_id` (a token for a different device gets the same generic 401 as no token, per `docs/10_Security.md` §11). `Session.device_name` is threaded from the pairing submission through `QrScanScreen` → `PairingWaiting` → the built `Session`, rather than an extra `GET` round-trip; `PATCH /devices/{id}` always runs first and only updates the local session on success. Added hand-drawn `react-native-svg` tab icons (`FolderIcon`/`TransferIcon`/`SlidersIcon`, matching Desktop's inline-SVG stroke language) and a real launcher icon (two-opposing-arrows glyph on `#2D6CDF`, matching the eventual Desktop icon per P25). Clear History moved from an in-content row to the native header via `navigation.setOptions`.

**Root cause (bug found during verification):** a pre-P23 session had no `device_name` field at all, rendering Settings' name field blank with a layout gap — fixed by falling back to `getDefaultDeviceName()` whenever `session.device_name` is falsy, both for display and the edit-start draft; saving self-heals the stored session.

**Verification:** `npx tsc`/`eslint` clean (3 pre-existing unrelated warnings); `npx jest` 42 suites/359 tests. Backend: `pytest` 343 passed/2 skipped, `ruff` clean; new backend tests cover self-rename, rejection without a token, and rejection for a mismatched device token. Live on RMX3997 (full native rebuild for `react-native-svg`): renamed the device, confirmed the change survived a tab switch, a full force-stop/relaunch, and a direct `GET /devices` server check; empty-name validation and Cancel both behaved correctly; nav icons and the new launcher icon (verified via the task-switcher card, since this OEM launcher's app drawer wasn't ADB-reachable) confirmed.

**Known limitation:** the pairing-time device-name threading (`QrScanScreen`→`Session`) was verified by code review/type-checking, not a live fresh pairing (would have required unpairing the project's only physical test device); Desktop had no application icon of its own yet at this point (addressed P25).

---

# Milestone P24 — Android Device Discovery & QR Pairing UX

**Problem:** The milestone brief described a discovered-device row that wasn't tappable, asking for a full pairing-shortcut implementation.

**Root cause:** None — a prior commit (`9c84f4d`, predating P18) had already implemented tap-to-scan, the `(desktop_ip, port)` mismatch check, camera-permission states, and the structural fact that Discovery can't show an "already paired" row (confirmed via `git log` and this file's own pre-existing P14.2 entry, read before writing any code). The one genuine gap was visual: the discovered-device row was a flat, unbordered line, and the empty state was one muted sentence.

**Fix:** Added a `DesktopIcon` and made the discovered-device row a card (icon badge + `#f5f5f5`/rounded, matching `SettingsScreen`'s P23 card convention); gave the empty state a bold heading. No pairing/discovery/navigation logic touched.

**Verification:** `npx tsc`/`eslint` clean; `npx jest` 42 suites/359 tests. Live on RMX3997: both entry points (tapped row, "Scan QR to Pair" button) confirmed to open the identical `QrScanScreen`; Fast Refresh confirmed the new card/empty-state render on-device; focus-loss/regain confirmed discovery disappearance/reappearance through `DiscoveryService.stop()`/`start()`. A live end-to-end pairing (approve/reject) was exercised via direct backend API calls against the real running desktop app rather than an actual camera scan, which this session's tooling cannot perform.

**Known limitation:** no live camera-scan pairing or permission-denial UI was exercised this session (requires physically aiming a camera; this OEM also blocks `pm revoke` for permission testing) — verified by source review and existing unit tests instead.

---

# Milestone P25 — Desktop Settings & Application Chrome

**Problem:** `New_Issues.txt` asked to remove the user-facing Session Token Lifetime setting, fix an apparently-wrong Download Directory default, remove/relocate the File/Edit/View/Window menu bar, and add a real Desktop app icon.

**Root cause:** the Session Token Lifetime UI was simply exposing an internal setting. The Download Directory "bug" was **not a code defect** — `AppSettingsService.get_settings()` already resolves a correct `Path.home()/"Downloads"` default, and `TransferStreamService` reads `download_directory` fresh on every use; the value observed (a scratchpad temp path) was leftover local dev-database state written by a previous milestone's own live-verification session. The menu bar was Electron's unconfigured stock default — nothing in the codebase registered a menu role/accelerator. The icon was an unfinished flat color square.

**Fix:** removed the Session Token Lifetime field from the Settings UI only (`PATCH /settings` is a partial update, so the backend field/mechanism is untouched); reset the local dev `app_settings` row to prove the real default resolves correctly; added `Menu.setApplicationMenu(null)`; generated a real multi-resolution `icon.ico`/`tray.png` rendering Android's two-arrows glyph on `#2D6CDF`.

**Verification:** live on the real Electron app + real backend — confirmed the settings field is gone, the real default download path resolves correctly, a `PATCH` to a new directory persists, and a direct exercise of `TransferStreamService.receive_upload` against the live DB actually wrote to the new directory (no physical Android device was available to drive this via a real upload). Title-bar/taskbar icon confirmed showing the new glyph; no menu bar renders. Backend `pytest` 343 passed/2 skipped (unaffected — no backend source changed).

**Known limitation:** the new icon is wired into the running window/taskbar/tray only — no packaged installer/executable icon resource yet (no `electron-builder` config exists at this point; addressed at Packaging & Deployment, P39).

---

# Milestone P26 — Upload & File/Folder Selection UX

**Problem:** `New_Issues.txt` §6 claimed folder uploads flattened the folder's own structure; §7 asked for an explicit "Upload this file/these files/folder" confirmation instead of an unconfirmed picker-triggered upload.

**Root cause:** §6 did **not** reproduce — live testing with a real nested/Unicode/zero-byte tree confirmed P13's folder-upload protocol and P21's received-folder grouping already reconstruct the exact structure byte-for-byte at any nesting depth; no code changed for §6. §7 was real: `TransferListScreen`'s `handleUpload`/`handleUploadFolder` started the transfer the instant the native picker returned, with zero confirmation, and file selection was single-file-only (`allowMultiSelection` defaulted false).

**Fix:** added `UploadConfirmSheet.tsx`, a bottom-sheet `Modal` (matching `FileActionMenu`'s existing convention) shown after the native picker returns and before anything is proposed to the backend, with the exact wording §7 asked for ("Upload this file"/"Upload these files"/"Upload folder"); Cancel discards the pick with zero backend calls. Enabled `allowMultiSelection: true` and extended `handleUpload` to loop over every picked file.

**Verification:** `npx tsc`/`eslint` clean; `npx jest` 42/42 suites, 359/359 tests. Live on RMX3997: multi-file and single-file confirmation sheets showed the correct wording/counts, Cancel produced zero new transfers, and both a direct folder pick and a pick one level above it reconstructed the identical nested structure (including a Unicode filename and a zero-byte file) byte-for-byte on Desktop, grouped into one row.

**Known limitation:** one unrelated RN dev-inspector crash (Metro websocket bridge) was hit once and did not recur — known debug-build flakiness, not a P26 defect, not reachable in a release build.

---

# Milestone P27 — Desktop Navigation, Devices & Overall UX

**Problem:** `New_Issues.txt` §1.1–§1.5 asked for a nav-styling fix, a first-launch-routing fix, a device-status-language fix, and a general Devices/empty-state polish pass.

**Root cause:** three of the five requirements were already fixed by P19 before this milestone started — nav styling (open text + underline, no boxed buttons), first-launch routing (`GET /devices` decides Pairing vs. Devices), and device-status language (only ever "Paired," never a fabricated "Connected/Online," since the backend has no live-connection signal) — all confirmed live via screenshots against both an empty and a populated backend before touching any code. The genuine gap was narrower: `emptyState()` had no icon support (only ever wired up for Pairing's bespoke cards), two of five views had no header subtitle, and the paired-device card had no visual anchor.

**Fix:** extended `emptyState()` with an optional icon/variant; added `iconBadge({size:"sm"})` for an inline (non-centered) badge; added `folderIcon`/`transferIcon` (matching Android's P23 icons) and applied icons+subtitles across Devices/Files/Transfers/Settings; gave the paired-device card a leading icon via a new `.device-card-main` wrapper. The large empty area below a single centered card was investigated and deliberately left alone — it matches Pairing's existing intentional "one focused card" language (P20), not a defect.

**Verification:** live on the real Electron app against both a fresh temp DB and the real dev `relay.db` (1332 historical transfers) — screenshotted every view before/after, confirmed first-launch routing and manual-nav-while-unpaired still work, confirmed the device card's Rename wiring is intact (Remove was not clicked through, to avoid unpairing the one real test device). `node --check` clean on all modified files; no backend/Android source touched.

**Known limitation:** only the app's default 1100×720 window size was verified; Remove was verified as wired but not exercised end-to-end.

---

# Milestone P28 — History & Listing Semantics

**Problem:** a redundant "Backend: ready" status label had no user-facing purpose; Desktop's Shared Files and Android's Files screens had no Clear History action and weren't synced with each platform's existing Transfers Clear History; both platforms' Transfers empty state leaked internal state by showing different text for "never had transfers" vs. "history cleared."

**Root cause:** the status label mirrored `BackendManager`'s internal lifecycle state with no filtering. Shared Files/Files Clear History was never wired up when P21/P14.4 built the Transfers version — same underlying data, two unrelated call sites. The Transfers empty-state text branched directly on whether a local clear-history marker was set.

**Fix:** removed the status-bar footer (`BackendManager` and its IPC plumbing are untouched — still legitimate internal machinery). Desktop's Shared Files and Android's Files now reuse each platform's existing Clear History marker exactly (`transferHistory.js` / `historyReset.ts`) rather than introducing a second history concept — clearing from either screen on a platform hides the same entries everywhere; a currently-shared source item or a re-downloaded item (existence check regresses it to idle) is unaffected. Both Transfers empty states now show one unconditional, non-revealing message. Confirmation copy on all four Clear History actions (2 new, 2 pre-existing) now explicitly states the three preserved things: shared items stay listed, downloaded files stay on disk, active/queued transfers stay visible.

**Verification:** `node --check` clean (Desktop); `npx tsc`/`eslint` clean, `npx jest` 42 suites/359 tests (Android). Live on both platforms against the real dev `relay.db` and a real Android device (reconnected mid-session): shared/downloaded/cleared a file and a folder on each platform, confirmed the marker survives a full process restart, confirmed disk/backend state is untouched by Clear History (source-level proof: `clearTransferHistory` is a pure `localStorage.setItem` with no delete call anywhere in its path), and confirmed cross-screen consistency (clearing from Files also empties Transfers, by design, since they share one marker).

**Known limitation:** found, not fixed, correctly deferred to P29 — the dev database's historical "received" items point at files that no longer exist under the current `download_directory` (dev-database staleness, not a code defect). Android's Transfers screen had the identical empty-state leak as Desktop and was fixed under the same requirement even though not named in the original brief.

---

# Milestone P29 — Desktop Shared Files Lifecycle & Device Rename

**Scope:** two issues deferred from P28: (A) an externally-deleted Shared Files source producing an unhandled error instead of a clean removal, and (B) Devices → Rename doing nothing.

## Issue A — Externally deleted Shared Files

**Problem:** Deleting a shared file/folder's source outside Relay correctly left a stale Shared Files row (the backend deliberately never auto-unshares on refresh — `SharedFileService.refresh_metadata`/`SharedFolderService.refresh_folder`'s documented policy). But clicking Delete on that stale row threw an unhandled error and left the entry permanently stuck — unremovable via Delete (Unshare, which never touches the filesystem, already worked fine on it).

**Root cause:** `ipcMain.handle("shell:deleteItem", ...)` assumed its target always exists and let `shell.trashItem`'s failure propagate as a crash, which ran *before* the unshare call that would otherwise have removed the row.

**Fix:** the handler now checks `fs.existsSync` first and treats an already-missing path as a no-op instead of calling `shell.trashItem` — letting the existing Delete flow (trash → unshare → refresh) complete normally. No new backend endpoint or existence-polling; the deliberate "never auto-unshare on refresh" policy is unchanged — a stale row still only disappears once the user acts on it.

**Verification:** live on the real Electron app against the dev `relay.db`: reproduced the crash pre-fix (share, external-delete, Delete throws); post-fix, both a stale file and a stale folder deleted cleanly (row removed from the UI, backend row confirmed gone via `GET`), while a still-existing shared file's own Refresh/Delete were unaffected. Received items (already routing through the same IPC call) get the same safety for free, with no change to their own derivation logic.

## Issue B — Devices → Rename does nothing

**Problem:** clicking Rename on the paired-device card produced no visible effect.

**Root cause:** `window.prompt()` is unimplemented in this Electron build (confirmed Electron 43.2.0) and throws synchronously — unlike `window.confirm()`, used elsewhere in the same file, which does work. The async click handler's promise rejected before the backend `PATCH` was ever reached.

**Fix:** replaced the native prompt with inline editing inside the device card (a form swapped in for the name/actions row, Save/Cancel, Escape-to-cancel); submitting calls the existing, unchanged `PATCH /devices/{id}` then refreshes the list. A second bug found during this milestone's own verification — toggling the form's visibility via the HTML `hidden` attribute did nothing, because `app.css`'s `display: flex` class rules on the same elements outrank the `[hidden]` user-agent rule — was patched at the time by switching to `element.style.display` mutations. **That patch itself turned out not to work and was superseded by P29.1 below** (a CSP blocks all inline-style application, not just this specific cascade quirk).

**Verification:** live — renamed a device, confirmed the change via a tab-switch and (at the time, before P29.1's correction) what appeared to be a full process restart; Cancel/empty-name/same-name behavior confirmed via the unchanged guard logic. Android's own displayed name was confirmed by source review only (not a live device test) to read the same backend `device_name` column this fix writes to.

**Known limitation:** device-name propagation to Android was source-verified only, not physically confirmed, this milestone.

---

## P29.1 — Desktop Device Rename Edit-State Lifecycle Fix

**Problem:** the Devices tab, on initial launch or after returning from another tab, showed the paired device card already in rename/edit mode with zero clicks — and the normal title/actions row stayed visible *at the same time* as the edit form.

**Root cause:** `desktop/src/renderer/index.html`'s CSP (`style-src 'self'`, no `unsafe-inline`) silently blocks **all** inline-style application — both the HTML `style=""` attribute and, critically, JS `element.style.property =` mutations. The style attribute's *text* still updates (so source review and a shallow live check both looked correct), but Chromium never applies it to actual rendering; only a matching CSS *class* rule wins. This meant P29's `hidden`-attribute fix (patched via `.style.display =`) had never had any visual effect in any session since it was written — confirmed definitively via `getComputedStyle` polling and an isolated reproduction (a standalone element given an inline `style="width:50%"` computed to its parent's full width instead).

**Fix:** replaced inline-style toggling with a CSS class toggle (`.device-card.is-renaming`, `classList.add`/`remove`) — unaffected by `style-src` since it never touches the `style` attribute. This is now the required pattern for any future Desktop renderer code that needs to change an element's visual state at runtime.

**Verification:** live, screenshotted at every step — initial launch (normal), tab remount (normal), explicit Rename (edit form only, title/actions genuinely hidden this time), Cancel (reverts, no residual state), Save (persists), and a genuine full Electron process restart (not just a reload) confirming both backend persistence and the UI's correct default-to-normal state.

**Known limitation / defect found as a byproduct:** the identical CSP-blocking mechanism also silently defeats `desktop/src/renderer/views/transfers.js`'s progress bar (`style="width:${progress}%"`), which therefore always renders at full width regardless of real progress — confirmed in isolation, deferred (Transfers was out of this milestone's scope), fixed later in P33. This also means an earlier "cosmetic noise" note about this same CSP console warning (originally written during P21) was itself wrong — it had only been tested at 100% progress, where a blocked and a correctly-applied inline width render identically.

---

## P30 — Application-Wide Dialog & Confirmation UX

**Problem:** every Desktop confirmation (6 sites: Unpair, Clear History ×2, Unshare, Delete ×2) used a plain unstyled `window.confirm()`; every Android confirmation/alert (10 sites) used a plain `Alert.alert()` — neither matched either platform's established design language, and several used a generic "OK" where a specific label (Delete/Unpair/Clear History) was available and appropriate.

**Fix:** one new primitive per platform, built on each platform's own existing precedent rather than forced into a shared cross-platform component (DOM/CSS vs. React Native genuinely differ): Desktop's `dialog.js` `confirmDialog({title, message, confirmLabel, cancelLabel, destructive})` (returns `Promise<boolean>`, reuses existing `.card`/button tokens, appended to `document.body` so it survives `renderer.js`'s per-view container wipes); Android's `AppDialog.tsx` + `useAppDialog()` (built on the same `Modal`/`Pressable` shapes `FileActionMenu`/`UploadConfirmSheet` already established, API shaped like `Alert.alert` for a near drop-in replacement). Every dialog identified as already-correct (Pairing status cards, both platforms' inline Rename, `FileActionMenu`/`UploadConfirmSheet`, camera-permission UI, Cancel Transfer — which has no dialog by original design, idle-row Remove) was re-audited and deliberately left untouched.

**Verification:** `npx tsc`/`eslint` clean (required 10 `react-hooks/exhaustive-deps` fixes — a `useCallback` must depend on the whole `dialog` object, not `dialog.show`, since `useAppDialog()` returns a fresh object every render); `npx jest` 363/363. Desktop's `node --check` initially gave a false pass on ESM files with a leading `import` — fixed by using `node --input-type=module --check` instead (recorded as a durable tooling lesson). Live on the real Electron app (Cancel/Escape/backdrop-dismiss confirmed on Unpair without ever actually confirming it, to avoid unpairing the one real test device; Delete genuinely confirmed against a throwaway file) and on RMX3997 (Delete and Clear History genuinely confirmed against real device state, hardware back-button dismiss confirmed, cleanup verified afterward).

**Known limitation:** four Android call sites were verified via identical-component reasoning plus static checks rather than individually tapped live on-device.

---

## P31 — Product UI/UX Audit & Finishing Backlog

**Purpose:** an audit-only milestone (no source changed) exercising the real Desktop and Android apps together, including real-world edge cases (a zero-byte file, a mixed Unicode+emoji filename, a 180-character unbroken filename, a nested folder, an 80MB file), to produce an evidence-based finishing backlog.

**Findings:**
- **UI-01 (High):** a single unbreakable long filename in Desktop's Shared Files/Transfers table has no `max-width`/`text-overflow` handling, so it forces the whole `<table>` wider than the window — since table columns share width across all rows, this starves the Actions column for *every* row, stacking each row's action buttons into 4 separate lines. Android's own list handles the identical filename cleanly (ellipsis-truncated). → became **P32**.
- **UI-02 (High):** Desktop's Shared Files Refresh on a row whose source was externally deleted throws an unhandled error that blanks the *entire* view with a raw backend filesystem-path string, until the user navigates away and back. Android's equivalent flow shows a scoped per-row error with Retry, proving the backend already reports this in a form a client can present gracefully — Desktop's handler just doesn't scope it. → became **P32**.
- **UI-03 (Medium):** Desktop's folder rows use a literal `📁` emoji character instead of the app's own hand-drawn SVG icon system used everywhere else. → became **P34**.
- **UI-04 (Polish):** Android's "Clear History" trigger label renders red before its dialog opens; Desktop's equivalent stays neutral until the dialog's own confirm button, per P30's convention. → became **P34**.
- Carried forward, not new: the P29.1-discovered Transfers progress-bar CSP bug remains open — not re-demonstrated fresh here (every real test transfer completed too fast on LAN to catch a partial-progress state). → became **P33**.

**Outcome:** every other core flow (pairing, sharing, downloading, uploading, folder transfers, history, device management, and the Unicode/emoji/zero-byte/large-file edge cases) was re-verified live and found correct on both platforms. No P0 blocker found. The audit recommended and scoped exactly P32/P33/P34 — explicitly declined to manufacture additional milestones beyond what the evidence supported.

---

# Cross-Cutting Lessons

A few gotchas worth remembering independent of any single milestone above:

- **Any new download-path code must resolve on-device identity through the relevant id-keyed registry** (`fileIdentity.ts` for standalone files, `folderIdentity.ts` for folders) — never through `file_name`/`folder_name` alone. Established by P3/P13.2/P16 the hard way.
- **A backend integer primary key is not durable external identity** — a plain SQLite `INTEGER PRIMARY KEY` (no `AUTOINCREMENT`) is reused once its table empties, so any id-keyed local state that must survive a row's deletion-and-replacement needs an independent signal alongside the id (P17 uses `shared_at`, the same role `devices.device_identifier` already plays for pairing).
- **`TestClient`'s in-process ASGI transport cannot simulate a real dropped TCP connection** — anything about client-disconnect handling needs a real `uvicorn` process and a raw socket (P8).
- **Loopback does not reliably exercise real network backpressure** — a stalled `send()` may never occur on loopback even against a dead peer. Test timeout/backpressure logic over a real Wi-Fi link, not localhost.
- **This project's one physical test device is OEM-locked down** (ColorOS/RealmeUI blocks `pm clear`/`pm revoke` even from the `shell` UID, and `adb shell svc wifi disable` does not reliably drop an already-open UDP socket) — use `DELETE /devices/{id}` against the backend to force an unpaired state instead of clearing app data via ADB, drive the app's own focus-loss/regain path instead of toggling Wi-Fi, and rely on source review for a permission-denied UI branch that can't be re-triggered live.
- **The desktop's own unauthenticated routes are loopback-trusted regardless of bearer token** — a verification script must call them from actual loopback for desktop-perspective requests and from the LAN IP for Android-perspective ones, or it silently tests the wrong code path.
- **Backend timestamps are naive (no UTC designator) but represent UTC.** Any code that parses one with `new Date(...)` on Android must force UTC interpretation (append `Z` if missing) or it will silently misbehave by the device's own UTC offset. This bit both the Electron desktop (T3) and Android (P14.4) independently.
- **A patched third-party native dependency is tracked via `patch-package`** (`android/patches/`) — check `docs/upstream/` for the full writeup before assuming a library behaves per its own docs; the Okio `Source` contract violation (P10) is the current example.
- **The desktop's `style-src 'self'` CSP (no `unsafe-inline`) genuinely blocks every inline style from being applied — both an HTML-authored `style="..."` and a JS `element.style.property = value` mutation.** The DOM's `style` attribute *text* still updates (so a shallow source or live check can look correct), but Chromium never renders it; only a matching CSS class rule wins. An earlier note here (from P21) claimed this CSP warning was "cosmetic noise" that doesn't actually strip the style — that was a false negative from testing only at 100% progress, where a blocked and a correctly-applied width are visually identical. P29.1 proved the block is real (a `width:50%` element computed to its parent's full width) and traced it to the same mechanism that left P29's Desktop Devices Rename UI permanently stuck visible. **Any renderer code that needs to change an element's visual style at runtime must use a CSS class toggle (`classList.add`/`remove`) or a native DOM property the CSP doesn't govern (e.g. a `<progress>` element's `value`/`max`) — never `element.style.property =` or an inline `style=""` attribute.** `transfers.js`'s progress-fill bar was a confirmed-live instance of this bug, later fixed in P33 via a native `<progress>` element.
- **A backend action with no delete/undo primitive by design (a `Transfer` row) means any client-facing "clear"/"remove" feature over that data must be client-local** (a marker filtering what's displayed), never a new backend delete route invented to make the UI simpler. Android's `historyReset.ts` established this; Desktop's `transferHistory.js`/`receivedFiles.js` (P21) apply the identical pattern.
- **Git Bash mangles a bare absolute `/storage/...` argument into a Windows path before `adb shell` ever sees it** whenever it's a standalone argument rather than embedded in a quoted string (confirmed live in P28). Prefix the command with `MSYS_NO_PATHCONV=1` for any `adb shell` call taking a bare device-side absolute path as its own argument.
- **`window.prompt()` is unimplemented in Electron and always throws** ("prompt() is not supported") — unlike `window.confirm()`, which works. Any renderer code needing free-text input needs its own input UI (P29 used inline card editing for Devices Rename); check for this category of missing native-dialog support before assuming a `window.*` function behaves like it does in a regular browser.
- **Toggling an element's visibility via the `hidden` attribute/property silently loses to any author CSS rule that sets `display` on that same element** (per the CSS cascade's origin-bucket ordering, any normal-author rule outranks any normal-user-agent rule regardless of selector specificity). Confirmed live in P29. **P29's own fix for this — switching to `element.style.display` — was itself wrong** (the CSP lesson above), superseded by P29.1's CSS-class-toggle fix, which is subject to neither issue.
- **Plain `node --check file.js` silently under-validates a Desktop renderer `.js` file once it hits a leading `import` statement**, since `desktop/package.json` has no `"type": "module"` and Node treats the file as CommonJS by default (confirmed live in P30 with a deliberately-broken file that still reported exit 0). **Use `node --input-type=module --check < file.js` instead** for any future Desktop renderer syntax check.
- **The installed Android build on the physical test device is a debug build and requires a live Metro connection to load at all** — cold-launching it shows React Native's "Unable to load script" screen, expected dev-tooling behavior, not a product defect. `cd android && npm start` (Metro) plus `adb reverse tcp:8081 tcp:8081` gets a fresh launch/reload past this. A signed release APK would not have this dependency.
- **A single table row with an unbreakable long value can blow out an entire HTML `<table>`'s column widths, not just that row**, because sibling `<td>`s in the same column share one width across every `<tr>` under the browser's default auto-layout algorithm. Confirmed live in P31 (finding UI-01, later fixed P32): a 180-character filename grew the whole table past the window width and stacked every row's Actions buttons onto multiple lines. Any table-based list needs `table-layout: fixed` plus an explicit `max-width`/`text-overflow: ellipsis` on any free-text column.
- **A per-row/per-item action that can legitimately fail (e.g. Refresh on an entry whose source was externally deleted) must catch and scope its own error — an uncaught exception in a per-item handler can blank an entire list view**, not just report a failure for that one item. Confirmed live in P31 (finding UI-02, later fixed P32): Desktop's Shared Files Refresh replaced the *entire* view with a raw backend error string exposing an absolute filesystem path; Android's equivalent flow already showed the identical backend failure as a small scoped inline message with Retry.

---

# Milestone P31.1 — Android `[QR-DEBUG]` Console Error Cleanup

**Problem:** a physical-device screenshot showed React Native's dev-only Console Error overlay reading `[QR-DEBUG] 10. fetch() threw: AbortError: Aborted`. This leftover instrumentation had been flagged as technical debt since P8.1 and repeatedly re-flagged through P18/P22/P23/P31 without ever being removed.

**Root cause:** traced the full call path rather than assuming the log prefix alone was the problem. `client.ts`'s `request()` — the one HTTP wrapper behind every Android API call — builds its own 10-second `AbortController` timeout purely as a request-hang guard; no caller ever wires in its own signal, so every `AbortError` this client can throw comes from that timeout alone. The timeout firing (desktop slow/unreachable, network hiccup) was **already** being converted into a friendly, already-correctly-displayed `ApiError` (`UNREACHABLE_MESSAGE`) by every caller. The only actual defect was one line: the fetch-catch block also logged the raw error via `console.error('[QR-DEBUG]...', err)` before throwing the already-handled `ApiError` — and React Native's `LogBox` intercepts every `console.error` in a debug build into a full-screen overlay, regardless of whether the error is already handled downstream. A second, unrelated finding from the same instrumentation (recorded at P18): its request/response `console.log`s dumped full pairing responses — including the device secret and session token — to this device's own logcat (never remotely reachable, but genuine leftover logging of sensitive values).

**Fix:** removed all five `[QR-DEBUG]` `console.log`/`console.error` statements outright. The fetch-catch block's error is no longer logged at all — the thrown `ApiError` is the real, already-correct propagation, nothing is swallowed. No caller, error classification, or timeout value changed.

**Verification:** two new Jest regression tests assert an `AbortError` still produces the identical `ApiError` *and* that `console.error`/`console.warn` are never called, and that an ordinary successful request never touches them either — so any future reintroduction of an error-level log on this path fails a test immediately. `npx tsc`/`eslint` clean; `npx jest` 42 suites/365 tests (up from 363, the 2 new tests). Live on RMX3997: confirmed no `[QR-DEBUG]`/`LogBox` output during normal navigation, then genuinely stopped the desktop backend and triggered a real fetch failure on-device — captured the correct in-app red error banner with **zero** Console Error/LogBox overlay (confirmed via an empty `adb logcat` grep), and confirmed clean recovery once the backend restarted. (The existing pairing was deliberately left intact rather than risking the only physical test device to reach the pairing screens live — the backend-down repro exercises the identical single catch-all `client.ts` code path regardless of which endpoint is being called.)

**Known limitation:** none identified — this was confirmed to be stale instrumentation with an already-correct underlying error-handling path.

---

# Milestone P32 — Desktop Table Hardening (UI-01 + UI-02)

**Scope:** the two P31-audit P1 findings only.

**Problem (UI-01):** a single unbreakable long filename in Desktop's Shared Files/Transfers table forced the whole `<table>` wider than the window, starving the Actions column for every row (buttons stacking onto 4 lines each). Reproduced live pre-fix: table 1753px against a 1084px window, row height 206.5px.

**Root cause (UI-01):** `app.css`'s `table`/`td` rules had no `table-layout`, `max-width`, or `text-overflow` — the browser's default auto-layout table algorithm sizes every column to its widest cell's unbounded intrinsic content width, and since all `<td>`s in one column share one width across every `<tr>`, one pathological cell drags the whole table. Both Shared Files and Transfers share this defect via `app.css`'s global rules.

**Fix (UI-01):** `table-layout: fixed` plus an explicit `<colgroup>` per table (pixel-named utility classes, since the two tables' columns don't share a semantic grouping) with exactly one flexible free-text column per table (`.cell-truncate`: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, plus a `title` attribute for the full value on hover) — applied to Shared Files' Name column and Transfers' Device + File columns (Device included defensively, since any free-text column can hit the same mechanism). The Actions column width (410px for Shared Files' 4-button row) was derived from real measured button widths, not estimated — an initial 370px guess still caused a 2-line wrap, corrected after measuring.

**Problem (UI-02):** Desktop's Shared Files Refresh on a row whose source was externally deleted blanked the *entire* view with a raw, unstyled error card exposing an absolute filesystem path — recoverable only by navigating away and back.

**Root cause (UI-02):** two compounding issues in `files.js`'s Refresh handler: (1) its existing `catch` block called `renderError(container, err)`, which by design replaces the whole view — correct for a whole-view load failure, wrong for one row's action failing; (2) the backend's `_validate_shareable_path` raises `ValidationError(f"File does not exist: {path}")` with the raw path embedded — appropriate when the user just picked that path via the native share dialog, wrong verbatim on a Refresh of an already-shared item. Android's equivalent flow already raises a different, path-free message for the same condition, which is why its own inline-Retry UX never had this leak.

**Fix (UI-02):** Refresh now inserts one scoped `<tr class="row-error">` under just the failed row (via new `showRowError()`/`describeRefreshError()` helpers) with a Retry button — the rest of the view is untouched. Any `400` from Refresh is mapped to a fixed, generic message ("This item's source could not be found...") without ever touching `err.message`; any other status (network-down, `500`) keeps its own message. No backend change was made — the fix maps the existing response at the renderer boundary rather than touching the shared backend validation message (also used by the share flow, where echoing the just-picked path is fine).

**Verification:** `node --input-type=module --check` clean on both modified files. Live on the real Electron app against the real dev `relay.db` (1370+ historical rows): UI-01 — table shrank to 988px (was 1753px), long filename truncated with ellipsis + `title`, all 4 action buttons on one line, row height 67px (was 206.5px); confirmed for both a file and a folder row, and against real historical Transfers data including existing Unicode filenames. UI-02 — Refresh on the missing-source row now produces exactly one scoped error row with the generic message and a working Retry (repeated retry doesn't duplicate; restoring the source and retrying clears the error and re-renders normally); zero JS console errors throughout; a full regression sweep (Devices, Pairing, Settings, both Clear History buttons) confirmed unaffected.

**Known limitation:** Actions-column widths are tuned to the current button labels/window size, not derived algorithmically — a longer label or a 5th action would need the same measurement process repeated. The path-bearing backend message itself is unchanged (only mapped client-side); a future non-Desktop caller of the refresh endpoints would inherit the same raw-path message. UI-03, UI-04, and the P29.1 progress-bar bug were explicitly left untouched, per this milestone's boundary.

---

# Milestone P33 — Desktop Transfer Progress & Feedback

**Scope:** the single carried-forward P29.1 finding — Transfers' progress bar rendering at a fixed full width regardless of actual progress.

**Problem:** P29.1 had proven the CSP-blocks-inline-style mechanism in isolation but couldn't reproduce it against a *real* transfer (every real LAN transfer completed in 1-2 seconds, too fast to observe). This milestone found a way to force a real, non-simulated slow transfer: `TransferStreamService`'s `StreamingResponse` genuinely blocks on backpressure, so a client that deliberately reads the response body slowly makes the server produce real, time-spaced intermediate `bytes_transferred` values with zero application-code changes. Using this, a real 150MB download throttled to ~3MB/s confirmed the bug live for the first time against genuine data: at a real, server-reported 27% progress, the inline `style` attribute's *text* correctly read `width:27%`, but `getComputedStyle` showed the rendered width was `100px` — identical to the container's full width. The bar never communicated any progress during the entire ~50-second transfer.

**Root cause:** identical to P29.1's diagnosis (the CSP blocks all inline `style=""` application), now confirmed against the real feature.

**Fix:** replaced the width-styled `<div>` pair with a native `<progress class="transfer-progress" value="${percent}" max="100">` element — a `value`/`max` DOM property is outside the CSP's authority entirely, unlike `style`. Styled via Chromium-only `::-webkit-progress-bar`/`::-webkit-progress-value` pseudo-elements (safe since Electron's renderer is always Chromium) to match the prior visual language exactly. Added a shared `progressPercent(bytesTransferred, totalBytes, status)` helper (used by both the single-transfer and folder-batch row renderers) that clamps to `[0, 100]` and fixes a real minor pre-existing edge case: a zero-byte file now correctly shows 100% once `status === "completed"` instead of always 0%.

**Verification:** `node --input-type=module --check` clean. Live against the real app + real backend + real streaming (not simulated) across: a 150MB slow SEND (screenshots at 11/27/64/91/100% show a visibly, proportionally growing bar); a 40MB slow RECEIVE (identical code path, no Send/Receive asymmetry); a 2-file batch upload's grouped aggregate progress; a genuine zero-byte transfer (100%, correctly filled); a real Cancel mid-transfer (bar freezes at the cancelled byte count, Cancel button correctly disappears); and a genuine (not mocked) failure from a deleted source file (bar stays empty, Failed badge with reason). A full regression sweep across Devices/Pairing/Shared Files/Settings/a 7-row mixed Transfers table found no breakage. No physical Android device was used — every transfer was proposed via the real backend HTTP API using a test session token obtained through the real pairing handshake, not through the Android app itself.

**Known limitation / discovered but deferred:** tracing `transfer_service.py` during investigation found a real, pre-existing, separate gap — a SEND (folder download) `Transfer` row's `upload_batch_id` is always `None` (only a RECEIVE/upload row gets one), so Desktop's `transferGrouping.js` (which groups only by `upload_batch_id`) has **no grouped/aggregate progress row for a folder download** — each file renders as its own separate row. Documented, not fixed (would need teaching the grouping logic a second key, `shared_folder_id` — out of this milestone's "fix the rendering bug" scope). UI-03 and UI-04 remain untouched, per this milestone's boundary.

---

# Milestone P34 — Cross-Platform Visual Consistency

**Scope:** the two P31-audit P2/P3 findings — UI-03 (Desktop Shared Files folder rows use a raw `📁` emoji instead of the app's SVG icon language) and UI-04 (Desktop's "Clear History" trigger is visually neutral while Android's is red at rest).

**Fix (UI-03):** `renderFolderRow`/`renderReceivedFolderRow` (`desktop/src/renderer/views/files.js`) replaced the `&#128193;` HTML entity with the existing `folderIcon` SVG (already used by this same view's empty state, P27), via a new small inline-icon CSS class `.cell-icon` (14×14px, distinct from the larger circular `iconBadge()`).

**New finding during investigation:** the P31 audit's own suggested reference ("Android's row omits a leading folder glyph and reads fine") was factually wrong — Android's real Files-tab folder row renders the *identical* raw `📁` emoji, not its own `FolderIcon` SVG (which it does use correctly elsewhere, e.g. its bottom-tab icon). Desktop's fix therefore matches Android's *established SVG icon language*, not its literal row rendering. Documented, not fixed here (Desktop-only scope) — fixed later in P35.

**Fix (UI-04):** added `button.text-button.danger { color: var(--color-danger) }` (reusing the existing color token, no new color) and applied it to both platforms' Clear History triggers. **Note:** this directly reverses the P31 audit's own recommendation (which favored making Android neutral instead) — P34's own brief explicitly instructed the opposite direction, and per the project's own conflict-resolution rule ("follow the most specific document"), the current, more specific instruction was followed and the discrepancy recorded rather than silently picked. This is a one-time exception to P30's general "only the confirm button carries red" rule for this one specific trigger, not a reversal of that rule elsewhere.

**Verification:** `node --input-type=module --check` clean on both modified files. Live on the real Electron app (folder row now shows the small SVG icon correctly inline; Clear History renders solid red when enabled and correctly fades (not grays) when disabled, matching the existing disabled-opacity convention) and on RMX3997 (confirmed Android's own red-at-rest baseline, which is what surfaced the UI-03 Android-emoji discrepancy above). P33's native `<progress>` fix re-confirmed unaffected.

**Known limitation:** Android's own Files-row folder emoji and Desktop Transfers' `renderBatchRow` folder-batch row (same emoji, different screen) were both discovered but left untouched, per this milestone's Desktop-Shared-Files-only scope for UI-03 — became **P35** (Android) and remains open on the Desktop Transfers row specifically.

---

# Milestone P35 — Android Visual Polish & Consistency

**Problem:** a fresh Android-wide sweep, starting from P34's finding that Android's own Files-row folder icon is still the raw `📁` emoji.

**Root cause:** the folder-name `Text` was built by string-concatenating a literal emoji instead of routing through the app's existing hand-drawn `FolderIcon` (`components/icons.tsx`, P23), which was already used correctly elsewhere (the bottom-tab icon). A full-tree grep for emoji/pictograph code points found two more, previously undocumented instances of the identical defect beyond the one P34 flagged: `FilesScreen.tsx`'s long-press menu title for a folder, and `TransferListScreen.tsx`'s folder-batch row (P21.1).

**Fix:** all three now render `FolderIcon` instead of the emoji literal — `FileActionMenu.tsx` gained an optional `icon` prop for its title row (used only when a folder's menu opens; a file's menu passes none, unchanged). A second, unrelated finding from the same audit pass: `SettingsScreen.tsx`'s `DeviceNameCard` warning text used a non-standard red (`#b91c1c`) instead of the app's one established `#dc2626` destructive-text token (already documented by name in `AppDialog.tsx`'s own comment) — corrected to match.

**Verification:** `npx tsc`/`eslint` clean (4 pre-existing, unrelated warnings, confirmed unchanged via `git stash` diff); `npx jest` 42 suites/365 tests. Live on RMX3997: shared a real file and folder, confirmed the folder row, long-press menu title, and Transfers batch row all now show the SVG icon; a full folder download completed correctly end-to-end (confirming no regression in the identity/status pipeline the changed rows sit next to); triggered a Settings validation error and confirmed the corrected red; re-confirmed the Clear History dialog (P30) renders unchanged. A wide sweep of already-correct areas (empty states, metadata line format P22, dialog usage — zero remaining `Alert.alert()` call sites — bottom nav, Settings structure) was re-verified and left untouched.

**Known limitation:** a near-duplicate blue (`#2563eb` on most buttons vs. `#2d6cdf` on nav/discovery icon tints, the latter deliberately matching Desktop's `--color-primary`) was investigated and deliberately left unreconciled — a design-token-level decision outside this visual-polish pass's scope, not an oversight.

---

# Milestone P36 — App Icon Geometry Refinement

**Problem:** Relay's two-opposing-arrows app icon glyph had its two arrows' closest chevron tips exactly tangent (zero gap) — confirmed to visibly blur into a single blob at the smallest real-world sizes (Desktop's 16px taskbar icon, Android's 48px mdpi launcher icon).

**Fix:** shifted both arrows' path coordinates in the vector source of truth (`android/android/app/src/main/res/drawable/ic_launcher_foreground.xml`) 4 vector units further apart from the shared centerline each way — color, direction, stroke width, and overall proportions all preserved exactly; the combined bounding box grew from 51.9% to 59.3% of the 108-unit canvas, still safely inside the vector's documented ~61% safe zone. All 12 derived raster assets (5 Android mipmap densities × 2 icon variants, Desktop's `tray.png`/`icon.ico`) were regenerated using a verified technique: erase only a proven-fully-opaque central region and redraw the new geometry there, leaving every other pixel (background, corner-rounding, adaptive-icon mask) byte-for-byte unchanged — confirmed via a diff-bounding-box check on every regenerated file.

**Verification:** `git status` confirmed exactly the 13 expected files changed. Android `npm test` 42 suites/365 tests (sanity check — no JS/TS touched). Live: Desktop's title-bar, taskbar, and system-tray icons all screenshotted showing the new gap at their actual rendered sizes (including the 16px tray icon); Android's launcher icon (rebuilt and installed on RMX3997, live adaptive-icon render) and task-switcher card both confirmed the same refined geometry. Background color and corner rounding confirmed pixel-unchanged by direct sampling.

**Known limitation:** no reproducible icon-generation script was added to the repo — a future icon change would need to repeat the same manual erase-and-redraw process.

---

# Milestone P37 — Production Readiness & Packaging Audit

**Purpose:** an investigation-only milestone (no source, config, or dependency changed) to produce a repository-specific answer to what P38+ actually needs to do to ship a Windows installer and a signed Android APK — confirmed by directly reading the real repository (desktop/backend/Android source plus a repo-wide grep for dev-only assumptions), not inferred from documentation.

**Findings — two confirmed blockers:**
- **Android release builds silently block all networking.** `AndroidManifest.xml` sets `android:usesCleartextTraffic="${usesCleartextTraffic}"`, a Gradle manifest placeholder with no project-level override; traced to `@react-native/gradle-plugin`'s own code, which resolves it to `"true"` on debug and `"false"` on release. Since Relay's entire networking model is plain HTTP over LAN (an already-accepted V1 design decision), a release APK's Android Network Security Config would block every request to the desktop backend with no code-level error to debug from — never surfaced before because every prior physical-device test used a debug build. **Blocker for P40.**
- **Android release builds fall back to debug signing.** `build.gradle`'s `signingConfigs.release` points at the committed, non-secret `debug.keystore` — the stock React Native template default, never replaced. **Blocker for P40.**

**Other findings:** no backend bundling tool exists yet — `backend-manager.js`'s packaged-mode branch already hardcodes and expects a single `resources/backend/relay-backend.exe`, but nothing produces it (**blocker for P38**). No Electron packaging tool exists yet (**blocker for P39**). Backend dependencies (`requirements.txt`/`requirements-dev.txt`) are entirely unpinned — a reproducibility risk for whichever bundling tool is chosen, should be pinned before the first real build. Smaller, non-blocking items: `config.py`'s `DEBUG` field is defined but read nowhere; `desktop/main.js`'s `BACKEND_PORT = 8000` duplicates `config.py`'s port default with no shared source of truth; `New_Issues.txt` was tracked in git with no `.gitignore` rule (every other dev artifact was correctly ignored); three independently-drifted version strings exist across backend/desktop/Android with no shared source of truth (backend and desktop happened to already agree at `0.1.0`; Android used an unrelated `1.0`/`1` scheme) — flagged as a lightweight future convention (bump all three together before a release tag), not a build-time syncing mechanism. Windows Firewall's first-run allow-prompt was reasoned to be the correct, code-free way to handle the two ports (API TCP, discovery UDP) needing an inbound allow rule, matching the project's existing "never modify firewall settings automatically" rule — not independently observed live (no packaged build existed yet to test against).

**Recommendation (adopted, see P38/P39 entries):** PyInstaller `--onedir` for the backend — fits `backend-manager.js`'s existing fixed-path assumption, avoids `--onefile`'s per-launch re-extraction cost, and is the most widely-adopted tool for a pure-Python FastAPI/Uvicorn/SQLAlchemy dependency closure with no exotic C extensions. `electron-builder` with an NSIS, per-user (non-admin) install target for the desktop installer — built-in `extraResources` support to place PyInstaller's output at `resources/backend/` with zero application-code change, and per-user install avoids requiring admin rights. Android release signing: a dedicated release keystore wired in via the same "tracked template, gitignored real values" pattern already used for `backend/.env.example`/`.env` — deferred to P40, not generated during this audit.

**Outcome:** proposed and adopted the P38→P39→P40→P41 milestone sequence (backend bundle → installer → Android release → full packaged validation), plus a detailed P41 validation matrix (clean-machine install, firewall prompt, upgrade/uninstall preserving user data, cross-platform transfer scenarios including large files and Unicode names) to be executed once real artifacts exist. No fifth milestone was judged necessary — the smaller findings were scoped to fold into P38/P39 rather than warrant their own milestone.

---

# Milestone P38 — Backend Production Bundle

**Purpose:** produce and verify a self-contained Windows production backend bundle that runs with no Python, pip, virtualenv, or Relay source checkout present, per P37's recommendation.

**Decision:** `backend/run.py` (new) is the PyInstaller entry point `app/main.py` never had — it defaults `--host`/`--port` from `Settings.HOST`/`Settings.PORT` (load-bearing: `backend-manager.js`'s packaged-mode spawn passes `--port` only, no `--host`, so the entry point must self-default the bind address or a packaged backend would silently bind to Uvicorn's own `127.0.0.1` default and become unreachable from Android) and calls `uvicorn.run(app, ...)` directly. `backend/relay-backend.spec` (new) is a minimal PyInstaller `--onedir` spec with one required hidden-import fix found during the build (not predicted by P37's read-only audit): SQLAlchemy resolves its SQLite dialect via a runtime string import that PyInstaller's static analysis can't follow, and `pyinstaller-hooks-contrib` ships a hook for Uvicorn/Pydantic but not SQLAlchemy — added `collect_submodules("sqlalchemy.dialects.sqlite")` explicitly. `console=True` is also explicit and load-bearing (PyInstaller's windowed mode would leave `stdout`/`stderr` as `None`, breaking the existing console log handler — though no console window is ever actually visible, since Electron always spawns with `windowsHide: true`).

**Dependency work:** `requirements.txt`/`requirements-dev.txt` were pinned to the exact versions already proven by 343 passing tests, split into three files — production (`requirements.txt`), dev/test (`requirements-dev.txt`, unchanged set), and a new build-only `requirements-build.txt` (production pins + `pyinstaller`) never installed for ordinary development. A real finding from cross-referencing `pip freeze` against `backend/.venv`: the tracked dev venv contained **seven packages neither requirements file declares nor any source file imports** (`lxml`, `Pillow`, `python-docx`, `python-pptx`, `reportlab`, `xlsxwriter`, `lameenc`) — orphaned installs, not Relay dependencies. Not added to any requirements file, not bundled (the build used a from-scratch clean venv holding only the pinned production packages + PyInstaller, never `backend/.venv`), `backend/.venv` itself left untouched.

**Verification:** the built `relay-backend.exe` (~36 MB `--onedir` output) was copied into an isolated directory with a space in its path, launched with `PATH` scrubbed to only Windows system directories and `RELAY_DATA_DIR` pointed at a freshly created Unicode-named directory — started cleanly, `GET /health` returned 200, and `relay.db`/`logs/relay.log` were confirmed created under the new directory, not the executable's own. Full API surface exercised against disposable data (never the real dev database): settings, devices, a full pairing handshake, sharing a file and a nested folder, and a complete send + receive transfer with byte-verified content on both directions. Force-killed and relaunched against the same populated data directory — all prior state (paired device, shares, completed transfers) reopened correctly with no errors, and the T7 crash-reconciliation logic ran cleanly (though no genuinely `in_progress` transfer existed to actually repair — left for P41). Electron compatibility was verified by replicating `backend-manager.js`'s exact packaged-mode spawn logic in a standalone Node script against the real build output (Electron's own `app` module can't run outside a real Electron process) — command, args, cwd, and `RELAY_DATA_DIR` all matched and the spawned process passed its own health check; `backend-manager.js` itself needed zero changes.

**Known limitation / process note:** one disposable upload test briefly wrote into the real `C:\Users\Saad\Downloads` folder before the isolated instance's `download_directory` was redirected to a scratch path — caught and deleted immediately, confirmed via `git status` that no repository or dev-database state was affected. Documented as a lesson for future live-instance testing: repoint `download_directory`, not just the database location, before exercising the upload path. Full clean-VM/second-machine testing and Windows Firewall verification remain P41's job (need a real installer to exist first).

---

# Milestone P39 — Windows Desktop Installer

**Purpose:** turn the Electron app plus P38's backend bundle into a real, installable Windows application.

**Decision:** added `electron-builder` (`^26.15.3`) as a `desktop/` devDependency with an inline `build` config in `package.json` — NSIS target, per-user install (`perMachine: false`, installs to `%LOCALAPPDATA%\Programs\Relay`, no admin rights), Windows x64 only (matching the project's own dev/runtime environment). `extraResources` copies P38's `backend/dist/relay-backend/` output to `resources/backend/relay-backend.exe`, outside `app.asar` (required — the exe must be directly `spawn()`able). Root-level `"productName": "Relay"` is required, not redundant: Electron's `app.getName()` (which drives `app.getPath("userData")`) reads `productName` before falling back to the npm package name `relay-desktop`, so without it user data would live at the wrong folder name.

**Two P37-flagged items resolved while these files were already in scope:** the unused `DEBUG` config field was removed (confirmed zero references first). The `BACKEND_PORT`/`config.py` duplication was found to be a **real latent bug, not cosmetic**: `PairingService`/`DiscoveryService` both read `settings.PORT` to tell Android which port to connect to, but that value came from `config.py`'s own default, never from whatever `--port` Electron actually passed — because `app.main` (and its module-level `get_settings()`) was imported before `run.py`'s `argparse` ever ran. Fixed by re-exporting `--port` into `os.environ["PORT"]` and calling `get_settings.cache_clear()` before importing `app.main` — verified live (`--port 8123` standalone → `POST /pairing/start` correctly returned `"port":8123`). `main.js`'s `BACKEND_PORT` is now the deliberate single source of truth going forward.

**Verification:** everything below was exercised against the real installed application (`Relay-Setup-0.1.0.exe`, ~112MB, confirmed unsigned per V1's accepted scope — `Get-AuthenticodeSignature` → `NotSigned`), not just the installer artifact. Clean install registered correctly in Control Panel and created both shortcuts pointing at the P36 icon; first launch from a clean `userData` state spawned the real backend as a genuine child process with no dev server/Python visible; single-instance locking and close-to-tray both confirmed unchanged; force-killing the whole app left no orphaned backend process (Windows terminates the child with the parent); a deliberately induced backend-missing failure produced a real, non-silent modal dialog with the log path and a Quit button; an upgrade-in-place (real paired device, shared file, and a changed setting all created first) preserved every piece of data exactly, with the version number correctly updating; uninstall removed only the install directory/shortcuts/registry entry, correctly preserving `%APPDATA%\Relay` (`relay.db`, settings, logs) by NSIS's own default — meaning a reinstall after an uninstall silently resurrects the old database, which is accepted default behavior, not a bug, and would need deliberate NSIS scripting to change.

**Known limitation:** no real Android device was used this pass (pairing/sharing was simulated via direct HTTP calls); genuine end-to-end Android verification against this specific packaged build, and Windows Firewall's first-run prompt (which did not appear in this environment, inconclusively — no rule existed before or after, but no interactive prompt was observed either), are both explicitly deferred to P41. Full PATH-scrubbed isolation of the *installed app* (as opposed to the standalone P38 executable) was not independently re-tested. Only verified on this one dev machine — no clean-VM/second-machine reproduction.

---

# Milestone P40 — Android Release APK & Production Build

**Purpose:** resolve both Android release blockers P37 identified (cleartext HTTP blocked by default, release signing falls back to the debug keystore), build a real `app-release.apk`, and verify it live.

**Root causes (both reproduced against the live build, not just source):** `./gradlew :app:processReleaseManifest`'s merged output confirmed `android:usesCleartextTraffic="false"` on the current release build, with no override anywhere in the project — `@react-native/gradle-plugin` resolves this Gradle manifest placeholder per build type (`true` debug, `false` release) with no project-level way to change it, and Android's default Network Security Config then blocks all of Relay's (by-design, LAN-only) plain-HTTP traffic. Release signing was confirmed hardcoded to `signingConfigs.debug`, the stock React Native template default.

**Fix (cleartext):** added `app/src/main/res/xml/network_security_config.xml` (`<base-config cleartextTrafficPermitted="true" />`), wired via `android:networkSecurityConfig` on `<application>`. Chosen over a bare manifest-placeholder override because it's self-documenting, independently verifiable directly from the built APK's own resources, and — since `minSdk` is 26 — unconditionally takes precedence over the RN plugin's own placeholder regardless of what that resolves to. A domain-scoped `<domain-config>` was considered and rejected: the desktop's address is discovered dynamically per LAN at pairing time, so there's no fixed hostname to scope to.

**Fix (signing):** `build.gradle` now reads release signing credentials from a gitignored `keystore.properties` (tracked template: `keystore.properties.example`) or equivalent environment variables; if neither supplies all four required values, **no `signingConfigs.release` is registered at all**, and `assembleRelease`/`bundleRelease` fails fast with a clear `GradleException` the moment it's actually invoked (other tasks, including `assembleDebug`, are unaffected) — release builds can never silently inherit the debug keystore. Mirrors the existing `backend/.env.example`/`.env` "tracked template, gitignored real values" pattern.

**Verification:** `aapt2 dump xmltree`/`dump resources` against the actual built APK confirmed the compiled `network_security_config` resource genuinely contains `cleartextTrafficPermitted=true` — not just that the source XML looks correct. `apksigner verify --print-certs` confirmed the release APK's certificate fingerprint differs from the debug keystore's own — genuinely not debug-signed. The signing identity used (`CN=Relay Local Verification, OU=Relay P40`, generated via `keytool -genkeypair` solely to prove the pipeline works) is explicitly a **local verification keystore, not a final production signing identity** — recorded as such, not glossed over; a real one must be generated and secured outside the repo before any real distribution. `git check-ignore -v` confirmed the keystore, `keystore.properties`, and the APK itself are all correctly untracked.

Physically verified end-to-end on RMX3997 (`./gradlew :app:assembleRelease`, first build ~35 minutes with no prior release-variant cache) over a real phone-hotspot LAN (not loopback — confirmed via matching BSSID/subnet between the PC and phone): a stray Metro instance was stopped first so "no dev-server dependency" would be unambiguous; the release build launched cold with no red-box/dev-menu and logcat confirmed `debug is false`; discovery, a real QR-code pairing scan, authenticated polling, a file download (byte-verified on-device), a folder download (structure and content verified), Transfers, Settings, and Clear History all worked correctly over plain HTTP — the direct, conclusive regression test for the cleartext-traffic blocker this milestone fixed. Upload, multi-GB files, Unicode/long filenames, cancellation, and induced-failure scenarios were deliberately left for P41's fuller matrix.

**Known limitation:** `versionCode 1`/`versionName "1.0"` remains unreconciled with backend/desktop's own `0.1.0` (three independently-maintained version strings, unresolved — not required to produce a working release APK). `app_name` (`"RelayMobile"`) was found to actually render as the release APK's label, inconsistent with the "Relay" branding used elsewhere — noted, not fixed (out of this milestone's scope; later fixed in P45). No code signing / Play Protect reputation exists for this APK, matching the desktop installer's own already-accepted unsigned status.

---

# Milestone P41 — Packaged End-to-End Release Validation

**Purpose:** execute the full P37-proposed release validation matrix against the real packaged artifacts (installed Desktop app + bundled `relay-backend.exe` + Android release APK) over a genuine phone-hotspot LAN — not dev builds, not API simulation, including one QR-code camera scan physically performed by the user at the assistant's request.

**Findings — everything validated:** a fresh NSIS install (real wizard, correct per-user path/shortcuts) with the bundled backend spawning as a genuine child process (confirmed zero `python.exe`/`node.exe`/Metro processes anywhere on the machine throughout); the release APK launching cold with no Metro/dev-server dependency (confirmed via logcat); real UDP discovery; a real physical QR-camera pairing scan; device renaming propagating correctly in both directions; byte-verified file and folder sharing including a Unicode filename+content, a zero-byte file, and a duplicate-basename pair correctly disambiguated; all three Android upload variants (single/multi/folder) with correct confirmation-sheet wording and byte-verified content; real progress/queue states (three simultaneous downloads producing a genuine Downloading + 2×Queued display); a real mid-flight cancellation (clean `Cancelled` state, no zombie row); a real induced failure (deleting the source file mid-download produced the correct user-facing message and a clean `Failed` state); both platforms' Clear History wording and preservation guarantees; settings rename persistence on both platforms; a real forced-kill-and-restart cycle with zero orphaned processes and all data intact; and a real installer upgrade-in-place/uninstall cycle correctly preserving `%APPDATA%\Relay` while removing only binaries/shortcuts.

**One non-blocking defect found and root-caused (not fixed, per this validation-only milestone's fix policy — only a release blocker would have been fixed):** clearing history from Android's Files screen doesn't retroactively filter an already-mounted Transfers screen, even though both read the identical marker file. Root cause: `TransferListScreen.tsx` loads `clearedAt` via a `useEffect` with an empty dependency array (runs once on mount only); its `useFocusEffect` refreshes the transfer list on every re-focus but never re-reads the marker. No data is at risk anywhere in this path (files, backend rows, and the marker itself are all correct) — a stale-React-state UI sync gap, not a correctness bug. Fix is a one-line change (add `getHistoryClearedAt()` to the `useFocusEffect`, or lift `clearedAt` into a shared hook) — left for a future milestone.

**Known limitation:** Windows Firewall's first-run consent prompt was not observed in this environment on either P39 or P41 — while real LAN traffic was confirmed working both times regardless (no firewall rule existed before or after; treated as an environmental characteristic of this development machine, not proof either way about a genuinely fresh end-user install). The intermediate "Pairing Request" review screen wasn't separately screenshotted during the physical-scan handoff (its effect is still fully confirmed by the resulting paired state). All pre-existing limitations from P38–P40 (temporary Android signing identity, no code signing on either platform, versioning drift, `minifyEnabled=false`) remain unchanged. **No release blockers found.**

---

# Milestone P42 — Repository, Product & Documentation Cleanup

**Purpose:** repository/documentation hygiene now that V1 is feature-complete and packaged (P38–P41) — explicitly not a feature milestone; no application source behavior changed. Methodology: every deletion candidate was checked via `git log --oneline -- <path>` (introduction commit, whether later work superseded it, whether other tracked files reference it by name) before any removal — nothing was removed on "looks unused" alone.

**Files removed (evidence-backed):** `scripts/generate_tray_icon.js` (a one-off M14-era placeholder-icon generator whose only output was replaced by the real hand-designed icon two milestones later; not referenced by any build config) and `android/src/components/PlaceholderScreen.tsx` (a scaffold-era stub from the very first Android commit, never wired into navigation, zero importers at any point in its history).

**Files investigated and deliberately retained:** `New_Issues.txt` — genuinely obsolete as a *requirements* document (every item traces to a completed, verified milestone), but `git grep` found **44 live citations by exact section number** across source comments and this notebook's own entries, documenting the rationale behind real design decisions. Deleting it would have made all 44 citations unresolvable. **Action taken: moved to `docs/New_Issues.txt` (filename kept so citations still resolve) with an archival header** — later relocated again to `docs/issues/New_Issues.txt` in a subsequent documentation cleanup pass alongside `Pre_Release_Issues.txt` (itself archived the same way once P43–P45 implemented everything in it), since the citations are bare filenames with no path and resolve regardless of which `docs/` subdirectory the file lives in. This was caught and corrected mid-milestone after an initial outright deletion was reversed (see Process note below). No dependency in any of the three ecosystems (backend/desktop/Android) was removed — every one was traced to real usage, including two close calls (`httpx`, a real transitive `TestClient` dependency; `react-native-gesture-handler`/`screens`, required `@react-navigation` peer dependencies).

**Documentation corrections made:** `docs/12_Packaging_Deployment.md` and `docs/14_Testing_Plan.md` both still framed packaging as outstanding — corrected to state P38–P41 are complete, and `docs/14`'s stale test-count figures were updated to the numbers this milestone's own verification pass actually measured (343/2 backend, 365 tests/42 suites Android). `CLAUDE.md` gained a correction (the P29.1 entry had incorrectly flagged the Transfers progress-bar bug as still unfixed — it was already fixed by P33) and five entirely new milestone sections (P32–P36) that had never been documented despite being real, already-committed, already-verified work — every claim in these additions was independently spot-verified against actual source before being kept, not taken on trust. `README.md`'s project-structure listing was updated to match the file removals. This QA notebook gained a short "Current Status" orientation section near the top.

**Process note (a genuine deviation, not a correctness issue):** this milestone's investigation was split across parallel background research agents briefed "investigate only, do not edit." One did not stay in scope and made real uncommitted edits, including an outright deletion of `New_Issues.txt` that it then reversed itself (after independently discovering the 44-citation problem) into the archival move that was actually kept. Nothing was ever committed by any agent, and every change was independently re-verified against real source/git-history evidence before being kept — recorded here as a lesson (search for a file by name across the whole repo, not just code imports, before deleting anything as unused), not because it affected the outcome's correctness.

**Verification:** backend `pytest` 343 passed/2 skipped, `ruff` clean; Android `tsc`/`eslint` clean (4 pre-existing unrelated warnings), `jest` 42 suites/365 tests; Desktop `node --check`/`node --input-type=module --check` clean on every file. A full-history git sweep for ever-committed secret-like filenames found only the three expected, non-sensitive tracked templates/debug key — no real secret was ever committed. No packaging-sensitive file was touched, so no release artifact was rebuilt.

**Known limitation:** a stray untracked root-level `node_modules/` and a 0-byte root `relay.db` were found and left for the user to clear locally (harmless, untracked, not a git concern). Nothing was committed by this milestone — left for review first, per its own instructions.

---

# Milestone P43 — Device Lifecycle & Re-Pairing Correctness

**Problem:** a real, physically observed defect — the Desktop Devices list accumulates duplicate entries for what is logically the same Android phone. Reproduced: uninstalling and reinstalling both Desktop and Android left Desktop still showing the previously paired device (its data survives, since NSIS preserves `%APPDATA%\Relay` by design, P39); pairing the fresh Android install without removing that stale entry produced a second row; repeating Android-only uninstall/reinstall/pair produced a third.

**Investigation (identity model traced end to end before any change):** `devices.device_identifier` is documented as the stable external identity, generated once at first install and meant to stay stable for the life of that install (`docs/13_Database_Design.md`). The actual Android code did not do this — `deviceIdentifier.ts` generated a **fresh UUID on every pairing attempt**, not once per install, contradicting the documented contract (a real implementation bug, not the design choice its own code comment claimed). Separately, `PairingService` had only two outcomes for a pairing request — reject (409, if the identifier was already known) or create-new — with no third "reconcile" path, so even a legitimate re-pair of an already-known install (a session simply expiring, or the desktop user clicking Remove and the same phone reconnecting) would either hard-fail or duplicate.

**Heuristic staleness detection (rejected):** the architecture has always intentionally supported multiple concurrent Android devices per desktop, and two rows are structurally indistinguishable from the backend's data alone whether they represent two different phones or one phone paired twice — there is no uninstall signal, and no reliable way to distinguish "this row's install is gone for good" from "a second legitimate phone." Automatic staleness detection or deletion based on device name/IP/last-seen heuristics was explicitly investigated and rejected as unsound for exactly this reason — a stale `Device` row remains "Paired" until the desktop user explicitly clicks Remove.

A genuine Android **reinstall** still, correctly and unavoidably, produces a new `device_identifier` and a new `Device` row — there is no privacy-appropriate identifier that could survive an uninstall, nor should there be one. P43 does not change this; it only eliminates duplicate rows from re-pairing the *same* install.

**Fix:** Android now persists `device_identifier` once, on first read, as a private JSON file (`android/src/pairing/deviceIdentifier.ts`'s `getOrCreateDeviceIdentifier()`, mirroring `folderIdentity.ts`'s established pattern), reused for every later pairing attempt from that install. The backend's `PairingService.submit_pairing_request` no longer rejects an already-known identifier with 409 — it's a legitimate re-pair candidate, still gated behind the same explicit desktop-user approval as any pairing. `approve_pairing` now reconciles: if the identifier matches an existing `Device` row, every session previously issued to that device is deleted and a fresh secret/session is minted onto the *same* row (`device_name`/`id`/`paired_at` left untouched, so an existing rename survives); a genuinely new identifier still registers as a new `Device`, unchanged.

**Verification:** 350 backend tests pass (up from 343), 367 Android tests pass, both suites covering the full reconciliation/new-device/name-preservation/session-invalidation matrix. Physically verified on RMX3997 across the exact scenarios A–E the report specified (fresh Desktop+Android; Desktop+Android reinstall; Android reinstall only, Desktop untouched; re-pair without manually removing the old device; multiple reinstall/re-pair cycles) via two real physical QR camera scans — confirmed live: a same-install re-pair (session forcibly expired, no reinstall) reconciled onto the existing row with old credentials verifiably dead afterward, while two genuine reinstalls each correctly produced a new row as a negative control.

**Known limitation:** the packaged Desktop backend/installer at the time of this milestone still contained pre-P43 code (a live re-pair attempt against the stale packaged binary still produced the old 409) — **rebuilding the backend bundle and installer is a required follow-up before release**, the same rule P38/P39 already established for any backend change. No Desktop UI hint was added to signal "this looks like a device you already have" during approval — reconciliation happens automatically without it.

---

# Milestone P43.1 — Device Name Collision & Re-Pairing Resolution

**Problem:** the one lifecycle case P43 deliberately left open. A genuine Android reinstall correctly gets a new `device_identifier`, but Android's default device name is the phone model — so a reinstalled phone naturally resubmits the same name it had before. If Desktop's old row for that phone isn't removed first, this collides on *name* while being a *different* identifier, which P43's own logic correctly treats as "new device" — producing the exact same-name duplicate the report described.

**V1 decision — identity precedence (strict, must not be reordered):** a matching `device_identifier` is always a P43 reconciliation, checked first, regardless of whether the name also matches or differs. Only when the identifier is genuinely new is a name collision even considered. A different identifier with a different name is always plain new-device pairing. Device names are **not** a cryptographically reliable physical-device identity (two genuinely different phones can share one), so this is resolved as a user-assisted decision at pairing time, not a stronger identity mechanism — surfacing the ambiguity to the desktop user, who knows whether they just reinstalled or just plugged in a second phone, rather than having the backend guess.

**Fix:** `DeviceService.find_name_collision_or_none` (trim + case-insensitive match, live device list, never a cached snapshot) is checked both when Desktop polls `GET /pairing/pending/{token}` (so it knows to show the collision dialog) and again inside `approve_pairing` at the moment of commit (closing the race where state changes between poll and click). If a collision exists at commit time with no decision supplied, the pairing attempt is restored to `AWAITING_APPROVAL` rather than discarded, and a `409 NameConflictError` is raised — the same token still resolves to the same pending review. Desktop's new collision dialog offers exactly two choices, no cancel option: **Replace** (deletes the colliding device in the same transaction as registering the new one, cascading its sessions so old credentials die immediately) or **Make it a new device** (`DeviceService.generate_unique_name` finds the smallest available `"{name} (N)"` gap against the live device list — never counts existing rows, so `{Thomas, Thomas (1), Thomas (3)}` + a new `Thomas` correctly yields `Thomas (2)`). `PairingResultResponse`/`ApprovedResult` now carry the backend's actual final `device_name` (which Make-new can set to something Android never submitted), and Android's `PairingWaitingScreen.tsx` builds `Session.device_name` from that field, not from what it originally sent.

**No database-level uniqueness constraint on `device_name`** was added, deliberately — P43 never defined names as globally unique (a Desktop rename already permits duplicates), and this service-level live check is sufficient for its actual job.

**Verification:** 376 backend tests pass (up from 350), 367 Android tests unchanged/passing. Physically verified on RMX3997 via four real camera scans: Replace (fresh reinstall + same name → collision dialog → Replace → exactly one row, new identity, old identity gone); Make-new (a second fresh reinstall + same name → collision dialog → Make-new → two rows, the new one correctly labeled with the backend-generated suffix on Android's own Settings screen); and the no-dialog same-identifier path (session expired without any reinstall → re-pair → straight through, no dialog, preserving the already-suffixed name) — confirming identifier precedence held even against an already-suffixed name.

**Known limitation:** same packaged-rebuild caveat as P43 (this session tested only against dev-mode source, not the packaged installer). The collision dialog offers no "Cancel pairing" option, per the explicit design — abandoning requires navigating away from the Pairing view.

---

# Milestone P44 — Desktop Stale Downloaded File & Folder Handling

**Problem:** a real, physically observed defect — a received file/folder in Desktop's Shared Files whose physical copy was later moved or deleted outside Relay left the app in a broken state: Open produced a raw "Failed to open path" **whole-view** error card (not a row-scoped one — P32's earlier fix for this exact class of problem was scoped to Shared Files' Refresh only, never extended to Open), Show in Folder silently did nothing, and the stale row survived indefinitely across tab navigation and Refresh.

**Root cause:** two Desktop IPC actions (`shell:openPath`, `shell:showInFolder`) were invoked against a received item's resolved path with no existence check first. `openPath`'s error string was fed into the whole-view `renderError`; `showInFolder` returns nothing at all on a missing target, so Electron's own silent no-op reached the user with zero feedback. P29 had already established the "treat an already-missing target as a no-op success" pattern, but only for `shell:deleteItem` — never extended to these two actions.

**Fix:** a new `fs:pathExists` IPC channel (thin `fs.existsSync` wrapper, mirroring P29's pattern) and a new `alertDialog` primitive (`dialog.js`, a single-button, non-confirmation sibling of P30's `confirmDialog` — reusing its exact markup/CSS) are the basis for a single new helper, `handleIfReceivedItemMissing(container, item, path)`, that both Open and Show in Folder now route through: checks existence first, and if missing, shows an item-type-aware alert ("File/Folder unavailable — This ... was moved or deleted from its original download location."), marks the item removed via the existing P21 local-only marker, and refreshes — never touching the backend `Transfer` row. No new identity/registry mechanism was needed — the existing transfer-id/batch-id keys already correctly protect one item's removal from ever affecting an unrelated same-named item. Currently-shared source files/folders (a completely separate case, already correctly handled by P32) were not touched.

**Verification:** live on the real Desktop app against the real backend and physical RMX3997 uploads: missing-file Open, missing-file Show in Folder, and missing-folder Show in Folder all correctly showed the new dialog and removed only that one row; a deliberately constructed duplicate-filename case (two uploads of the identical name with a deletion in between) confirmed removing one stale entry never affects the other, even sharing the same display name. Transfer History was checked directly against the database after every removal and confirmed byte-for-byte unchanged in every case — the fix only ever touches the Desktop-local removal marker.

**Known limitation, documented rather than silently accepted:** because a received item's path is derived from its `file_name` (not a stored unique path), two received items can legitimately resolve to the *same* physical path if a filename is reused after its original file was deleted — in that narrow window, the older (stale) item's row will resolve as "present" against the newer item's file (no worse than pre-P44 behavior, which had no existence check at all). Fixing this properly would require the backend to persist a stable per-transfer physical path rather than deriving one from `file_name` — out of this milestone's smallest-fix scope, flagged for the future.

---

# Milestone P45 — Desktop Packaging & Installer UX / Branding Refinement

**Problem:** six real, physically observed packaging/branding defects — the Desktop and Start Menu shortcuts showed a verbose internal description as their Comment field; Windows Control Panel's Publisher field was empty and its Comments field showed the same verbose string; `Relay.exe`'s Company metadata showed "GitHub, Inc." (Electron's own prebuilt-binary default); the Android launcher/application label read "RelayMobile" instead of "Relay"; and the NSIS installer's progress bar visibly jumped backward partway through installation (~25%→90%→75%→100%).

**Root causes, traced in `app-builder-lib` (electron-builder) source before changing anything:** `desktop/package.json`'s `description` field was echoed verbatim, unconditionally, into both the shortcuts' Comment field **and** the Control Panel Comments value — one field, two symptoms. `desktop/package.json` had **no `author` field at all**, so electron-builder's `companyName` resolved to `null` and the `rcedit`/NSIS steps that would set `Relay.exe`'s `CompanyName` and the installer's `Publisher` registry value were both skipped entirely — one missing field, two symptoms, and electron-builder had even been silently logging `"author is missed in the package.json"` on every build. A version-consistency audit found **no actual drift inside Desktop's own packaging chain** — `Relay.exe`'s version, the installer's `VIProductVersion`, and Control Panel's `DisplayVersion` were already internally consistent; the only real drift is the separate, out-of-scope cross-platform mismatch (Desktop `0.1.0` vs. Android `1.0`/`1`). The Android label was a single `strings.xml` string resource. The installer progress bar's backward jump was traced to NSIS's own default solid-7z packaging, which runs installation as three independently-timed phases sharing one visible bar (extract the compressed blob from the installer stub, decompress it into a temp folder via a plugin reporting against a *different* total, then copy the decompressed files into the final install directory) — `nsis.useZip` (the one config knob that would avoid this) was confirmed unconditionally forced off whenever a build is differential-update-aware, which this one always is (it produces a `.blockmap`), so it had no effect.

**Fix:** `description` set to `""` (not a shorter replacement — the brief explicitly required no replacement comment). Added `"author": { "name": "Relay Labs" }` — **the object form is required**; a bare string would not expose a `.name` property and would silently fail to set anything (this was verified, not assumed). This also changed `LegalCopyright` from "Copyright © 2026 Relay" to "Copyright © 2026 Relay Labs" as a documented side effect. No version number was changed anywhere (nothing was actually wrong). `strings.xml`'s `app_name` changed from `"RelayMobile"` to `"Relay"` (`applicationId`/`namespace` deliberately unchanged — a real package-identity change with upgrade/store implications, out of scope). `build.compression` set to `"store"` — removes the mismatch at its source (no decompression math, so the compressed-blob size and the real content size become the same number) rather than faking or smoothing the displayed percentage, at a measured **~1 MB** installer-size cost (not the 3-4x a naive guess would suggest, since this payload — Electron runtime DLLs, the PyInstaller-bundled Python backend — is already mostly incompressible binary data).

**Verification:** rebuilt all three artifacts from clean state (backend from a fresh venv, never `backend/.venv`; this also meant the packaged backend now includes P43/P43.1/P44's fixes, closing the "still needs to be rebuilt" gap those milestones had left open). Installed the final artifact and inspected the real running application directly (not source): shortcuts blank, Control Panel Publisher = "Relay Labs" and Comments blank, `Relay.exe` CompanyName = "Relay Labs", all version fields unchanged and still consistent. Installer progress was observed via UI Automation screenshot capture at fixed intervals, twice: the pre-fix build reproduced the same climb→drop→climb shape as originally reported (twice, independently); the `store`-compression build climbed smoothly with no backward movement observed in any sampled frame, on two separate full installs. Android: the release APK's launcher tile was confirmed reading "Relay" on the physical RMX3997 device, with the existing pairing session surviving the upgrade install (an upgrade, not a full uninstall, so no new device identity was created, consistent with P43). A full regression pass confirmed `relay.db` was byte-identical (`Length`/`LastWriteTime`) across two separate upgrade installs — device pairing, shared files, settings, and transfer history all intact.

**Known limitation:** the installer's progress bar is monotonic and visually smooth for this specific payload's compression characteristics (mostly-incompressible binaries) — a future payload with substantially more highly-compressible content could reintroduce a smaller mismatch, worth re-checking if the payload composition changes. Cross-platform version drift remains unresolved (deliberately — no shared-version mechanism exists between the two build systems, and inventing one was out of scope). Uninstall was not independently re-executed this pass (no code path diverges from what P39 already validated, since NSIS builds the uninstaller from the same shared config the installer change applies to).

---

# Milestone P46 — Release Candidate Audit & Ship Readiness

**Purpose:** an audit-only pass (no feature work) to answer one question — is the current Relay V1 release candidate actually ready to ship — by inspecting the real repository state and the real packaged artifacts rather than trusting prior documentation at face value.

**1. Release inventory (measured directly from the artifacts, not assumed from source):**

*Desktop:* `desktop/dist/Relay-Setup-0.1.0.exe`, 118,743,810 bytes, unsigned (`Get-AuthenticodeSignature` → `NotSigned`, expected). Installed `Relay.exe`: `FileVersion`/`ProductVersion` 0.1.0, `CompanyName` "Relay Labs", `ProductName` "Relay", `LegalCopyright` "Copyright © 2026 Relay Labs". Control Panel registry entry (`HKCU:\...\Uninstall\{4cba8762-...}`): `DisplayName` "Relay 0.1.0", `Publisher` "Relay Labs". Bundled backend confirmed present and spawning from `resources/backend/relay-backend.exe` in the real installed app (not just `dist/`). Backend exe 9,929,960 bytes, PyInstaller `--onedir`, x64.

*Android:* `android/android/app/build/outputs/apk/release/app-release.apk`, 94,830,542 bytes. Package `com.relay.mobile`, `versionName` "1.0", `versionCode` 1. `aapt dump badging` confirms `application-label:'Relay'` (not "RelayMobile") and no `debuggable` flag. `assets/index.android.bundle` present (Hermes bundle embedded — zero Metro dependency). `apksigner verify --print-certs`: v2-scheme signed, one signer, `CN=Relay Local Verification, OU=Relay P40` — confirmed **not** the debug keystore, and confirmed matching the local-verification identity `keystore.properties` documents (alias `relay-release-local-verification`). Manifest: `android:networkSecurityConfig` wired to a real resource (`@0x7f140004`); `usesCleartextTraffic` placeholder correctly resolved `false` for release, which is expected and irrelevant because `minSdkVersion` 26 makes the Network Security Config take precedence regardless.

**2. Artifact freshness (does the packaged product actually contain P43–P45?):** compared every file touched by the P43/P43.1/P44/P45 commits (`f5e749f`, `1cc0ebd`, `20c5d6d`, `9e2756f`) against the three artifacts' build timestamps. Every touched source file's mtime (latest: `desktop/package.json` 23:51:24) predates all three build outputs (backend exe 23:38:29 — built *before* the branding commit's own file save, consistent with the commit being made after the rebuild that already contained the branding change in the working tree; installer 23:53:45; APK 23:54:06) — i.e. the currently shipped artifacts are not stale relative to `main`. This matches P45's own "closing the still-needs-to-be-rebuilt gap" claim; this pass independently re-derived it from file timestamps rather than re-trusting the prose.

**3. Automated verification:** `pytest` (backend, existing dev `.venv`): **376 passed, 2 skipped**. Android `npx jest`: **42 suites / 367 tests passed**. Neither suite required any source change. Did not force a from-clean-venv PyInstaller/electron-builder/Gradle rebuild this pass — the freshness check in §2 already establishes the existing artifacts reflect current `main`, and re-running a ~35-minute Gradle release build (per P40's own recorded first-build time) with no source change to validate would be pure repetition, not new evidence; this is a deliberate reuse of existing evidence, not a skipped step.

**4. Live clean-install-equivalent validation (real installed product, this machine):** launched the *actually installed* `%LOCALAPPDATA%\Programs\Relay\Relay.exe` (not a dev build). Confirmed: `relay-backend.exe` spawned automatically from the installed `resources\backend\` path; `netstat` showed it listening on `0.0.0.0:8000`; `GET /api/v1/devices` returned real data — the RMX3997 device paired on 2026-08-15, proving `relay.db` survived the P45 upgrade install (independently reconfirms P45's own claim). Closed both processes afterward to leave the machine as found.

**5. New finding — Android has no recovery path when the paired desktop becomes unreachable at its stored address.** This was found while attempting a live physical E2E re-verification, not by code review alone. This machine happened to be connected to the RMX3997's own mobile hotspot during this pass (`ap0` 10.130.191.86/24 on the phone, Windows `Wi-Fi` adapter at 10.130.191.233 on the same /24) — a real instance of Relay's own "mobile hotspot" use case, not a simulated one. The already-paired Android app showed "Unable to reach Relay Desktop" on its Files tab. Root-caused, not assumed:
   - Windows categorized this connection as a **Public** network (`Get-NetConnectionProfile`), and no firewall rule exists for Relay (`Get-NetFirewallRule -DisplayName "*Relay*"` → none) — this reproduces, for the first time with direct evidence, the scenario P39/P41 could only call "unconfirmed." However, unlike a worst-case assumption, actual HTTP reachability **was** confirmed working here: `nc -z` succeeded on TCP 8000 from the phone, and opening `http://10.130.191.233:8000/api/v1/devices` in the phone's own browser returned the real device list. (ICMP ping was blocked, which is Windows' unrelated default echo-request behavior, not evidence of a real block.) **This downgrades, rather than escalates, the Firewall item — connectivity works today even on a Public-categorized profile with zero bundled rule and zero first-run prompt**, consistent with P41's own "functional LAN connectivity was nonetheless confirmed working."
   - Despite the network layer working, the Android app itself kept failing. Traced to `android/src/session/types.ts`'s `Session.desktop_base_url` — captured once at pairing time and never re-resolved. This session was paired roughly 21 hours earlier, almost certainly against a different desktop IP (a different network across that gap is entirely ordinary for a "local Wi-Fi *or* mobile hotspot" app). The client has no fallback: `SessionManager.clearSession()` (`android/src/session/SessionManager.ts`) is only ever invoked automatically on an HTTP `401`, and a stale/unreachable address never produces one — it produces a network-level failure the client's own P31.1 handling (correctly) converts into a friendly, silently-non-fatal `ApiError`. `RootNavigator.tsx` renders `PairingStack` only when `session` is `null`; nothing else ever clears it. Grepped the entire Settings screen and every other Android source file: **there is no user-facing "Forget this desktop" / "Re-pair" control anywhere in the app.** The only way to recover from a stale `desktop_base_url` is to uninstall and reinstall the Android app (which, per P43, also mints a new `device_identifier`, so it registers as a new device rather than continuing the same paired identity).
   - This is a genuine, physically-reproduced dead end, not a cosmetic issue: a normal, foreseeable usage pattern (pair at home, later connect via hotspot elsewhere, or simply a DHCP lease change) permanently strands the user on an "unreachable" screen with no in-app way out. It was not previously documented anywhere in P37–P45 or this notebook's known-limitations list, because none of those milestones' physical verification passes spanned two different networks between pairing and use.
   - **Not fixed in this pass.** A correct minimal fix (e.g., a "Forget this desktop" action in Settings that calls the already-existing `SessionManager.clearSession()` unconditionally, dropping the user back to `PairingStack`) is small and low-risk, but it is a real UI/behavior addition, not a packaging/config correction like P43–P45's fixes — implementing it without checking first would violate this milestone's own audit-only charter. Flagged for a scoping decision (see verdict below) rather than implemented unilaterally.
   - Full physical device-to-device pairing/transfer re-verification (fresh QR scan, a new send/receive cycle) was not completed this pass as a direct consequence: the existing paired session is the one that hit this dead end, and generating a fresh one requires a physical camera-to-screen QR scan, which needs a human at the machine. Prior physical verification of the pairing/transfer mechanics themselves (P41, P43, P43.1, P44, P45 — all "verified live on RMX3997") is reused rather than repeated, since none of that mechanism's code changed in this pass.

**6. Deferred-issue classification (re-audited against live evidence, not just re-stated):**

| Item | Classification | Basis |
|---|---|---|
| No code signing (Desktop/Android) | ACCEPTED V1 LIMITATION | Confirmed unsigned live; explicitly out of scope for V1 per `docs/12`. |
| Android release signing = local verification keystore | ACCEPTED V1 LIMITATION for this V1, **must be replaced before any public/store distribution** | Confirmed via `apksigner` — real non-debug cert, but explicitly not a production identity. |
| Windows Firewall first-run prompt | ACCEPTED V1 LIMITATION | Now confirmed (not just "unconfirmed") functional even on a Public-categorized profile with no bundled rule — see §5. |
| Android Files/Transfers Clear History live-sync gap | ACCEPTED V1 LIMITATION / POST-V1 BACKLOG | Unchanged since P41; cosmetic, no data impact. |
| `fileIdentity.ts` id-reuse gap | ACCEPTED V1 LIMITATION | Unchanged since P17/`docs/14_Testing_Plan.md` §6; not reachable via normal use. |
| Desktop/Android version-string drift | ACCEPTED V1 LIMITATION | Re-confirmed no packaging-level inconsistency exists within either platform; no shared-version mechanism invented, per explicit P46 instruction not to. |
| Received-item stale-path identity edge case (P44) | ACCEPTED V1 LIMITATION | Unchanged; narrow, requires filename reuse timing. |
| `[QR-DEBUG]` logging | ALREADY CORRECT | Grepped the full tree — zero source references remain; only historical doc/test mentions. |
| Stray `console.error`/`console.warn` in Android networking code | ALREADY CORRECT | Six remaining call sites (`secureStorage.ts`, `DiscoveryService.ts`, `TransferStreamManager.ts`, `foregroundService.ts`, `downloadNotification.ts` ×2, `blobUtil.ts` ×2) are all developer-visibility warnings for genuinely exceptional conditions with a safe fallback already in place — not the P31.1 double-logging pattern (an already-user-facing result logged a second time). |
| **Stale `desktop_base_url` / no re-pair path (this pass's finding)** | **SHOULD FIX BEFORE RELEASE — pending a scoping decision, not auto-implemented** | New, physically reproduced this pass; see §5. |

**7. Versioning decision:** re-investigated per P46's explicit brief; reached the same conclusion P45 already documented — Desktop's own packaging chain is internally consistent, Android's is internally consistent, and no shared-version mechanism exists between the two build systems. No version number was invented or changed. Left unchanged, as instructed when unification isn't necessary.

**8. Git/repository integrity audit:** `git status` clean, no staged or unstaged changes, nothing to commit. Confirmed via `git ls-files`: no `.db`/`.sqlite`, no keystore (only the deliberately-tracked, non-secret `debug.keystore`), no `dist/`/`build/` output, no `backend/.env` (only `.env.example`) is tracked. `backend/keystore.properties`-equivalent (`android/android/keystore.properties`) exists locally with real local-verification credentials and is correctly untracked. No broad cleanup performed — none was warranted (matches this milestone's explicit "do not repeat P42" instruction).

**9. Final verdict: HOLD — one item pending a scoping decision, otherwise ship-ready.**

Everything audited in §1–4, §6–8 is either already correct or an already-accepted, unchanged V1 limitation — no action needed. The one open item is §5's stale-session dead end:

1. **Blocker:** an Android device that pairs once and later can't reach the desktop at its originally-stored address (a realistic outcome of switching between local Wi-Fi and mobile hotspot, or any DHCP change) has no in-app way to recover — only uninstalling and reinstalling the Android app works.
2. **Why it blocks release:** this is a foreseeable, not edge-case, usage pattern for an app whose own pitch is "local Wi-Fi network or mobile hotspot," and the only recovery path (reinstall) is a poor first impression for a V1 product and not something support-scale documentation should have to explain.
3. **Exact minimum fix:** add a "Forget this desktop" action to Android's Settings screen that calls the already-existing `SessionManager.clearSession()` unconditionally (not gated on a 401). No backend change, no new architecture — the clearing mechanism already exists and already correctly routes `RootNavigator` back to `PairingStack`; this only adds a user-reachable trigger for it.
4. **Whether a new milestone is required:** this is a small, well-contained UI addition, not a redesign — it can reasonably be folded into a short follow-up pass rather than needing a full milestone's worth of scope, but per this audit's own charter it was deliberately not implemented unilaterally. Left for the project owner to authorize.

No other item in this audit rises to blocker status.

---

# Milestone P47 — Android Session Recovery & "Forget This Desktop"

**Purpose:** fix the one release blocker P46 found and deliberately left unimplemented — an already-paired Android device with no in-app way to recover once its stored `desktop_base_url` becomes unreachable (e.g. switching between local Wi-Fi and mobile hotspot).

**1. P46 blocker being addressed:** `android/src/session/types.ts`'s `Session.desktop_base_url` is captured once at pairing time and never re-resolved; `android/src/session/SessionManager.ts`'s `clearSession()` — the only thing that routes `RootNavigator.tsx` back to `PairingStack` — was only ever invoked by an HTTP `401` handler, never by a plain unreachable-address failure; and no "Forget this desktop" or equivalent control existed anywhere in the app. The only recovery was uninstalling and reinstalling Android (which also mints a new `device_identifier`, per P43).

**2. Baseline reproduction (real, not staged):** before touching any code, the test device (RMX3997) was found to already be in exactly this failure state, left over from a prior session — a genuine, unplanned reproduction, not a contrived one. `adb exec-out screencap` on launch showed the Files tab stuck on "Unable to reach Relay Desktop. Make sure the PC is running Relay and both devices are on the same network." with no backend reachable (phone on 5G cellular, no shared network with this PC), and Settings had no recovery affordance of any kind — only `Device display name` and `Storage` sections (P23's original two-section scope). Screenshots captured and inspected directly.

**3. Root cause:** confirmed by reading `SessionManager.ts` (`clearSession()` wired only to `setUnauthorizedHandler`, not exposed as a user action anywhere), `RootNavigator.tsx` (switches `PairingStack`/`MainTabs` purely on `useSession()`'s `session` value — no other gating), and `pairing/deviceIdentifier.ts` (persists `device_identifier` in its own private file, independent of `Session`, since P43 — confirmed still the case, unchanged by this milestone).

**4. Existing session architecture (investigated before writing code, per this milestone's own critical rule):**
   - `SessionManager.clearSession()` already does exactly the right thing — clears secure-storage (`secureStorage.ts`'s Keychain entry), in-memory state, and `api/config.ts` — and is already exercised by `__tests__/session/SessionManager.test.ts`. No second clearing mechanism was needed or added.
   - `RootNavigator` needed no changes — it is already purely session-driven, so calling `clearSession()` from anywhere is sufficient to fall back to `PairingStack`.
   - `pairing/deviceIdentifier.ts` confirmed independent of `Session` (a separate `relay-device-identity.json`, not part of the Keychain blob) — the exact mechanism P47's item 5 required to already exist, unchanged since P43.
   - `SettingsScreen.tsx` (P23's two-section `Device`/`Storage` layout) and `AppDialog`/`useAppDialog` (P30's confirm/cancel primitive, already used by this same screen for a download-location error) were the two components extended, per this milestone's "no new dialog primitive, no general Settings redesign" boundary.
   - Grepped the whole `android/src` tree for `forget`/`unpair`/`disconnect` before writing anything — no existing concept found (only comments describing what *doesn't* exist).

**5. UX/architecture decision:** a third Settings section, `CONNECTION`, containing one card (`ForgetDesktopCard`): explanatory text ("Forget this desktop on this device. You can pair again later — the desktop's own record of this device is not affected.") plus a **neutral, bordered** trigger button (`secondaryButton`, the same style already used for "Reset to Default") — deliberately *not* red/`#dc2626`, since this action does not delete anything on the backend and P34/P35's destructive-red convention is reserved for genuinely backend/local-data-destroying actions (Clear History, Delete). Tapping it opens an `AppDialog` (title "Forget this desktop?", explaining the Android-only/backend-unaffected/re-pairable-anytime facts the milestone brief required) with `Cancel` (`style: 'cancel'`) and `Forget Desktop` (`style: 'destructive'` — the *dialog's own* confirm button, not the trigger, carries the red styling, matching every other confirm-dialog call site in this codebase). Confirming calls `SessionManager.clearSession()` directly — no navigation call, no new backend request.

**6. Files changed:** `android/src/screens/settings/SettingsScreen.tsx` only (added `ForgetDesktopCard`, a `Connection` section, and an `AppDialogController` type alias reusing the screen's single existing `useAppDialog()` instance). No backend, no other Android file, no navigation file touched — confirmed via `git status`/`git diff` at the end of the session.

**7. Automated tests:**
   - Android: `npx tsc --noEmit` — clean. `npx eslint .` — 0 errors, 4 pre-existing warnings unrelated to this change (`FilesScreen.tsx`, `TransferListScreen.tsx`, `TransferStreamManager.ts` — all present before this milestone). `npx jest` — **42 suites / 367 tests passed**, identical count to P46's baseline; no test was added or needed changing, since `SessionManager.test.ts` already covers `clearSession()` and this codebase's convention (confirmed via `__tests__/`) is pure-logic tests, not rendered-component tests for screens (no `@testing-library/react-native` dependency exists) — `DeviceNameCard`/other `SettingsScreen.tsx` cards have no render tests either.
   - Backend: no source changed, but P43's reconciliation logic is this milestone's critical regression surface, so it was run explicitly: `pytest tests/api/test_pairing.py tests/api/test_devices.py tests/api/test_requesting_device_dependency.py tests/repositories/test_device_repository.py tests/repositories/test_device_session_repository.py tests/services/test_device_service.py tests/services/test_pairing_manager.py tests/services/test_pairing_service.py` — **121 passed**. Full suite: `pytest -q` — **376 passed, 2 skipped**, identical to P46's baseline.

**8. Physical-device verification (RMX3997, via ADB + a real installed build — not source inspection or API simulation):**
   - The already-installed app on RMX3997 was signed with the P40 local-verification release keystore, so a plain `installDebug` failed (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`, mismatched signature) — switching to `./gradlew.bat app:installRelease` (same `keystore.properties` identity already on this machine) produced a signature-matching update install, preserving the existing session/pairing state instead of wiping it. This was deliberate, not incidental: destroying the live baseline-reproduction state before testing it would have defeated §2.
   - **Settings UI:** screenshot confirmed the new `CONNECTION` section renders correctly below `DEVICE`/`STORAGE`, with the expected copy and a neutral (non-red) `Forget This Desktop` button.
   - **Cancel path:** tapping the trigger opened the `AppDialog` with the expected title/message/buttons; tapping `Cancel` dismissed it with the session and Settings screen completely unchanged (re-screenshotted to confirm).
   - **Confirm path:** tapping `Forget This Desktop` → `Forget Desktop` genuinely cleared the session and the app immediately fell back to the real Discovery/pairing screen ("No Relay devices found yet" / "Scan QR to Pair") — a real `RootNavigator` stack swap, not a simulated one.
   - **Re-pair, end to end, over a real network:** at the user's direction, the phone's mobile hotspot was enabled and this PC's Wi-Fi connected to it (real LAN, IPv4 `10.130.191.233`/24, matching P46 §5's own setup). The real Electron desktop app (`npm start`, dev backend on `0.0.0.0:8000`) was launched; the user clicked `Start Pairing`, scanned the QR with the phone, and approved it. Discovery was also confirmed working live in the process (the phone's Discovery screen listed "Thomas" — this PC's desktop name — before the second re-pair cycle). Post-pairing, the phone's Files tab loaded "No files are currently shared." (a real authenticated `GET /files` success), not the old unreachable error — confirming the new session's `desktop_base_url`/token are live and correct.

**9. P43 reconciliation verification — two distinct live cycles, both confirmed via direct backend inspection (`GET /api/v1/devices`), not assumption:**
   - **Cycle 1 (Forget, then Remove on Desktop, then re-pair):** the user removed the Desktop-side row before re-pairing. Backend response showed `id: 1` (same, via SQLite id-reuse — P17 — since the table was briefly empty) but a **freshly-set `paired_at`**, proving this correctly went through `register_device` (a fresh row), not `reconcile_device` — the expected, correct outcome of an explicit backend-side unpair (`DeviceService.remove_device` is a genuine hard delete; a deleted identifier can no longer match on the next pairing attempt, and *should* register as new).
   - **Cycle 2 (Forget again, Desktop row left untouched, re-pair again):** this is the actual scenario P47's item 5 requires. Backend response showed `id: 1` (unchanged), `device_identifier` unchanged, `device_name` unchanged ("RMX3997"), and — critically — **`paired_at` byte-for-byte unchanged** from before this second re-pair (`2026-08-16T08:54:29.646944` both before and after), with only `updated_at` advancing. This is only possible via `PairingService.approve_pairing`'s `reconcile_device` branch (`device_secret_hash` rotated, every field it doesn't explicitly touch left alone) — direct proof that true P43 reconciliation fired, no duplicate row was created, and the Android `device_identifier` genuinely survived `clearSession()` (confirmed independently at the code level in §4, and now confirmed functionally here).
   - Device count stayed at exactly 1 in the backend's device list throughout both cycles — no duplicate ever appeared.

**10. Regression testing:** Desktop's Devices tab was screenshotted mid-session and showed the RMX3997 row as `Paired` with working `Rename`/`Remove` buttons, unaffected by any of this work. Discovery, QR pairing, and device naming were all exercised live as a side effect of §8/§9 and behaved exactly per their existing P23/P24/P43/P43.1 documentation — nothing needed updating. No backend file was touched (`git status` confirms `backend/` is clean), so Desktop-side unpair/session-reconciliation code paths are provably unchanged.

**11. Problems discovered (process, not product):**
   - Blind coordinate-based mouse automation (`SetCursorPos`/`mouse_event` via PowerShell) against the user's real desktop twice surfaced *other* on-screen windows into a screenshot mid-session — once the user's own unrelated browser tab, once a Windows taskbar hover-preview strip. Both were caught immediately, the content was not acted on or referenced, and this approach was abandoned in favor of asking the user to perform the two Desktop-side clicks (`Start Pairing`) themselves — a deliberate, disclosed change of approach mid-milestone, not a silent workaround.
   - The already-installed app's release signing (P40's local-verification keystore) meant a debug build could not be installed over it without an uninstall (which would have destroyed the valuable baseline-reproduction state in §2) — worked around by building/installing the `release` variant with the same keystore instead of debug, preserving app data across the update.

**12. Deferred issues:** none newly introduced. The pre-existing Android Files/Transfers Clear History live-sync gap (P41) and the version-string drift (P45/P46) are unrelated and untouched.

**13. Remaining limitations (explicitly out of this milestone's scope, per its own brief):**
   - No automatic Desktop address rediscovery, network re-scanning, or automatic session recovery — "Forget this desktop" is a deliberate, user-triggered, manual action only.
   - No backend `Device` deletion and no Desktop-side unpair change — confirmed via §10 that none occurred.
   - No new pairing protocol fields or device-identifier mechanism.

**14. Suggested commit message:**
```
feat(android): add "Forget this desktop" session recovery to Settings

Fixes the P46 release blocker: a paired Android device with an
unreachable stored desktop_base_url had no in-app way back to pairing
short of uninstalling the app. Adds a Connection section to Settings
with a confirm-gated action that calls the existing
SessionManager.clearSession() — RootNavigator's existing session-driven
routing handles the rest. device_identifier (P43) is untouched, verified
live: a re-pair after Forget reconciles onto the same backend Device row
with no duplicate created.
```

**15. Final verdict: P46's blocker is genuinely resolved, physically verified.**

- **Fixed and physically verified (RMX3997, real backend, real network):** the Settings action's existence/visibility, the confirm dialog (both Cancel and Confirm paths), the session-clear → return-to-pairing navigation, Discovery, a full real QR re-pair, authenticated post-re-pair operation (Files tab), and — via two distinct live cycles — both halves of the P43 regression surface (fresh-registration-after-explicit-removal, and true reconciliation-after-Forget-only).
- **Already correct (confirmed, not changed):** `SessionManager.clearSession()`, `RootNavigator`'s session-driven switch, `deviceIdentifier.ts`'s independent persistence, `AppDialog`/`useAppDialog`.
- **Fixed but only source/test-verified:** none — every part of this milestone's change surface was physically exercised on real hardware.
- **Deferred:** automatic address rediscovery (explicitly out of scope, see §13); the pre-existing Clear History live-sync gap and version-string drift (unrelated, pre-existing, untouched).
- **Remaining limitations:** none new. The same accepted V1 limitations from P46 §6 stand unchanged.

**The P46 release blocker is resolved.**

---

# Milestone P48 — Final Production Rebuild & Release Sign-Off

**Purpose:** the final production validation milestone for Relay V1 — rebuild all three production artifacts from current `main`, physically re-verify P43/P47 in the rebuilt artifacts, run a real end-to-end transfer/pairing pass, and issue a definitive ship/hold verdict. Not a feature-development pass.

**1. Release candidate identity.** Baseline: `git status` clean, HEAD `8dddf6f6e56ca94ce3b55efdceab8e7c27bcfc3e` ("feat(android): add forget device functionality" — the P47 commit). Confirmed via `git diff 9e2756f..HEAD -- backend/ desktop/`: empty — no backend or Desktop source has changed since P45's branding commit, so the P46-built backend/Desktop artifacts were already byte-identical in source terms to what P48 needed; they were rebuilt anyway per this milestone's explicit "must be built from current source" instruction. `git diff` for `android/` between the pre-P47 and HEAD commits: only `android/src/screens/settings/SettingsScreen.tsx` (+79 lines, the `ForgetDesktopCard`), confirmed via `git show --stat`.

**2. Exact artifacts (freshly built this pass, not reused):**
- **Backend:** `backend/dist/relay-backend/relay-backend.exe`, 9,929,960 bytes, built 14:52 from a **clean venv** (`python -m venv`, then `pip install -r requirements-build.txt` only — never `backend/.venv`, which carries unrelated dev packages per P38's established rule). Pinned versions resolved identically to P38/P46 (`fastapi==0.141.1`, `uvicorn==0.52.1`, `sqlalchemy==2.0.51`, `pydantic==2.13.4`, `pyinstaller==6.22.0`, `starlette==1.6.0`, ...). Built via `pyinstaller relay-backend.spec --noconfirm --clean`.
- **Desktop:** `desktop/dist/Relay-Setup-0.1.0.exe`, 118,742,681 bytes, built 14:59 via `npm run dist` (`electron-builder --win --x64`), pulling the just-built backend in via `extraResources`.
- **Android:** `android/android/app/build/outputs/apk/release/app-release.apk`, 94,832,338 bytes, built 15:03 via `./gradlew.bat :app:assembleRelease` (fresh, `rm -rf app/build/outputs/apk/release` first; build succeeded in 3m11s, 578 tasks). SHA-256: `b4790f97c436495b7a9c3146ff409d14c9efe45bb6565f3515edc3323a70d9e5`.

**3. Artifact freshness/content verification (inspected the built artifacts directly, not source):**
- Backend: launched in full isolation — a copy of `dist/relay-backend/` moved to a scratch directory with **no `.env` anywhere on its path** (the real gotcha this pass found and resolved: `pydantic-settings`' `env_file=".env"` resolves relative to the process's **working directory**, not the exe's own folder — the first isolation attempts accidentally launched with cwd still inside `backend/`, picked up the dev `.env`'s `DATABASE_URL`, and silently served the real dev database instead of a fresh one; not a product defect, a test-harness mistake, corrected by setting `-WorkingDirectory` explicitly to the isolated exe folder). With `PATH` scrubbed to `C:\Windows\System32` only and a fresh `RELAY_DATA_DIR`: process started, created a fresh `relay.db`/`logs/` under that directory, served `GET /api/v1/devices` (empty list) and `POST /api/v1/pairing/start` (QR payload correctly reporting `"port": 8196`, the exact `--port` this instance was launched with — re-confirms P39's env-var-before-import fix is intact).
- Desktop: `Get-AuthenticodeSignature` → `NotSigned` (expected/accepted). `Relay.exe` `VersionInfo`: `FileVersion`/`ProductVersion` 0.1.0, `CompanyName` "Relay Labs", `ProductName` "Relay", `LegalCopyright` "Copyright © 2026 Relay Labs", `Comments` empty (no unwanted description) — all matching P45's documented contract, re-verified against this fresh build.
- Android: `apksigner verify --print-certs` → V2-signed, `CN=Relay Local Verification, OU=Relay P40` (confirmed **not** the debug keystore). `aapt dump badging`: `package: name='com.relay.mobile' versionCode='1' versionName='1.0'`, `application-label:'Relay'` (all locales), **no** `application-debuggable` line. `assets/index.android.bundle` present, `file` identifies it as **Hermes JavaScript bytecode** (2,136,380 bytes) — a real embedded bundle, zero Metro dependency. Manifest (`aapt2 dump xmltree`): `networkSecurityConfig=@0x7f140004` wired to a real resource; resolved that resource (`res/8G.xml` under its obfuscated name) via `aapt2 dump resources -v` and `dump xmltree --file`, and confirmed its actual compiled content: `<base-config cleartextTrafficPermitted="true">` — genuinely present in the packaged manifest resource, not just in source.

**4. P43 regression — device identity (two full physical re-pair cycles on RMX3997, real QR scans, real backend inspection):**

Baseline recorded from the packaged app's own database (`%APPDATA%\Relay\relay.db`, freshly launched after the P48 installer upgrade): `id=1`, `device_identifier=edf05da3-7009-4698-ae0e-8646df985d22`, `device_name="RMX3997"`, `paired_at=2026-08-15T16:28:33.000355`. Note: this packaged-app database is a separate lineage from the dev-backend database P47's own `docs` entry cites (`backend/relay.db`) — the two were never expected to agree, and didn't need to for this test.

- **Cycle 1** — the phone's own locally-stored `device_identifier` (persisted independently of `Session` since P43, untouched by anything done between P47 and now) did **not** match this stale baseline row, because the packaged app's database predates the phone's actual current identity. Desktop correctly surfaced this as a **P43.1 name collision** (`RMX3997` vs `RMX3997`), not a plain approval — the user confirmed seeing the Replace/Make-new dialog and chose **Replace**. Backend result: `id=1` (unchanged), `device_name` unchanged, but `device_identifier` changed to `29592ea5-b5e7-4739-a687-c264458d8dd3` and `paired_at` refreshed to `2026-08-16T09:41:53.974044` — the exact signature of `DeviceService.replace_device`, correctly dispatched.
- **Cycle 2** (the actual P43 acceptance test — Forget-only, no Desktop-side removal in between): tapped "Forget This Desktop" on Android (confirmed via `AppDialog`, destructive-red confirm button, correct copy), app fell back to Discovery, found "Thomas" live, real QR scan + Approve. Backend result: `id=1`, `device_identifier=29592ea5-...` (**byte-identical** to Cycle 1's result), `device_name="RMX3997"` (unchanged), **`paired_at=2026-08-16T09:41:53.974044`** — **byte-for-byte unchanged** from Cycle 1 — only `updated_at` advanced (`09:47:11.610894`). Device count stayed at exactly 1 throughout. This is the unambiguous signature of `PairingService.approve_pairing`'s `reconcile_device` branch firing, not a fresh registration.
- **Old session invalidated / new session works:** queried the packaged app's `sessions` table directly (`sqlite3` via the clean build venv) — **exactly one row**, `issued_at=2026-08-16 09:47:11.611828` (matching the Cycle 2 reconciliation moment to the millisecond), proving the prior session was deleted, not merely superseded. Android's Files tab loaded `"No files are currently shared."` immediately after re-pairing — a real authenticated `GET /files` success against the new token.

**5. P47 regression — Android session recovery (verified in the fresh APK on RMX3997):** the `CONNECTION` section and `ForgetDesktopCard` render correctly below `DEVICE`/`STORAGE` in Settings, with the documented neutral (non-red) trigger button and the exact confirm-dialog copy ("Forget this desktop?" / "Forget Desktop" in red on the dialog's own confirm button only, per P47's trigger-vs-confirm-button distinction). Confirming it genuinely dropped the app back to Discovery/pairing (screenshotted both before and after) — a real `RootNavigator` stack swap. §4 above is this same mechanism's functional proof: `device_identifier` survived two separate `clearSession()` calls untouched.

**6. Physical E2E (real hardware throughout — no API simulation):** the PC's Wi-Fi and RMX3997's mobile hotspot were already on the same subnet at the start of this pass (carried over live from the P47 session — `10.130.191.233`/`10.130.191.86` on `ap0`), confirmed via `Get-NetIPConfiguration` and `adb shell ip addr show ap0` before proceeding, no reconnection needed. Two full QR-camera-to-screen pairing cycles were performed by the user (not simulated) against the real packaged Desktop app and the real installed release APK; Desktop correctly showed the collision dialog once and a plain approval once, matching §4's two cycles exactly. GUI automation on the Desktop side was avoided after one `SetForegroundWindow` call surfaced an unrelated window (the user's own browser tab) mid-session — the screenshots were deleted immediately without being acted on or referenced, and every subsequent Desktop-side click (Start Pairing, Approve, Open/Show in Folder on stale items, Refresh/Delete on a stale source) was performed directly by the user at Claude's direction, exactly the workaround P47's own notebook entry already established.

**7. Transfer validation (real packaged products, byte-verified via `adb shell cat`/size checks and backend API inspection, not just UI state):**

*Desktop → Android:* a standalone file (`hello.txt`, 50 B), a zero-byte file (`empty.bin`, 0 B), a Unicode-named file (`ünïcödé 文件 🎉.txt`, 22 B — content byte-verified via `adb shell cat`), and a nested folder (`nested/inner.txt` + `nested/deeper/deepfile.txt`, proving multi-level structure preservation) — all shared via the backend's own loopback API (`POST /api/v1/files`/`/folders`, the same mechanism the Desktop UI itself calls) and downloaded for real on RMX3997. All five landed with exact matching sizes and byte-identical content on the phone's storage. Duplicate-name handling: a second, different-content `hello.txt` (81 B) downloaded alongside the first correctly resolved to `hello (1).txt` with its own distinct content — no clobbering.

*Note on Unicode via automation:* the first two attempts to share the Unicode-named file via PowerShell's `Invoke-RestMethod` produced a mojibake `file_name` in the response (`Ã¼nÃ¯cÃ¶dÃ©...`) even from a byte-perfect UTF-8 JSON file on disk — isolated to a PowerShell console/byte-array-body encoding artifact (confirmed by re-sending the *identical* file via `curl --data-binary`, which returned the correct `"ünïcödé 文件 🎉.txt"` immediately). **Backend Unicode handling itself is correct**; this was purely a test-tooling quirk, noted here so it isn't mistaken for a product defect in a future pass.

*Android → Desktop:* a single-file upload (`hello.txt`) through the real native picker → `UploadConfirmSheet` (exact "Upload this file" wording confirmed) → `POST /transfers/requests`, and **two** real folder uploads via the native SAF folder picker (a `nested` folder, 2 items, and a `Relay` folder, 6 items including its own nested `deeper` subfolder) — both grouped correctly into single rows on both Android's Transfers list and via the backend's `upload_batch_id`, with `folder_relative_path` correctly preserving the picked structure (e.g. `Relay/nested/deeper/deepfile.txt`). Verified byte-for-byte on the Desktop's actual download directory (`deepfile.txt`, `hello (1).txt` content read back and matched exactly).

*Folder-picker intermittent failure (found, root-caused, classified — not a new regression):* the first several folder-upload attempts (both via `adb input tap` automation **and**, confirmed separately, the user's own genuine physical touches) failed with `"Could not open the folder picker."` — reproduced for two different target folders, ruling out a folder-specific cause. Root-caused via `TransferListScreen.tsx`'s `handleUploadFolder` (a bare `catch {}` swallowing the real error) and `folderPicker.ts`'s own doc comment, which **already documents** this exact failure mode: `react-native-saf-x`'s `listFiles()` intermittently rejects with "Unsupported Uri" on certain real devices (previously observed live on a realme C65 5G during P13) even with the `persist: true` workaround already applied — "the exact same call succeeds once the grant is persisted." The user confirmed it self-resolved after 2-3 retries with no crash, no stuck state, and no data loss — exactly the documented behavior, now also observed on RMX3997. **Classified as an accepted, pre-existing, environment/library-level limitation, not a P48 regression** (`folderPicker.ts` is unchanged since P13, long before P41) — see §13.

**8. Transfer lifecycle (progress, cancellation, history — real, larger files to get a visible multi-second window):** an 80 MB download completed in ~13.5 s (`bytes_transferred == file_size` exactly, real `started_at`/`completed_at` gap). A 150 MB download was observed live increasing (0 B → 112 MB in ~1 s — this LAN sustains roughly 75 MB/s). A 600 MB download was opened at 1.4 MB and cancelled from the Transfer detail screen at 72.0 MB — status correctly settled to **"Cancelled"**, partial bytes preserved and displayed, entry retained in history. The Transfer detail screen's progress bar (P33's native-`<progress>`-backed rendering) was confirmed visually rendering correctly in the final packaged release APK for both the in-progress and cancelled states. **Clear History** confirmed: the Android Transfers list emptied to "No transfers yet.", while the underlying backend `Transfer` rows (ids 50-57 and earlier) remained fully queryable via `GET /transfers` — confirming Clear History is still the documented local-only marker, never a backend delete. Failure-path handling (a transfer failing mid-stream) was **not freshly reproduced this pass** — `transfer_stream_service.py` is unchanged since P41's own byte-verified failure-injection tests, and reproducing it again would need artificial network/mid-stream file deletion with no code-path changed to justify it; this is a deliberate reuse of P41's evidence, not a skipped check.

**9. Stale-file regressions (both physically re-verified on the final packaged Desktop app):**
- **P44 (downloaded item deleted externally):** deleted a received `hello.txt` from `Downloads\Relay` on disk, then clicked Open on the corresponding Shared Files row — got the documented "File unavailable — This file was moved or deleted from its original download location." dialog, and the stale row was removed from the list. (One round of user confusion mid-test, resolved: an earlier click momentarily showed old content, almost certainly a stale already-open Notepad window from an earlier, pre-deletion "Open" click in this same long session, not a live re-read — the deliberate, clean repro immediately after was unambiguous and correct.) Confirmed via the backend API that the underlying `Transfer` row (`id=46`) is still fully intact (`status: completed`, `bytes_transferred: 50`) — permanent history genuinely untouched by the UI-side removal.
- **P32/P29 (shared source deleted externally):** deleted the source file backing a shared item (`empty.bin`), clicked Refresh — got the documented generic scoped row error with a Retry button (no raw filesystem path exposed, whole-view unaffected), then clicked Delete — the item was correctly removed (`GET /api/v1/files/4` → `404 "Shared file 4 was not found."` immediately after).

**10. Persistence / restart (both platforms):**
- **Desktop:** killed `Relay.exe` and `relay-backend.exe` entirely, relaunched via the real installed shortcut path. Backend auto-spawned again; `device_display_name` ("Thomas"), `download_directory`, and the paired `RMX3997` device row (same `id`/`device_identifier` as §4's final state) all survived intact.
- **Android:** `adb shell am force-stop` + relaunch — session survived with no re-pair prompt, Shared Files loaded live authenticated data immediately on the first frame.
- **Upgrade-in-place (Desktop):** the P48 installer was run silently (`/S`) over the existing P46-era install. `relay.db` confirmed **byte-identical** before/after via SHA-256 (`8D1B823B...81701681`, matched exactly) despite `Relay.exe`/backend both being freshly deployed (new `LastWriteTime`, backend `Length` matching the fresh 9,929,960-byte build). Registry `DisplayName`/`Publisher` and both Desktop/Start Menu shortcuts (empty `Description`, correct `TargetPath`/icon) all re-verified correct on this fresh install.
- **Uninstall:** **not repeated this pass** — the NSIS/`electron-builder` config is confirmed byte-unchanged since P39/P45 (`git diff` on `desktop/package.json`), and P39 already physically verified uninstall behavior (binaries/shortcuts removed, `%APPDATA%\Relay` preserved). Reusing that evidence per this milestone's own "don't repeat unchanged packaging tests" instruction rather than performing a destructive uninstall on the machine mid-audit.

**11. Security/release checks:** Android release-signed (non-debug, `CN=Relay Local Verification`) ✓; not debuggable (`aapt dump badging`, no flag present) ✓; Hermes bundle embedded, zero Metro dependency ✓; Desktop has no Python dependency (isolated-launch test, §3) ✓; backend executable is bundled (`resources/backend/relay-backend.exe`, confirmed spawning from that exact path) ✓; no test credentials/secrets/keystores tracked (`git ls-files` sweep — only the pre-existing, accepted, non-secret `android/android/app/debug.keystore` and `.env.example` templates) ✓; no debug backdoors or new logging found (only Android source change this cycle, `SettingsScreen.tsx`, already reviewed in P47) ✓; LAN plaintext HTTP confirmed as the intentional, unchanged V1 design (`cleartextTrafficPermitted="true"`, §3) ✓. Unsigned Windows binaries and the local-verification Android signing identity are **not** treated as new blockers, per this milestone's own explicit instruction — both remain the same accepted V1 limitations P37-P46 already established.

**12. Repository audit:** `git status` clean at HEAD `8dddf6f`, no staged or unstaged diffs, nothing untracked. `git ls-files` swept for `.db`/`.apk`/`.exe`/`dist/`/`build/outputs`/`node_modules`/`.env`/secret-looking filenames — only the already-accepted `debug.keystore` matched, nothing new. No P42-style cleanup performed (none needed — this was a verification pass, not a hygiene pass, per this milestone's own instruction).

**13. Remaining limitations, classified:**

| Item | Classification |
|---|---|
| No code signing (Desktop/Android) | **Accepted V1 limitation** (unchanged since P37) |
| Android release signing = local verification keystore | **Accepted V1 limitation for this V1** — must be replaced before public/store distribution |
| Windows Firewall first-run prompt | **Accepted V1 limitation** — functional connectivity already confirmed (P46) |
| Android Files/Transfers Clear History live-sync gap | **Accepted V1 limitation / post-V1 backlog** (unchanged since P41) |
| `fileIdentity.ts` id-reuse gap | **Accepted V1 limitation** (unchanged since P17) |
| Desktop/Android version-string drift | **Accepted V1 limitation** — each platform internally consistent, no shared-version mechanism exists by design |
| Received-item stale-path identity edge case (P44) | **Accepted V1 limitation** (unchanged, narrow) |
| Automatic Desktop address rediscovery | **Post-V1 backlog** — P47 deliberately shipped manual "Forget" instead |
| **`react-native-saf-x` intermittent folder-picker "Unsupported Uri" failure (§7)** | **Accepted V1 limitation, newly re-confirmed live on RMX3997** — self-recovers on retry, no data loss, already documented in source since P13; a **post-V1 backlog candidate** if it proves worse on other real devices (e.g. retry-with-backoff inside `pickAndEnumerateFolder`, or evaluating an alternative SAF library) |

No item in this list rises to release-blocker status.

**14. Final verdict: SHIP.**

Every fresh production artifact was built from current `main` and directly inspected (not assumed from source); P43's identity-reconciliation contract holds byte-for-byte across two full physical re-pair cycles on the actual rebuilt artifacts; P47's recovery flow is present and physically verified in the fresh APK; a real QR-camera pairing was performed twice against the real installed products over a real LAN; Desktop→Android and Android→Desktop transfers (files, zero-byte, Unicode, nested folders, duplicate names, folder uploads with confirmation sheet) are all byte-verified; transfer progress/cancellation/history/Clear History all behave correctly in the final packaged build; both stale-file regressions (P44, P32/P29) hold; persistence survives real restarts on both platforms and a real installer upgrade-in-place with the database byte-identical before and after; the repository is clean; and the one new finding from this pass (the SAF folder-picker intermittent failure) is a previously-documented, self-recovering, environment-level limitation, not a defect introduced by or newly exposed as blocking by this milestone. **Relay V1 is ready to ship.**

---

# Milestone P49 — Zero-Cost Distribution Architecture & Release Strategy

**Purpose:** an investigation/architecture-only pass (no application source, no builds, no deployment) to decide exactly how the already-shipped V1 (P48: SHIP) reaches real users at genuine $0 recurring cost — website hosting, GitHub Release structure, versioning convention, Android sideload UX, Android/Windows signing posture, checksum strategy, update model, domain strategy, and a security audit of the proposed architecture. Full 20-section report delivered to the project owner in-conversation; this entry records the investigation evidence and decisions for the repository. See `CLAUDE.md`'s "Zero-Cost Distribution Architecture & Release Strategy (P49)" section for the condensed durable conventions future milestones must follow.

**1. Current release state (inspected directly, not assumed):**
- **Repository:** `https://github.com/MohdSaad01/Relay`, confirmed **public** (fetched the live page). MIT-licensed (`LICENSE`). One existing tag, `backend-v1-complete` (2026-08-02, a mid-project checkpoint, not a version tag) — **no `vX.Y.Z` tag exists yet, and no GitHub Release has ever been published.** No `.github/` directory — no CI/CD workflows exist.
- **Desktop:** `desktop/package.json` — `version: "0.1.0"`, `productName: "Relay"`, `appId: "com.relay.desktop"`, `author: { "name": "Relay Labs" }`, `description: ""` (deliberately empty per P45), NSIS/`electron-builder` per-user installer, `compression: "store"` (P45). No auto-update mechanism (no `electron-updater` dependency, no update-check code anywhere in `desktop/src`). `Get-AuthenticodeSignature` on the built installer → `NotSigned` (P39/P45/P46/P48, unchanged). GitHub Releases can distribute the `.exe` directly — a plain binary asset, no special handling needed (confirmed against current GitHub Releases documentation, §2 below).
- **Android:** `applicationId "com.relay.mobile"`, `versionName "1.0"`, `versionCode 1` (`android/android/app/build.gradle`). Release signing reads a gitignored `keystore.properties` (real file exists locally, confirmed untracked via `git ls-files`) or environment variables, fails fast if absent (P40) — never falls back to `debug.keystore`. The signing identity used for every release build so far is explicitly a **local verification keystore** (`CN=Relay Local Verification, OU=Relay P40`, confirmed via `apksigner` in P46/P48), not a final production identity. APK is directly sideloadable (a standard, non-Play-Store APK); no update mechanism exists beyond "download and install a newer APK," which only preserves app data if the new APK is signed with the *same* certificate as the installed one (confirmed live in P48 §4 — a signature mismatch forced an uninstall-equivalent reinstall path).
- **Backend:** confirmed architecturally hosting-free by design — `desktop/src/main/backend-manager.js` spawns `relay-backend.exe` as a local child process of the Electron app (P38/P39); Android never talks to any server other than the paired desktop's own LAN address (`docs/09_Networking.md`, `docs/10_Security.md` §12). There is nothing to host for V1 distribution beyond the two static installer/APK files — confirmed by re-reading `docs/12_Packaging_Deployment.md` and `CLAUDE.md`'s own architecture section, not assumed.
- **Checksums:** no systematic checksum process exists. A single SHA-256 was computed ad hoc for the APK during the P46 audit (`b4790f97c436495b7a9c3146ff409d14c9efe45bb6565f3515edc3323a70d9e5`) as a freshness-comparison aid, not as part of any release/publishing flow.
- **Website:** does not exist in this repository in any form (no `website/`, `docs/site/`, or similar directory).

**2. External facts verified against current sources (not assumed from training knowledge):**
- **GitHub Releases:** no limit on total release size or download bandwidth; each individual asset must be ≤ 2 GiB (Relay's ~119 MB installer and ~95 MB APK are both far under this); up to 1000 assets per release. Old releases remain available indefinitely at no cost. [GitHub Releases docs](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [community discussion on asset limits](https://github.com/orgs/community/discussions/196657).
- **GitHub Pages:** free for public repositories; ~1 GB recommended site size, ~100 GB/month bandwidth (soft, not a hard cutoff), ~10 builds/hour; custom domain + free HTTPS (Let's Encrypt) supported. [Devian guide](https://www.devian.in/blogs/github-pages-free-hosting), [Supadrop limits reference](https://supadrop.host/blog/github-pages-limits/).
- **Cloudflare Pages:** free tier has no enforced bandwidth cap (fair-use only), up to 500 builds/month on the free plan, multiple custom domains per project, free HTTPS via Cloudflare's edge. Requires a separate Cloudflare account and its own deploy pipeline (Git integration or Wrangler CLI), distinct from GitHub's own repo settings. [DevToolReviews](https://www.devtoolreviews.com/reviews/cloudflare-pages-pricing-bandwidth-limits-2026), [Easton free-limits guide](https://eastondev.com/blog/en/posts/dev/20260526-cloudflare-free-limits/).
- **Android sideload UX (Android 14/15):** the "Install unknown apps" permission is now granted **per source app** (the browser or file manager used to open the APK), not a single device-wide toggle — `Settings → Apps → Special app access → Install unknown apps`, select the app, allow. [AndroidInfotech](https://www.androidinfotech.com/unknown-sources-app-installation-android/), [Appaloosa IT admin guide](https://www.appaloosa.io/blog/guides/how-to-install-apps-from-unknown-sources-in-android). Google Play Protect independently scans sideloaded APKs on Play-Protect-certified devices and may show its own "unsafe app" style warning even for a legitimate, non-malicious APK — expected friction, not a Relay defect. [Google Play Protect dev guidance](https://developers.google.com/android/play-protect/warning-dev-guidance).
- **Google Android Developer Verification (forward-looking, not a current blocker):** Google is rolling out a requirement that installing *any* app — including sideloaded ones — on a "certified" (Play-Protect) Android device requires the app's developer to have completed an identity-verification step, comparable to a free/low-friction "ID check," separate from any Play Store listing or the $25 Play Console fee. A free workflow exists for students/hobbyists. Enforcement begins **2026-09-30 in four countries only (Brazil, Indonesia, Singapore, Thailand)**; global rollout is planned for **2027**. An "advanced flow" for installing from unverified developers (and ADB) remains available. This does not block or cost anything for Relay's V1 release today, but is a real forward-looking item — see Part 13's milestone sequencing note. [9to5Google](https://9to5google.com/2025/08/25/android-apps-developer-verification/), [Android Developers Blog](https://android-developers.googleblog.com/2025/08/elevating-android-security.html).
- **Free Windows code signing:** no genuinely free, no-strings production code-signing option exists that puts "Relay"/the project owner's own name on the certificate. **SignPath Foundation** (and the similar **OSSign**) sponsor free OV-level Authenticode signing for qualifying open-source projects, but the certificate's publisher identity shown to end users is the *foundation's* name (e.g. "SignPath Foundation"), not the project's, and integration requires wiring the project's build into SignPath's own CI-based signing pipeline (an added dependency/process, not a drop-in). Even a signed OV certificate does not grant instant Microsoft SmartScreen trust — that reputation still has to accumulate over time/downloads (Microsoft's old instant-trust EV-certificate exception is no longer a factor most small projects can access cheaply). Azure Trusted/Artifact Signing exists but is a paid service (~$9.99/mo Basic tier) restricted to certain business regions — excluded by the $0 constraint. [SignPath OSS program](https://signpath.io/solutions/open-source-community), [Microsoft code-signing options doc](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options), [comparecheapssl.com 2026 overview](https://comparecheapssl.com/free-code-signing-certificate-and-how-to-get-it/).
- **Domain cost baseline:** a custom domain (e.g. via Cloudflare Registrar/Namecheap/Porkbun at at-cost pricing) runs roughly $10-15/year for a typical `.com`/`.dev`/`.app` TLD — not $0, and not purchased or assumed necessary during this investigation.

**3. Security audit of the proposed architecture (Part 11 of the report):** no secrets are committed anywhere in the tracked repository (`android/android/keystore.properties`, the real local-verification credentials file, is confirmed present locally but untracked via `git ls-files`; only the non-secret RN-template `debug.keystore` and the `keystore.properties.example` template are tracked; `backend/.env` is likewise untracked, only `.env.example` is). A targeted grep for hardcoded API keys/secrets/passwords/private-key material across the whole tree returned no matches. The repository being public exposes no credentials, tokens, or production signing material — Relay's architecture never persists long-lived secrets in source (pairing tokens are runtime-only per `docs/13_Database_Design.md` §9, session tokens are hashed at rest). Publishing the source, the installer, and the APK publicly introduces no new exposure beyond what P37-P48 already accepted (unsigned binaries, a local-verification Android signing identity that must not be treated as production-grade — see Part 6/P50 below).

**4. Decisions reached (see `CLAUDE.md` for the full durable record):**
- **Website host:** GitHub Pages (primary) — same platform as the code, zero separate account/billing relationship, ample soft limits for a small mostly-text site whose actual file bandwidth is served by GitHub Releases (not Pages) anyway. Cloudflare Pages recorded as the credible fallback if a future need (custom analytics, edge functions, a stricter bandw' guarantee) arises.
- **Artifact host:** GitHub Releases, one release per `vX.Y.Z` tag, assets `Relay-Setup-<version>.exe`, `Relay-<version>.apk`, `SHA256SUMS.txt`. Auto-generated source-archive zips are ignored/irrelevant (they can't be built without the full monorepo tooling and a real signing keystore).
- **Versioning:** unify on product-level `1.0.0` for the V1 public release (git tag `v1.0.0`, Desktop `package.json` version, Android `versionName`, `versionCode` starting at 1 for this first public release, backend `APP_VERSION`) — proposed, **not applied** in P49.
- **Windows signing for V1: unsigned.** SmartScreen's "unrecognized publisher" warning is accepted, matching the already-documented V1 limitation (`README.md`, `docs/12_Packaging_Deployment.md`). SignPath Foundation is the recommended $0 path for a *future* signed release, once a CI pipeline exists to integrate with it — explicitly deferred, not attempted in P49.
- **Android signing for V1 public release: a new production keystore must be generated before the first public distribution** (not the existing local-verification one) — deferred to a dedicated milestone (P50) per the project owner's own signing-key-generation caution, not generated in P49.
- **Checksums:** `SHA256SUMS.txt` generated at release-build time (`certutil -hashfile`/`sha256sum`), published as a release asset and displayed on the website; supplements, does not replace, code signing.
- **Domain:** ship V1 on GitHub Pages' free `*.github.io` subdomain; a custom domain (~$10-15/yr) is a future, explicitly-owner-approved purchase, not assumed or recommended for V1.

**5. Verdict: investigation complete, architecture decided, nothing deployed.** No GitHub Release was created, no website was built or published, no production Android keystore was generated, no domain was purchased, and no application source, build configuration, or dependency was changed. Milestone sequencing (P50-P54) proposed for project-owner authorization — see `CLAUDE.md`. Per this file's and `CLAUDE.md`'s own Git Workflow rule, no next milestone begins automatically.

---

# Milestone P50 — Production Android Signing

**Purpose:** replace the local-verification Android signing identity used by every prior release build (P40/P46/P48) with a genuine production keystore, per P49's own conclusion that public distribution must not ship under a keystore explicitly labeled "not for production." Signing only — no website, no GitHub Release, no version-string changes (`CLAUDE.md`'s P51 boundary).

**1. Baseline investigation (before any change):** `android/android/app/build.gradle` already implements the exact fail-fast, keystore-agnostic mechanism P40 documented — resolves `RELAY_RELEASE_STORE_FILE`/`_STORE_PASSWORD`/`_KEY_ALIAS`/`_KEY_PASSWORD` from a gitignored `keystore.properties` (checked first) or environment variables (fallback), and a `gradle.taskGraph.whenReady` guard throws a `GradleException` before `assembleRelease`/`bundleRelease` run at all if neither source supplies all four values — confirmed by direct inspection, not assumed correct because P40 previously passed. **No Gradle changes were needed** — swapping the signing identity is purely a `keystore.properties` content change, exactly as the mechanism was designed to allow. The pre-existing local-verification keystore (`android/android/relay-release-local-verification.keystore`, gitignored, `CN=Relay Local Verification, OU=Relay P40`) and its `keystore.properties` were left in place on disk (not deleted — still potentially useful for local dev builds) but are no longer referenced by the active `keystore.properties`.

**2. Production keystore generation.** Per the project owner's explicit direction (asked before generating anything, matching P50's own "stop and confirm" instruction): stored at `C:\Users\Saad\ProjectSigning\RelaySigning\relay-release-production.keystore` — a dedicated folder **outside the repository entirely** (stricter than the P40 keystore's in-repo-but-gitignored location), to be backed up by the project owner into a password manager/encrypted vault. `keytool -genkeypair` (PKCS12, RSA 2048, 10000-day validity, alias `relay-release-production`, DN `CN=Relay Labs, OU=Relay, O=Relay Labs, L=Local, ST=Local, C=US` — matching `desktop/package.json`'s existing `author.name` for cross-platform identity consistency). The password was generated as a 32-character random string and written **only** to `android/android/keystore.properties` (gitignored) — never displayed in any tool output after generation, never logged, never placed in this document or `CLAUDE.md`.

**3. Git/secret audit (run both before and after):** `git status`/`git diff` showed no unexpected tracked changes; `git ls-files | grep -i keystore` returned only `app/debug.keystore` (the standard RN-template debug keystore, intentionally tracked) and `keystore.properties.example` (the secret-free template) — the real `keystore.properties` and the production `.keystore` file (outside the repo tree) are both confirmed untracked; `git check-ignore -v android/android/keystore.properties` confirmed the gitignore rule still applies; a targeted `git grep` for the generated password across the whole tree returned no matches. Clean.

**4. Build and artifact verification.** `./gradlew.bat :app:assembleRelease` succeeded (`versionCode 1`/`versionName "1.0"`, unchanged per this milestone's explicit boundary). `apksigner verify --print-certs` on the resulting `app-release.apk`:
```
Signer #1 certificate DN: CN=Relay Labs, OU=Relay, O=Relay Labs, L=Local, ST=Local, C=US
Signer #1 certificate SHA-256 digest: 59af725033dcb49e92964df01c8fa4d2493084cd97e5e6669f4b100d8ad564ba
```
— confirmed distinct from both the P40/P46/P48 local-verification certificate (`CN=Relay Local Verification, OU=Relay P40`, SHA-256 `230fe66672f24068c9bd22f2c457bc0a993a74c4e0c9644cf7a7707a13b98907`) and the RN debug certificate. `aapt2 dump badging`/`dump xmltree` confirmed: `applicationId com.relay.mobile` unchanged, `application-label:'Relay'` unchanged, no `application-debuggable` flag present (release build genuinely non-debuggable — independently reconfirmed live on-device: `adb shell run-as com.relay.mobile` returned `run-as: package not debuggable`), Hermes native libraries and `assets/index.android.bundle` present, `network_security_config.xml`'s `cleartextTrafficPermitted="true"` intact (resource-renamed to `res/8G.xml` by resource shrinking, resolved and inspected directly). Zip listing confirmed no keystore/`.properties`/credential file anywhere inside the APK.

**5. Physical-device verification (RMX3997, USB/ADB).** The device already had Relay installed under the old local-verification certificate — uninstalled it (a same-cert upgrade is architecturally impossible across a signing-identity change, exactly as P50's own instructions anticipated) and cleanly installed the production-signed APK. Confirmed live: app launches, package/version/signature match the built artifact (`pkgFlags` show no `DEBUGGABLE`), QR pairing to the real Desktop app succeeded, Files/Transfers/Settings all render correctly, P47's "Forget This Desktop" is present and correctly worded, and a full authenticated round trip (share a file from Desktop over loopback → appears on Android → Download → completes → row shows "Open") succeeded byte-correctly.

**6. Same-key update-continuity test.** Per this milestone's Part 7 instruction, a version bump was the legitimate way to exercise a real update path: temporarily set `versionCode 2` (documented here, reverted immediately after), rebuilt (**vB**, same production keystore) — `apksigner` confirmed vB's certificate fingerprint is byte-identical to vA's. Installed vB via `adb install -r` **over the running vA install, without uninstalling** — succeeded (a certificate mismatch would have failed with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, the exact failure mode a signing-identity change like P40→P50 itself produces). Confirmed via `dumpsys package`: `firstInstallTime` unchanged, `lastUpdateTime` reflected the in-place update, and the app launched directly into the paired `MainTabs` state with zero re-pairing required — proving the production identity, once established, supports normal in-place updates with full data/session continuity. `versionCode` was then reverted to `1` and the project rebuilt clean (`git diff` on `build.gradle` confirmed a no-op net change); this final rebuild is the actual P50 deliverable artifact. The device itself was deliberately left on the vB test build after the continuity test (same production certificate, fully functional) rather than forcing a second disruptive uninstall/re-pair cycle purely for version-number cosmetics — noted here rather than silently left unexplained.

**7. One anomaly discovered, investigated, and left unfixed (out of P50's signing-only scope).** During the initial clean-install pairing (step 5), the Desktop app reported a device-name collision and the project owner chose "Replace" — but backend log/DB inspection afterward showed the pairing actually settled through the plain P43 *reconciliation* path (matching `device_identifier`, `Device.paired_at` unchanged from an earlier-that-day timestamp), not a P43.1 *replace* (which would have produced a new row/new `paired_at`). This means the freshly-reinstalled Android app's `device_identifier` (`android/src/pairing/deviceIdentifier.ts`, persisted via `react-native-blob-util`'s `DocumentDir`, confirmed in source to map to `context.getFilesDir()` — genuine OS-guaranteed-private, uninstall-wiped storage) apparently survived an `adb uninstall` + `adb install` cycle on this specific device (RMX3997, ColorOS/RealmeUI) intact, when Android's own platform contract says it should not be possible. `adb shell run-as` could not directly inspect the file (non-debuggable release build, correctly), so this could not be conclusively root-caused within P50's scope. It contradicts CLAUDE.md's P43 assumption ("still lost on app uninstall... intentional") for at least this one OEM ROM, but does **not** indicate any defect in the production signing work itself — the pairing, reconciliation, and session all behaved correctly given whatever identifier was actually submitted, and this exact class of app-data-survives-uninstall behavior (if real) is a known category of ColorOS/RealmeUI "recently uninstalled apps" data-retention feature, not something fixable from Relay's own code. Recorded here for a future milestone to investigate if it recurs or is seen on another device — not fixed, not re-investigated further, per P50's explicit signing-only charter.

**8. Automated regression checks (all clean, zero source changes required beyond the documented, reverted version bump):** `tsc --noEmit` — no output/no errors. `eslint .` — 4 pre-existing warnings (`react/no-unstable-nested-components` ×2, `no-void` ×2), 0 errors, identical to the pre-P50 baseline. `jest` — **42 suites / 367 tests, all passed**, matching P48's baseline exactly.

**9. Key-management documentation.** `android/android/keystore.properties.example`'s existing guidance (generate via `keytool`, store outside the repo, back up securely, never commit) already matched what P50 executed — no changes needed there. `CLAUDE.md`'s P49 section already flagged the "must never lose this key" consequence (breaks the Android update chain permanently); P50 does not duplicate that warning, only fulfills it.

**10. Verdict: production Android signing identity established and verified. P50 complete.** `app-release.apk` at `android/android/app/build/outputs/apk/release/` is now signed with the real `CN=Relay Labs` production certificate, `versionCode 1`/`versionName "1.0"` unchanged, ready for P51 (version finalization) to build on. Per `CLAUDE.md`'s Git Workflow rule, P51 does not begin automatically.
