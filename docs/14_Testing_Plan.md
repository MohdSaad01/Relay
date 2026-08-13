# Validation & Testing Plan

Version: 1.1 — condensed 2026-08-09. This document tracks validation
*status and outcomes*. Full investigation detail (root-cause tracing,
live-device verification transcripts, code-level "gotchas") lives in
`docs/15_QA_NOTEBOOK.md`; each entry below names the milestone so the two
documents cross-reference by ID.

---

# 1. Purpose

This document defines the validation phase for Relay Version 1.

All planned implementation milestones (M1–M15) are complete. From T9
onward, the project is a Release Candidate; further work (the `P`-numbered
milestones) is product-polish, UX, and defect-fix passes layered on top of
a feature-complete system, plus final packaging.

---

# 2. Validation Principles

- No new features unless required to fix a verified defect.
- No architectural redesign unless an implementation bug exposes a genuine flaw.
- Every issue must be reproduced before being fixed.
- Every fix must include validation.
- Every validation milestone must end with a testing checklist.
- Never continue automatically to the next validation milestone.

---

# 3. Current Status Snapshot

- **Relay V1 is feature-complete** and was declared a Release Candidate at T9.
- **Backend:** 340 tests passed, 2 skipped (`pytest`); `ruff check` clean.
- **Android:** 310 tests / 38 suites passed (`npx jest`); `tsc --noEmit`
  clean; `eslint` clean.
- **Desktop:** no automated test suite exists for the plain-JS renderer
  (unchanged since T1) — verified throughout by manual/live testing and
  `node --check`.
- **Outstanding:** the packaging pipeline itself (T8 — no PyInstaller
  bundling, no Electron installer, no signed release APK), the P17
  candidate defect (`shared_folder_id` reuse), and a handful of accepted
  V1-scope limitations — see §6.

All live-device verification in this document and in the QA notebook was
performed on a single physical device, a realme C65 5G (model RMX3997,
ColorOS/RealmeUI, Android 16/API 36). Several defects found were specific
to this OEM's native library behavior (`react-native-saf-x`,
`react-native-blob-util`) — behavior on other devices/OEMs is not
independently verified.

---

# 4. Validation Milestones (T1–T9)

All nine are **Completed**. Each found at most a handful of defects, all
fixed and regression-tested.

### T1 — Environment & Build Validation
Installed, built, started, and shut down the backend, Electron desktop,
and Android app. No implementation defects. Doc/environment gaps noted at
the time (some since addressed): root `README.md` was missing, CLAUDE.md
milestone history was behind the project state, and native Android
compilation couldn't be validated (no Android SDK in the validation
environment).

### T2 — Backend Validation
End-to-end workflow testing (pairing, auth, discovery, shared files,
transfer orchestration, streaming, DB lifecycle, error handling, security).
**4 defects fixed:** upload path-traversal vulnerability; a streaming race
returning HTTP 200 instead of 409; discovery init failure on a fresh
database; an expired session's delete rolled back during request teardown.
Result: 276 passed, 2 skipped; `ruff` clean.

### T3 — Electron Desktop Validation
Live application testing (Electron + Chrome DevTools Protocol) across
lifecycle, tray, IPC, CSP, and every resource view. **1 defect fixed:**
backend timestamps are naive UTC; the renderer parsed them as local time,
so pairing attempts could appear not to expire. The renderer now always
interprets backend timestamps as UTC (`parseApiDateTime`).

### T4 — Android Validation
Full source review of every `android/src/` layer against
`backend/README.md`, plus the existing Jest suite (96 tests, 20 suites).
**1 defect fixed:** a race in `TransferStreamManager.start()` — two calls
fired back-to-back before the `POST_NOTIFICATIONS` await resolved could
both begin streaming, breaking the one-active-stream invariant. Fixed with
a synchronous `starting` guard set before the first `await`.

### T5 — End-to-End Integration
Validated complete cross-component workflows (discovery → pairing → auth
→ session restore → shared files → transfer → stream → cancel → device
removal → backend restart). **1 defect fixed:** starting a new pairing
attempt discarded an already-approved-but-uncollected pairing result,
leaving a device permanently paired in the database with no way to ever
receive its session credentials. The pairing manager now preserves
approved/rejected attempts until collected or naturally expired.
**Follow-up (not a defect, left open):** Android has no in-app recovery
flow if the desktop's network address changes.

### T6 — Cross-Platform Contract Validation
Traced every endpoint, field name, enum value, status code, and shared
constant actually used by the Electron and Android clients against the
backend's real Pydantic schemas/enums/config — not against documentation.
**No drift found.** Two non-defects noted: Android's discovery listener
checks `protocol_version` is numeric but not that it matches (harmless —
pairing's own QR flow enforces the real check); Android has no client-side
date-parsing code path today, so T3's naive-UTC bug class can't currently
occur there (but nothing prevents a future screen from reintroducing it).

### T7 — Reliability & Stress Testing
Multi-threaded stress harnesses against a real `uvicorn` process (not
simulated sequential calls): concurrent accept/reject races, concurrent
duplicate downloads, 300 concurrent `PATCH /devices/{id}` writes under the
production `QueuePool`, 200 concurrent transfer proposals, and a
hard-killed backend process/database. **2 defects fixed, both from the
same root cause** — nothing reconciled runtime state after an unclean
shutdown:
1. A `Transfer` left `IN_PROGRESS` by a crash never reached a terminal
   state. Fixed: `TransferService.reconcile_interrupted_transfers()`,
   called once at startup, marks any `IN_PROGRESS` row `FAILED`
   (`"Interrupted by backend restart."`).
2. Orphaned upload temp files (`.relay-upload-*`) survived a crash
   indefinitely. Fixed: `TransferStreamService.cleanup_orphaned_upload_temp_files()`,
   also called at startup.

Both are called from `app/main.py`'s `lifespan`. A test-harness-only
`AttributeError` from SQLite's `StaticPool` + shared in-memory connection
under genuine multi-threading was identified as a *test fixture*
limitation, not a production defect — any future concurrency test should
use a file-based DB fixture instead. Result: 286 passed (+6), 2 skipped.

### T8 — Packaging & Installation
Validated packaging *posture*, since no packaging pipeline exists to
exercise end-to-end. **1 defect fixed:** the packaged backend would
default to writing its SQLite database and logs inside its own
(potentially unwritable, upgrade-destroyed) install directory. Fixed: a
`RELAY_DATA_DIR` env var (defaulting `DATABASE_URL`/`LOG_DIR` under it when
set); `backend-manager.js` sets it to Electron's `app.getPath("userData")`
in a packaged build; an explicit `DATABASE_URL`/`LOG_DIR` still overrides
it. Result: 293 passed (+7), 2 skipped.

**Still not validated, no implementation to exercise yet:** backend
packaging (PyInstaller or equivalent), the Electron installer
(`electron-builder`/`electron-forge`), Android release signing (currently
the RN template's debug keystore), and install/uninstall/upgrade behavior.

### T9 — Release Candidate
Full-codebase review (backend, Electron, Android, docs, deps, config,
security, logging, test coverage, versioning, repo hygiene) as one
product. **No Critical or High defects.** Process-only items noted: T7/T8
fixes were uncommitted at review time, backend deps were unpinned, no
LICENSE chosen, no root README, CLAUDE.md milestone history outdated,
version numbers differed across components. **Relay V1 declared
feature-complete / a Release Candidate.** Result: 293 passed, 2 skipped.

---

# 5. Product-Polish & Reliability Milestones (P1–P17)

Scoped, targeted passes after T9 — mostly Android UX/reliability, some
backend-only. Sub-milestones (`P8.1`, `P9.1`, `P13.1`–`P13.3` + its
correction, `P14.1`–`P14.4`) are numbered continuations of their parent and
are tracked with full detail only in the QA notebook; outcomes are
summarized here. All are **Completed** unless noted.

#### P1 — Upload auto-accept (backend/Android/desktop)

Mirrored the download flow: `request_transfer` now creates the `Transfer` row
immediately for both directions, removing the desktop's manual
accept/reject step for uploads. Deleted the now-dead accept/reject/withdraw
endpoints, screens, and hooks.

#### P2 — Shared Files screen re-validation (Android)

Fixed three staleness bugs: a deleted download still showed "Downloaded" (added
on-device existence re-check); a meaningless `'...'` button state before
every download (now shows "Downloading..." directly); newly shared files
invisible until a manual pull-to-refresh (added focus-refresh + a slow
background poll).

#### P3 — Transfer state consistency (Android)

Fixed transfer-tab first-focus staleness (immediate refresh on focus, mirroring P2), a detail
screen briefly showing stale local progress after the server already said
Completed (server wins once terminal), and multiple downloads of the same
file name silently colliding in `Downloads/Relay` (added
`resolveAvailableMediaStoreName`, a "name (1).ext" convention matching the
backend's own upload-side naming).

#### P4 — Notifications & Open action (Android)

The completion notification never appeared because `notifyDownloadComplete()` wasn't
best-effort (a failure wrongly marked the transfer failed) and a failed
channel-creation promise was cached forever. Both fixed. Added an "Open"
action for a completed download (`react-native-blob-util`'s
`actionViewIntent`). "Share" investigated and found unimplementable without
a new native dependency — deliberately not added.

#### P5 — Live sync & responsiveness (Android)

Removed a redundant fetch on first screen mount (hook + focus-refresh both firing), decoupled a
download/upload's stream start from an unrelated list refresh (was
serialized, added latency), and closed the reverse staleness gap from P3
(a locally-finished stream could still show a stale server "in_progress"
badge/Cancel button for up to 2s).

#### P6 — File Browser UX refinement (Android)

A completed download could briefly show a disabled dead-end "Downloaded" pill (a stricter local
`fileExists === true` check disagreed with `deriveDownloadStatus`'s own,
more permissive tolerance — unified). A failed download's retry button now
reads "Retry" instead of "Download". Stale open-failure error messages now
clear correctly.

#### P7 — Download publishing: only `.txt` files landed (Android)

`react-native-blob-util`'s exact byte-count completion check
(`isDownloadComplete()`) could false-negative on larger, multi-chunk
downloads over a real device connection, aborting before
`publishDownload`/`notifyDownloadComplete` ever ran. Mitigated:
`downloadFile()` now stats the file already on disk on a native rejection
and treats an exact size match as success (cancellation still always
propagates). *This mitigated the symptom; the true native root cause was
found later — see P10.*

#### P8 — Streaming failure investigation (backend)

Physical retest surfaced two backend reliability bugs: (1) `_generate_download` only
learned a client had disconnected via the OS/event loop reporting a dead
socket — unbounded on this Windows target, observed to take 19s+ or never
fire at all while otherwise idle. Fixed with a bounded per-chunk write
timeout (`STREAM_WRITE_TIMEOUT_SECONDS`, default 15s;
`_WriteTimeoutStreamingResponse` + `abort_stalled_download`). (2)
`AuthService.authenticate()` flushed `last_used_at`/`last_seen_at` to
SQLite on every authenticated request (including plain GETs), holding
SQLite's single write lock for the full request — a real, unnecessary
contributor to a `database is locked` storm. Fixed: mutates the
already-tracked ORM objects instead, riding along on whatever commit the
route's own service performs.

#### P8.1 — Physical verification of P8 (Android)

P8's backend fix held (clean run across 8 file types, zero disconnect/lock errors). Found two
Android-only defects, unrelated to P8: `publishDownload()` reported success
even when `react-native-blob-util`'s native MediaStore write silently
failed on this device (fixed — now verifies the published file's on-disk
size); the download-complete notification channel had no sound configured
(fixed — `sound: 'default'`).

#### P9 — Detail screen "Download Interrupted" after Completed (Android)

`TransferProgressDetail`'s trailing error text read
`TransferStreamManager`'s raw local state directly, bypassing the
server-wins-once-terminal merge rule the rest of the screen already used —
so a stale local `'failed'` result could render underneath an already-
correct "Completed" status indefinitely. Fixed by gating on the merged
status instead. (The file-type correlation in the original report was
coincidental — P7's own matrix showed the opposite ranking on the same
codebase area; the real trigger is a size/timing property, not a type.)

#### P9.1 — Live investigation, three defects (Android)

(1) `isPublishedAt()`/`downloadedFilePath()` statted the wrong RNBU directory
constant (`DownloadDir`, the app's private scoped storage) instead of
`LegacyDownloadDir` (the real public folder `copyToMediaStore` actually
publishes into) — made even a *successful* publish register as failed for
every file type. **Fixed.** (2) Genuine, live, non-deterministic connection
loss on multi-TCP-segment downloads over this device's hotspot — the real
`IOException` was silently discarded inside `react-native-blob-util`'s
native response-draining loop, so it never surfaced to JS. **Root cause
found and fixed in P10.** (3) `Intent.createChooser` dropped
`FLAG_ACTIVITY_NEW_TASK`, breaking every "Open" tap. **Fixed** — the
chooser title is no longer passed to `actionViewIntent`.

#### P10 — Root cause of P7/P8/P9/P9.1's download truncations (Android native dependency)

Traced P9.1 Defect 2 to its actual source:
`react-native-blob-util`'s `ProgressReportingSource.read(Buffer sink, long
byteCount)` violated Okio's `Source` contract — it read bytes from OkHttp
and wrote them straight to the output file, but never copied them into the
`sink` buffer Okio's own contract requires. Okio's buffered layer therefore
saw an empty `sink` after the very first physical socket read and
concluded end-of-stream, silently truncating any download that didn't fit
in one read — with no exception anywhere. This single native bug explains
every "Download interrupted" / truncation symptom across P7–P9.1; it is
timing/size-dependent, not correlated with file type. **Fixed** via a
`patch-package` patch (`android/patches/react-native-blob-util+0.24.10.patch`,
applied automatically on `npm install`) adding the missing `sink.write(...)`
call. Verified on RMX3997 across 8 file types and synthetic 64 KB–32 MB
files with byte-for-byte confirmation. Full writeup:
`docs/upstream/react-native-blob-util-okio-read-contract.md`. **Re-check
this patch's continued necessity on any future `react-native-blob-util`
upgrade** — remove it only after re-running the full physical transfer
matrix.

#### P11 — Concurrent download freeze (Android)

`TransferStreamManager`'s one-active-stream design was correct, but a `start()` call arriving while
another stream was active was silently dropped with no retry — tapping
Download on 3+ files left all but one stuck at 0 bytes forever (only
"unstuck" by opening that transfer's own detail screen, whose effect
opportunistically calls `start()` again). Fixed: a real in-memory FIFO
`queue`; either exit path (`finally`, or the early-return for a missing
session) drains and starts the next queued transfer. Verified live
(2/3/5-tap bursts, all completed in order with no gaps).

#### P13 — Folder transfer support (backend/desktop/Android, feature)

Added whole-folder sharing/download/upload on top of the existing
single-file pipeline — no new streaming concept: a folder "transfer" is N
ordinary single-file transfers, serialized by P11's own FIFO queue. New
`shared_folders` table + `SharedFolderService`, `/folders` API mirroring
`/files`, `UploadBatchRegistry` for upload-side folder-name conflicts.
Protocol details: `docs/11_File_Transfer.md` §6,
`docs/13_Database_Design.md` §6a/§7/§12. The required live-device pass
found and fixed 3 defects the (all-green) automated suites couldn't reach:
a `Content-Disposition` header crash on non-Latin-1 filenames (pre-existing
since Milestone 12, affects standalone files too — fixed with an RFC
6266-compliant header builder); `react-native-saf-x`'s `listFiles()`
rejecting its own *unpersisted* `openDocumentTree()` grant on this device
(worked around by always persisting the grant); `react-native-blob-util`'s
`wrap()` reading zero bytes from a `saf-x`-issued URI (worked around by
materializing each picked file to local cache before upload). Verified
live: a real 7-file nested unicode-named folder downloaded byte-for-byte
correct; a 250-file batch upload completed in ~10.5s.

#### P13.1 — Folder Open + notification UX (Android)

Removed progress counters from a folder row; added Open (opens the folder in the device's
file manager) and a folder-specific completion notification. Live testing
surfaced (documented, not fixed — deferred to P13.2 per this milestone's
own scope) that two shared folders with the *same display name* merge
their contents into one physical on-device directory, since nothing
disambiguated a folder's own root segment (only a file's basename, via
P3's fix).

#### P13.2 — Folder identity & change detection (Android)

Fixed both P13.1 gaps: (1) added `folderIdentity.ts`, a `shared_folder_id`-keyed local
registry resolving a free on-device root name once and remembering it
("name (1)" convention, same as P3's file-level fix) — so two
same-named folders now land in separate directories. (2) Folder content
changes (add/remove/rename on the desktop) are now detected: a
`reconciledChildren` snapshot, written by the client at the exact moment a
folder download finishes, is compared against the folder's *current*
children on every poll — an add/remove/rename now correctly flips the row
from Open back to Download. (An initial Transfer-history-based design for
(2) was replaced after live testing showed a **removed** file's orphaned
Transfer row permanently poisoned the check.)

#### P13.3 — Folder state-machine audit (Android)

A full-lifecycle audit (not a symptom fix) found the Files screen recomputed its Download/
Downloading/Open label from 5 independently-polled sources with no
cross-notification, and none of them ever asked the live filesystem. Fixed
4 real bugs found this way: a deleted folder still showed "Open" (no
existence check existed for folders, unlike files); P13.2's own naming fix
had a reservation-vs-materialization race that could still collide under
rapid same-name taps (fixed: the registry, not just the filesystem, is now
authoritative for "already claimed"); a Download→Downloading→Download→Open
flicker (the reconciliation write wasn't notifying the screen to re-read
it — fixed via a `TransferStreamManager` subscription); and a queue-label
bug comparing the wrong id space (`shared_file_id` vs `transfer_id`),
always returning `false` and mislabeling every row.

#### P13.3 correction — Single-transfer "Queued" regression (Android)

The P13.3 queue-label fix (`active = isActive(transferId)`) shipped a
regression: a lone, never-queued download briefly showed "Queued" during
`start()`'s own async startup window (before `isActive()` becomes true),
since "not yet observed active" was wrongly treated as "genuinely queued".
Fixed: added a real `isQueued()` reading FIFO membership directly (no async
gap, since `enqueue()` is only ever reached synchronously).

#### P14.1 — Long-press context menu (Android)

Added a small, dependency-free bottom-sheet (`FileActionMenu.tsx`, built on RN's own `Modal`) offering
Open/Details on long-press of a Files row. Details uses the built-in
`Alert.alert` — no new UI dependency.

#### P14.2 — Discovery → QR pairing shortcut (Android)

Tapping a discovered desktop in the Discovery list now jumps straight into the QR
scanner (previously a dead `View`, no effect), with a best-effort
`(desktop_ip, port)` match check against the scanned QR (the pairing
protocol carries no stronger device-identity field). Added an
instructional overlay, explicit Close button, and a three-way camera
permission state (including "Open Settings" for a permanently-blocked
permission).

#### P14.3 — Configurable download location (Android, feature)

Added a Settings screen to switch between the default `Downloads/Relay` (MediaStore)
and a user-picked SAF folder. `downloadExistence.ts` became the pipeline's
one mode-aware abstraction boundary; default-mode behavior is byte-for-byte
unchanged. Found and fixed a defect during live verification: opening a
custom-location folder failed ("Invalid root Uri") because `saf-x`'s
`stat()` returns a synthesized tree-shaped URI for nested children that
Android's DocumentsUI rejects as a browsable root — fixed by building the
correct tree-scoped document URI directly from the granted tree's own id.

#### P14.4 — Transfer history reset (Android)

Added "Clear History" on the Transfers list — an **Android-local filter only**, never a backend delete
(the backend's `transfers` table is explicitly permanent, shared history
per `docs/13_Database_Design.md` §10, and the desktop's own `GET
/transfers` view is unscoped across all devices). A transfer is historical
once its status leaves `in_progress`; a small local JSON marker
(`clearedAt`) hides anything that finished at or before it. Found and fixed
a defect during physical verification: backend timestamps are naive
(no UTC designator) but JS's `Date` parses a timezone-less ISO string as
*local* time — on this device (UTC+5:30) a transfer that finished after a
reset could be incorrectly hidden. Fixed by forcing UTC interpretation in a
new `parseTimestamp()` helper.

#### P15 — Zombie `in_progress` transfer on a missing source (backend)

A SEND transfer whose source file disappears, is unshared, or changes size
after acceptance raised inside `resolve_download_source` *before*
`_finalize` could ever run, leaving the `Transfer` row `IN_PROGRESS`
forever (and, as a direct consequence, permanently ineligible for P14.4's
own history filter). Fixed: `resolve_download_source` now finalizes the
transfer `FAILED` (reusing the existing, idempotent `_finalize`) before
re-raising the same exception — the client-visible 400/404 response is
unchanged. Result: 340 passed (+1), 2 skipped.

#### P16 — Same-basename download identity collision (Android)

P3 fixed the *write* side of two same-named shared files colliding on-device (they
land at distinct paths); nothing fixed the *read* side — every existence
check and the Open action still asked about the shared, undisambiguated
`file_name`, so two different files' rows could show each other's status,
and tapping Open could open the **wrong file's content**. Fixed by mirroring
P13.2's folder-registry pattern: a new `fileIdentity.ts`
(`shared_file_id`-keyed, "name (1)" disambiguation, resolved once before
streaming starts). This is now a documented standing rule — see
`CLAUDE.md`'s "Android Download Identity (P16)" note: any download-path
code must resolve identity through the appropriate id-keyed registry, never
through `file_name`/`folder_name` directly. Result: 310 tests / 38 suites.

#### P17 — `shared_folder_id` reuse / folder identity collision (Android)

Fixed the gap noted below as open after P16: `shared_folders.id` is a
plain, non-`AUTOINCREMENT` SQLite primary key, so an emptied table
restarts numbering from 1 and a deleted folder's id can be handed to an
unrelated one later. `folderIdentity.ts`'s registry now also records
`shared_at` (set once at share time, untouched by refresh) and treats a
mismatch against the live folder's `shared_at` as a different folder,
never trusting a bare id match. Mirrors the same pattern already proven
for standalone files. See CLAUDE.md's "Backend ID Reuse (P17)" note.
Result: 320 tests / 38 suites, live-reverified on RMX3997.

#### P18 — Stabilization baseline audit

Not a bug-fix milestone — a checkpoint to decide whether V1 is ready to
leave stabilization for a UI/UX finishing phase. Full backend/Android
suites re-run clean; a physical-device smoke test re-verified pairing
persistence, file/folder share+download+Open, duplicate folder names,
external-deletion detection, Android→desktop upload, notifications, and
Clear History. No blocker found. Identified (but did not fix, per this
milestone's explicit scope) two backlog items: `fileIdentity.ts` has the
same class of id-reuse gap P17 just fixed for folders, and `[QR-DEBUG]`
debug logging (P8.1) is still present in `android/src/api/client.ts` (later
removed in P31.1, after it surfaced as a React Native Console Error
overlay). Full detail in `docs/15_QA_NOTEBOOK.md`'s P18 entry.

---

# 6. Current Known Open Items

As of P18, the following are the genuinely unresolved or accepted items —
everything else found during T1–P18 has been fixed and verified. See the
named milestone in `docs/15_QA_NOTEBOOK.md` for full detail on any entry.

- **`fileIdentity.ts` has the same `shared_files.id` reuse gap P17 just
  fixed for `folderIdentity.ts`.** `shared_files.shared_at` is already
  available as the same independent signal; not yet wired in. Reachable
  only via an unshare-to-empty-then-reshare sequence, not normal use —
  technical debt, not a blocker (P18).
- **Packaging is unimplemented** (T8): no PyInstaller/equivalent backend
  bundle, no Electron installer, no signed release APK. See
  `docs/12_Packaging_Deployment.md`.
- **"Share" (`ACTION_SEND`) is not implemented** on Android (P4, P6) —
  would require a new native dependency; deliberately out of scope so far.
- **Byte-identical-size content edits inside a shared folder are
  undetectable** by P13.2's change-detection (no checksum verification —
  explicitly deferred for all of V1, not just folders).
- **Orphaned local files are not cleaned up** when a folder child is
  renamed/removed and later reconciled (P13.2), and folder-upload's
  materialize-to-cache temp files are never deleted (P13) — both accepted
  V1 trade-offs.
- **Local on-device identity/state registries** (`folderIdentity.ts`,
  `fileIdentity.ts`, the download-location marker, the history-reset
  marker) live in app-private storage and do not survive a reinstall; a
  `Transfer` that completed *before* a given fix shipped has no registry
  entry until it is re-downloaded (P13.2, P16).
- **True SAF permission-grant revocation was never exercised live** — this
  device's OEM shell (ColorOS/RealmeUI) blocks the ADB commands
  (`pm revoke`, `pm clear`) that would otherwise force that state (P14.2,
  P14.3). A persisted folder-upload SAF grant is also never explicitly
  released (P13) — an accepted trade-off given Android's per-app grant cap.
- Mixed file+folder concurrent queueing was verified functionally but not
  separately re-run live end-to-end (P13.3) — low-risk, same underlying
  queue for both.

---

# 7. Bug Classification

**Critical** — Data loss, security vulnerability, crash, corrupted
transfer, authentication bypass.

**High** — Major feature unusable, broken pairing, broken transfer,
packaging failure.

**Medium** — Incorrect UI behavior, minor workflow issue, performance issue.

**Low** — Cosmetic issue, documentation issue, logging improvement.

---

# 8. Completion Criteria

Relay Version 1 is considered complete when:

- All validation milestones are complete.
- No Critical defects remain.
- No High defects remain.
- Documentation matches implementation.
- Packaging succeeds.
- End-to-end workflows pass.
- Installation works on a clean machine.

---

# 9. Scope

This phase validates the existing implementation. New features are outside
the scope of this document unless required to resolve verified defects
discovered during testing.
