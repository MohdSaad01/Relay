# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Relay

## Project Overview

Relay is a local-first file transfer application for Windows and Android.

The goal is to allow users to transfer files directly between their Windows computer and Android phone over a local Wi-Fi network or mobile hotspot.

Relay does **not** use cloud storage or internet servers. All communication happens directly between paired devices.

This repository contains Version 1 of Relay.

---

# Current Repository State

Relay's Version 1 is **feature-complete**: the backend, the Electron desktop
app, and the React Native Android app all implement the full pairing →
discovery → share → transfer → stream flow (`git log`: `M14: Implement
Electron desktop application`, `Complete Phase1` (Android client),
`v1-feature-complete`). What remains is packaging/distribution
(`docs/12_Packaging_Deployment.md`) and the enhancements listed under
[Not Yet Implemented](#not-yet-implemented) — see `README.md` for the
project-level overview and setup instructions for all three components.

## Completed Milestones

* **Project specification** — architecture, tech stack, and API/database design finalized in `docs/`.
* **Backend project structure** — FastAPI app scaffold, configuration, logging, and database session setup.
* **M3: Database models** — SQLAlchemy models for `devices`, `sessions` (`DeviceSession`), `shared_files`, `transfers`, and `app_settings`, matching `docs/13_Database_Design.md`.
* **M4: Repository layer** — `app/repositories/`, one repository per model, the only code that queries SQLAlchemy directly.
* **M5: Service layer** — `app/services/`, business logic for devices and app settings, raising FastAPI-agnostic exceptions (`NotFoundError`, `ValidationError`, `ConflictError`).
* **M6: API layer** — `app/api/`, REST endpoints for `Settings` (`GET`/`PATCH /settings`) and `Devices` (`GET /devices`, `GET`/`PATCH`/`DELETE /devices/{id}`), centralized exception-to-HTTP mapping, and the shared `ApiResponse` envelope. See `backend/README.md` for full API layer details.
* **M7: Pairing infrastructure** — `PairingManager` (`app/services/pairing_manager.py`), a lock-guarded, in-memory singleton holding the single active pairing attempt (tokens are never persisted, per `docs/13_Database_Design.md` §9); `PairingService` (`app/services/pairing_service.py`), orchestrating start/submit/approve/reject/collect and delegating persistence to `DeviceService`/`DeviceSessionRepository`/`AppSettingsService`; `app/core/security.py` for token generation and hashing; `DeviceService.register_device`/`is_device_registered`. See `backend/README.md` for full details.
* **M8: Pairing API** — `app/api/v1/pairing.py` exposes `PairingService` (M7) as REST endpoints: `POST /pairing/start`, `GET /pairing/pending/{token}`, `POST /pairing/request`, `POST /pairing/approve`, `POST /pairing/reject`, `GET /pairing/result/{token}`. Desktop-only: start/pending/approve/reject. Android-only: request/result. Request/response schemas added to `app/schemas/pairing.py`; DI wiring (`PairingServiceDep`) added to `app/api/dependencies.py`. Reuses the centralized exception handlers from M6 — no route-level try/except. Still fully unauthenticated. See `backend/README.md` for full details.
* **M9: Authentication infrastructure** — `AuthService` (`app/services/auth_service.py`) validates the bearer `DeviceSession` token (`Authorization: Bearer <token>`) issued by `PairingService.approve_pairing` (M7/M8), per `docs/10_Security.md` §7-9: hashes the presented token, looks it up, rejects a missing/unknown/expired token with a new `AuthenticationError` (mapped to `401` via the M6 exception-handler pattern, generic message in every failure case), and on success updates `last_used_at`/`last_seen_at` without committing — that bookkeeping rides along inside whatever transaction the request's own service commits, so authentication itself never owns a transaction boundary. Exposed as the `get_current_device`/`CurrentDeviceDep` FastAPI dependency (`app/api/dependencies.py`). At the time of M9 it was not yet attached to any router; M10 attached it. See `backend/README.md` for full details.
* **M10: Shared file management** — `SharedFileService` (`app/services/shared_file_service.py`) implements the desktop's shared-file list (`docs/13_Database_Design.md` §6): share/list/refresh/unshare, backed by pure filesystem helpers (`app/utils/filesystem.py`) that validate a path (absolute, exists, regular file, not a symlink) and stat its metadata — content is never opened or read at this stage. Exposed via `app/api/v1/shared_files.py` (`POST/GET /files`, `GET/POST(refresh)/DELETE /files/{id}`). `GET /files` is the first — and at the time, only — dual-audience route: it introduced `get_requesting_device`/`RequestingDeviceDep` (`app/api/dependencies.py`), which returns `None` for the trusted loopback desktop caller and otherwise requires the M9 `get_current_device` session check, giving Android a sanitized view (`AvailableFileResponse`, no `file_path`) while the desktop gets the full one. Every other route in this router is desktop-only and unauthenticated, matching `/devices`/`/settings`. See `backend/README.md` for full details.
* **M11: Transfer API & orchestration** — `TransferService` (`app/services/transfer_service.py`) implements the two-phase transfer lifecycle from `docs/11_File_Transfer.md` §7: a paired Android device proposes a transfer (download of a shared file, or a proposed upload), the desktop accepts or rejects it, and only an accepted proposal becomes a persisted `Transfer` row. Pending proposals are runtime-only state — mirroring the M7 pairing-token pattern — held by `TransferManager` (`app/services/transfer_manager.py`), a lock-guarded in-memory store keyed by request id (unlike pairing's single active attempt, this supports many concurrent pending requests). Exposed via `app/api/v1/transfers.py` under `/transfers/requests` (propose/list/withdraw/accept/reject) and `/transfers` (list/get/cancel). This milestone does not move bytes: the only DB-level status transition it performs is `in_progress -> cancelled`. See `backend/README.md` for full details.
* **M12: Streaming Engine** — `TransferStreamService` (`app/services/transfer_stream_service.py`) moves the actual bytes of an already-`in_progress` transfer (`docs/11_File_Transfer.md` §8), deliberately kept separate from M11's `TransferService`, which owns the lifecycle and is unchanged by this milestone. Downloads (`GET /transfers/{id}/download`, SEND) stream a shared file from disk via `StreamingResponse` with an explicit `Content-Length`, in chunks sized by the new `Settings.STREAM_CHUNK_SIZE_BYTES` (default 1 MiB). Uploads (`POST /transfers/{id}/upload`, RECEIVE) are the codebase's one `async def` route, since consuming the raw ASGI request body requires `await`; bytes are written to a temp file in `app_settings.download_directory` and atomically renamed into place only once the declared `file_size` is fully received. A filename conflict on upload is resolved automatically (`name (1).ext`, `name (2).ext`, ... — `app/utils/filesystem.resolve_available_path`), and the resulting saved name is written back onto `Transfer.file_name`, a deliberate, narrow exception to that column's immutability documented in `docs/13_Database_Design.md` §7. Cancellation of an active stream is cooperative (periodic status re-check, not preemptive), and a new `ActiveStreamRegistry` (`app/services/active_stream_registry.py`, same in-memory singleton pattern as `PairingManager`/`TransferManager`) rejects a second concurrent stream on the same transfer. Both streaming routes require `CurrentDeviceDep` outright (Android-only, no desktop/loopback exemption). Out of scope, per this milestone's explicit boundaries: resume/`Range` support, checksums, compression, encryption, WebSockets. See `backend/README.md` for full details.
* **M13: Device Discovery** — `DiscoveryService` (`app/services/discovery_service.py`) lets Android find the desktop automatically, per `docs/09_Networking.md` §4. Version 1 uses UDP broadcast (not mDNS/Zeroconf) — a credential-free `DiscoveryAnnouncePayload` is broadcast periodically to the LAN broadcast address on `Settings.DISCOVERY_PORT`. Unlike every other service in the codebase, it is not request-scoped: it starts/stops once with the app's `lifespan` and runs its own daemon thread. Exposed read-only via `GET /discovery/status` (`app/api/v1/discovery.py`); toggling it remains `PATCH /settings` (`app_settings.discovery_enabled`). See `backend/README.md` for full details.
* **M14: Electron Desktop Application** — `desktop/` is the Electron shell that makes the backend a real desktop app instead of a bare `uvicorn` process. The main process (`desktop/src/main/backend-manager.js`) starts and stops the FastAPI backend as a child process alongside the Electron app's own lifecycle, adds a system tray (`tray.js`, `scripts/generate_tray_icon.js`), and exposes backend access to the renderer through a preload bridge (`src/preload/preload.js`) and IPC handlers (`src/main/ipc-handlers.js`). The renderer (`src/renderer/`) is plain HTML/CSS/JS (no framework, per the finalized tech stack) with one view module per resource — `devices.js`, `files.js`, `pairing.js`, `settings.js`, `transfers.js` — talking to the backend through `src/renderer/api/client.js`. No backend business logic lives in this layer; it is strictly a host and a UI.
* **Android Client ("Complete Phase1")** — `android/` is the React Native (TypeScript) app that pairs with the desktop and drives transfers from the phone side, organized to mirror the backend's own domains: `src/discovery/` (listens for the M13 UDP broadcast), `src/pairing/` (QR scan, submit/poll the M7/M8 handshake), `src/session/` (stores the device secret/session token via `react-native-keychain`), `src/files/` (lists shared files), `src/transfers/` and `src/streaming/` (propose/accept-driven transfer requests and the actual upload/download byte streams, including a foreground service for long-running transfers), with `src/screens/` and `src/navigation/` wiring it into a tab/stack UI (`@react-navigation`). Ships with a Jest test suite (`android/__tests__/`) mirroring `src/`. A follow-up commit (`fix(android): close TransferStreamManager start() race condition`) hardened a startup race in `src/streaming/TransferStreamManager.ts` alongside matching backend fixes.
* **v1-feature-complete** — final hardening pass tagged as the close of Version 1's feature work: additional config/service edge-case tests (`backend/tests/core/test_config.py` and others), small fixes to `PairingManager`, `TransferService`, and `TransferStreamService`, and a full rewrite of `docs/14_Testing_Plan.md` to match the finished feature set. No new endpoints or resources were added in this pass.

## Current Architecture

The backend follows the layered design in `docs/02_Architecture.md`:

```
API Layer → Service Layer → Repository Layer → SQLAlchemy Models
```

Implemented resources: `Devices`, `AppSettings`, `Pairing`, `Discovery`,
`Shared Files`, `Transfers` (including byte streaming). `Devices`,
`Settings`, `Pairing`, and `Discovery` remain fully unauthenticated — the
desktop's own Electron UI always calls them over loopback. `Shared Files`
and `Transfers` enforce the M9 `DeviceSession` bearer-token check
(`AuthService`, `get_current_device`/`CurrentDeviceDep`,
`get_requesting_device`/`RequestingDeviceDep` in
`app/api/dependencies.py`) for any non-loopback caller — `GET /files` and
the dual-audience `/transfers` routes accept the trusted desktop caller or
a session token; the Android-only proposal and byte-streaming routes
(`POST /transfers/requests`, `DELETE /transfers/requests/{id}`,
`GET /transfers/{id}/download`, `POST /transfers/{id}/upload`) require a
session token outright.

The backend runs embedded inside the M14 Electron desktop app
(`desktop/`), which starts/stops it automatically and provides the desktop
UI. The Android client (`android/`, React Native/TypeScript) discovers the
desktop via M13's UDP broadcast, pairs with it, and drives the transfer
flow from the phone side. See `README.md` for the full three-component
overview and per-component setup instructions.

### Android Download Identity (P16)

Android's own download-existence/status/Open logic must key on a stable
backend identifier (`shared_file_id` for a standalone file,
`shared_folder_id` for a folder — see `android/src/files/fileIdentity.ts`
and `folderIdentity.ts`), never on a shared file/folder's raw display
name alone. Two different shared items can legitimately carry the same
display name; deriving on-device identity from that name (rather than from
the id) lets one item's download/deletion silently affect the other's
Download/Open state — the defect fixed in P16 for standalone files (P13.2
had already established the same rule for folders). Any new download-path
code (existence checks, Open, notifications, reconciliation) must resolve
through the appropriate id-keyed registry, not `file_name`/`folder_name`
directly.

### Backend ID Reuse (P17)

A backend integer primary key (`shared_folders.id`, `shared_files.id`, and
any other plain SQLite `INTEGER PRIMARY KEY` without `AUTOINCREMENT`) is
**not** durable external identity — it is only guaranteed unique while its
row exists. Once every row in a table is deleted, SQLite restarts
numbering from 1, so a deleted folder/file's id can be handed to an
entirely unrelated one later (confirmed live: P17). This mirrors
`docs/13_Database_Design.md`'s existing `devices.device_identifier`
precedent — the primary key is an internal implementation detail, not a
stable identity contract — and is not something Version 1 should "fix" at
the database layer (no `AUTOINCREMENT`, no UUID column) without a proven
need; the reuse itself is normal SQLite behavior, not a defect.

Any Android-local state keyed by one of these ids and expected to survive
across the id's reuse (`folderIdentity.ts`'s on-device registry is the
current example) must validate the id against an independent signal the
backend already provides — `shared_at` for `shared_folders`, set once at
row creation and left untouched by an in-place refresh — before trusting a
cached entry. Do not derive that signal from a display name
(`folder_name`/`file_name`); two different logical items can legitimately
share one, which is exactly the ambiguity P13.2/P13.3/P16 already had to
solve for the *display* layer and must not be reintroduced here.

### Desktop UI Foundation (P19)

`desktop/src/renderer/dom.js` now exports two shared markup helpers,
`pageHeader({ title, subtitle, actions })` and `emptyState({ title,
message, actionHtml })`, and `desktop/styles/app.css` defines a small
design-token set (`--color-*`, `--space-*`, `--radius-*`) plus
`.card`/`.badge`/`.button-row`/button-variant (`primary`/`danger`) classes.
Every view in `desktop/src/renderer/views/` uses these instead of each
hand-rolling its own `<h2>`/placeholder markup or one-off inline styles —
new Desktop views and states should do the same rather than reintroducing
the pre-P19 pattern of duplicated per-view heading/empty-state HTML.

`renderer.js`'s startup tab is no longer hardcoded to `"devices"`: it
calls `GET /devices` once before the first `showView()` and opens Pairing
when nothing is paired, Devices otherwise (falling back to Devices on any
lookup failure). This only affects which tab is shown on launch — the
`showView()` function driving both this and every nav click handler is
unchanged, so manual navigation is unaffected.

### Desktop Status/Result Cards (P20)

`desktop/src/renderer/dom.js` also exports `iconBadge({ icon, variant })`
— a small tinted-circle badge wrapping an inline SVG, variants
`primary`/`success`/`danger`/`neutral` matching the existing badge/button
color language — and `desktop/src/renderer/icons.js` holds the hand-written
inline SVGs it's given (no icon-font or icon-library dependency, per the
finalized plain HTML/CSS/JS desktop stack). Introduced for the Pairing
view's status cards (idle/waiting/review/success/rejected/expired), each of
which leads with an `iconBadge` instead of a bare heading. Any new Desktop
state that represents a single outcome or a "here's what's happening now"
step — not a list/table view like Devices or Shared Files — should use
this pattern rather than inventing its own icon or going headerless.
`app.css` also gained `button.text-button` (a borderless low-emphasis
button variant, for an action like "Cancel" that sits next to a primary
action with nothing else competing for attention) and `.pairing-flow` (a
two-column layout, QR-generation kind of card next to a short numbered
instruction list, single-column below 720px) — reusable if another Desktop
flow needs the same "one interactive card, one explanatory card"
side-by-side shape.

### Desktop Files/Transfers Conventions (P21)

**A backend action with no delete/undo primitive by design (`Transfer` rows
are permanent history — `docs/13_Database_Design.md` §7/§10,
`TransferRepository` has no delete method) must not grow one just to make a
"clear"/"remove" UI feature easier.** Instead, filter what's displayed via a
client-local marker, exactly as `android/src/transfers/historyReset.ts`
already does for Android's own Clear History. Desktop's
`desktop/src/renderer/transferHistory.js` (Transfers "Clear History") and
`desktop/src/renderer/receivedFiles.js` (removing a received item from
Shared Files after Delete) both apply this same pattern via `localStorage`
instead of Android's JSON marker file. Any future "hide history"/"remove
entry" feature over data the backend deliberately never deletes should
follow the same shape rather than adding a backend delete route.

**P28: Shared Files' own "Clear History" (Desktop) and Files' own "Clear
History" (Android) reuse the exact same marker as each platform's
Transfers "Clear History"** (`transferHistory.js`'s `historyClearedAt` on
Desktop, `historyReset.ts`'s marker file on Android) rather than a second
history concept — a received item in Shared Files, or a downloaded row in
Android's Files list, *is* transfer history, filtered by the identical
cutoff (`applyHistoryReset` / `isHiddenByHistoryReset`). Clearing history
from either screen on a platform therefore hides the same history-derived
entries everywhere they're shown on that platform. A currently-*shared*
Desktop source file/folder (not a received one) is structurally exempt —
it comes straight from `GET /files`/`GET /folders` and never passes
through this filter.

A **received file/folder** (an Android upload the desktop accepted) has no
`SharedFile`/`SharedFolder` row — `TransferStreamService.receive_upload`
only ever writes bytes and updates the `Transfer` row. Where a view needs
to present one as if it were shared (Shared Files, P21 §8), derive it from
`GET /transfers` (`direction === 'receive' && status === 'completed'`,
grouped into a folder item via `transferGrouping.js`'s shared
`groupTransfersByBatch`) rather than inventing a backend row for it. Only
`completed` transfers qualify — an in-progress/queued/failed one stays
Transfers-only state, never Files state.

`desktop/src/renderer/dom.js`'s `formatFileType(fileName)` (extension,
e.g. `.pdf`, not a raw MIME type) and a folder's `Folder (N items)` Type
cell are the standard file-type presentation for any new Desktop file/
folder list — do not reintroduce a raw `mime_type`/bare item-count display.
A table row's Source (`Shared`/`Received`, via the existing `.badge`
component) should be stated explicitly rather than left for the user to
infer from which action buttons are present.

`app.css`'s `.row-actions` (tight-gap, right-aligned, wraps gracefully) is
the standard wrapper for a table cell holding more than one or two action
buttons — use it instead of bare inline buttons when a row's action set
grows past what fits one line at the app's default window width.

### Android Folder Transfer Presentation (P21.1)

A folder download/upload remains, internally, N ordinary child `Transfer`
rows streamed one at a time through `TransferStreamManager`'s existing FIFO
(`docs/11_File_Transfer.md` §10) — Android does not, and should not, grow a
second streaming engine or a folder-level backend `Transfer` type. UI code
must instead *present* those child transfers as one user-level operation:

- Android's `files/folderDownloadStatus.ts` (`deriveFolderDownloadStatus`)
  already derives a folder's aggregate download state from its children.
  `screens/files/FilesScreen.tsx`'s `computeFolderRowState` additionally
  breaks the tie between "every child just finished, reconciliation is
  still catching up" and "genuinely stale/never downloaded" using
  `TransferStreamManager`'s own live state (P21.1) — any future change to
  folder-status derivation must preserve this, or the Download/Downloading
  flicker P21.1 fixed will return.
- Any per-child transition inside `TransferStreamManager`'s FIFO — not just
  the very first child's own startup — passes through a real async gap
  (`start()`'s `await PermissionsAndroid.request(...)`) during which
  `isActive()` is false for every transfer while the rest of the folder is
  still genuinely `isQueued()`. A large folder (P21.2: confirmed live at
  100 files) exposes this at every single child boundary, not just once —
  `computeFolderRowState`'s `queued` derivation must keep treating a folder
  as "underway" (never `Queued`) from its first completed/active child
  onward, or the Downloading/Queued oscillation P21.2 fixed will return.
  Any new folder-level (or other multi-child aggregate) UI state derived
  from `TransferStreamManager` must account for this same gap.
- Android's Transfers tab (`screens/transfers/TransferListScreen.tsx`)
  groups a folder's child transfers into one row via
  `transfers/transferGrouping.ts`'s `groupTransfers` — a download groups by
  `shared_folder_id`, an upload by `upload_batch_id` (a download has no
  `upload_batch_id`; see that module's own doc comment). New Transfers-list
  UI must render through this grouping, not the raw `GET /transfers` array,
  or a folder will again show as N separate rows. Mirrors Desktop's own
  `transferGrouping.js`/`renderBatchRow` precedent (P21) for the same
  underlying data.

### Android Files Screen File-Action Conventions (P22)

The Android Files screen's long-press action menu (`FileActionMenu.tsx`,
P14.1) is state-dependent, not a fixed list: `FilesScreen.tsx` derives a
different action set per row depending on `computeFileRowState`/
`computeFolderRowState`'s current status, always read live (never a
snapshot taken when the menu opened) — see those functions' own doc
comments. A `completed` row offers Open/Share (file only)/Delete/Details;
any other state (idle/pending/in_progress/failed) offers Remove/Details.
Any new file-row action must fit this same per-state shape rather than
being unconditionally offered.

**"Remove" is not one operation** — it means whatever is correct for the
row's current backend state, decided inside `handleRemoveFile`/
`handleRemoveFolder`, not by the menu construction itself:
- idle/failed (nothing backend-side to act on): dismisses the row from this
  screen via `removedItems.ts`'s local marker. This is *not* an unshare —
  the item stays shared on the desktop and reappears if the same
  `shared_file_id`/`shared_folder_id` is legitimately reused by a later
  share (the dismissal is gated on the item's `shared_at`, per the P17
  precedent below).
- pending/in_progress (a genuinely operational download): cancels it, using
  the identical active-vs-queued branch `TransferProgressDetail.handleCancel`
  already uses for the Transfers tab's own per-transfer Cancel action
  (`TransferStreamManager.isActive`/`cancelActive()` vs. a plain
  `cancelTransfer()` call). Any future "cancel this download" affordance
  should reuse this same branch rather than re-deriving it.

**New id-keyed local state must apply the P17 `shared_at` guard**, even
where an older registry in this codebase (`fileIdentity.ts`) predates that
convention and was left as an accepted gap. `removedItems.ts` is the
current reference: it stores the dismissed item's `shared_at` alongside the
dismissal and only honors it while the live item's own `shared_at` still
matches, so a reused `shared_file_id`/`shared_folder_id` never inherits a
dismissal that belonged to a different, already-gone logical item.

**"Delete" (downloaded content only) is always local-only and
direction-blind on this screen** — Android's Files screen only ever lists
items it can download (desktop → Android), so unlike Desktop's own Delete
(P21, which has to distinguish a sent vs. received item), there is no
"which direction" question here: Delete always means "remove my local
downloaded copy," never touches the desktop's `SharedFile`/`SharedFolder`
row, and always confirms via `Alert.alert` first (it discards actual
bytes, unlike Remove).

**A file's meta line never shows a raw MIME type** — `metadataFormat.ts`'s
`fileMetaLine`/`folderMetaLine` are the shared source for this (row
rendering, the long-press menu's subtitle, and the file Details alert all
read from the same two functions rather than each re-deriving the string).
A file's own name/extension already conveys its type to a normal user;
repeating the MIME type is redundant. A folder's line leads with an
explicit `Folder ·` label instead, since a folder's name carries no such
information.

**Real Android `ACTION_SEND` sharing requires `react-native-share`** — RN's
own `Share` module drops its `url` field on Android, and
`react-native-blob-util` (already a dependency, used for `ACTION_VIEW`
"Open") only exposes `actionViewIntent`, never `ACTION_SEND`. Its own
`RNSharePathUtil.compatUriFromFile` mishandles an already-`content://` URL
(used only when the download location is a custom SAF folder, P14.3) — a
confirmed library limitation; `downloadActions.ts`'s `shareDownloadedFile`
detects this and rejects with a plain message instead of invoking a broken
share.

### Android Settings, Navigation & App Identity (P23)

**Android Settings is a small, user-facing screen, not an administrative
configuration panel.** `screens/settings/SettingsScreen.tsx` exposes
exactly two sections — `DEVICE` (display name) and `STORAGE` (download
folder, P14.3, unchanged) — matching the sectioned-card pattern already
used for the download-folder card. Session token lifetime, backend/session
configuration, and other internal/developer settings must not be added
here; that boundary was explicit in the P23 source requirements.

**A device's display name is editable, independent of its identifier.**
`pairing/deviceIdentifier.ts`'s `device_identifier` (a UUID, generated once
at pairing) is permanent internal identity and must never change.
`session/types.ts`'s `Session.device_name` is the human-readable label
shown on the desktop's Devices list — editable from Settings via
`api/endpoints/devices.ts`'s `renameDevice` (`PATCH /devices/{id}`),
committed locally only after the backend call succeeds
(`SessionManager.updateDeviceName`). A session persisted before this field
existed falls back to `pairing/deviceName.ts`'s `getDefaultDeviceName()`
rather than rendering blank — any future field added to `Session` should
consider the same backward-compatibility gap for an already-paired
install.

**`PATCH /devices/{id}` is the one `/devices` route with real auth**, added
because P23 made it the first route on that router a non-loopback (Android)
caller genuinely calls. `verify_device_owner`
(`backend/app/api/dependencies.py`) allows the trusted loopback desktop
caller to rename any device, as before, but requires any other caller to
present a session token belonging to that exact `device_id` — a device may
rename only itself. `GET /devices`, `GET /devices/{id}`, and
`DELETE /devices/{id}` are unchanged and still unauthenticated; do not
assume this pattern extends to them without the same explicit
loopback-vs-Android-caller analysis (`backend/README.md`'s "Devices API"
section has the full reasoning).

**Bottom-navigation icons are hand-drawn `react-native-svg`, not an
icon-font/library.** `components/icons.tsx` mirrors Desktop's own
inline-SVG icon language (`desktop/src/renderer/icons.js`: stroke-based,
`currentColor`-equivalent, round caps/joins) rather than pulling in
`react-native-vector-icons`/`@expo/vector-icons` for three icons.
`react-native-svg` itself was added as a rendering primitive (no bundled
icon set) — reuse it for any future Android icon rather than adding a
second icon mechanism. `navigation/MainTabs.tsx`'s `ACTIVE_TINT`/
`INACTIVE_TINT` match Desktop's `--color-primary`/`--color-text-muted`
tokens (`desktop/styles/app.css`) — keep any new brand-colored Android UI
consistent with those same values rather than picking a new blue.

**The Android app icon (`android/app/src/main/res/mipmap-anydpi-v26/`,
`drawable/ic_launcher_foreground.xml`, legacy per-density PNGs) uses the
same two-opposing-arrows glyph as the Transfers nav icon**, on the shared
Relay-blue background (`@color/ic_launcher_background`, `#2D6CDF`, matching
Desktop's `--color-primary`). Desktop now has a matching icon (P25,
`desktop/assets/icons/icon.ico`/`tray.png`) rendering the identical arrow
geometry on the same background — reuse this same glyph/color for any
future Relay icon surface rather than inventing a new mark.

### Android Discovery & QR Pairing UX (P24)

**A discovered-but-unpaired item on Android is a tappable card, not a bare
list row** — `screens/discovery/DiscoveryScreen.tsx`'s discovered-device
row pairs an icon badge (`components/icons.tsx`'s `DesktopIcon`, tinted
circle, same stroke-icon language as the P23 tab icons) with a
`#f5f5f5`/`borderRadius: 12` card, mirroring the card convention
`SettingsScreen.tsx` already established (P23) rather than a new one. Any
future Android list of selectable-but-not-yet-connected items should follow
this same icon-badge-plus-card shape instead of a flat bordered row.

**Tapping a discovered device and the dedicated "Scan QR to Pair" button
must always resolve to the exact same `QrScanScreen` instance/behavior** —
never a second scanner or a duplicated pairing implementation. A tapped
device is only ever passed through as an optional route param
(`QrScan`'s `device`), used solely for `qrPayload.ts`'s
`matchesSelectedDesktop` best-effort mismatch check; it must never branch
into different scanning/pairing code. This was already established by
`9c84f4d`/P14.2 and confirmed unchanged in P24 — preserve it in any future
pairing-entry-point work.

**Discovery structurally cannot show an "already paired" row** —
`RootNavigator.tsx` swaps the entire root stack to `MainTabs` the instant
pairing succeeds, so `DiscoveryScreen` never renders while a session
exists. Do not add paired-state handling to the discovered-device row; the
correct fix for any future "why doesn't this distinguish paired devices"
question is this structural fact, not new UI.

### Desktop Settings & Application Chrome (P25)

**Session token lifetime is internal-only.** `app_settings.session_token_lifetime_minutes`
still exists on the backend — `PairingService.approve_pairing` genuinely
computes `DeviceSession` expiry from it — but the desktop Settings UI
(`desktop/src/renderer/views/settings.js`) no longer exposes it. `PATCH
/settings` is a partial-update endpoint, so the field is simply omitted
from the request body rather than sent with a fixed/dummy value. Do not
re-add a user-facing control for this, and do not remove the backend
field/mechanism — only the UI was in scope.

**A stale local `app_settings.download_directory` is dev-database state,
not a code defect.** `AppSettingsService.get_settings()` already resolves a
correct first-run default (`Path.home() / "Downloads"`), and
`TransferStreamService` already reads `download_directory` fresh from
settings on every upload — there is no second/cached/hard-coded path
anywhere in the receive flow. If a future session sees an internal-looking
path in Settings, check the local `backend/relay.db` (gitignored, dev-only)
for a leftover value written by a previous manual `PATCH /settings` test
before assuming the default-resolution or receive-path code is broken.

**The desktop app has no `Menu.setApplicationMenu(...)` at all** —
`desktop/src/main/main.js`'s `startup()` calls
`Menu.setApplicationMenu(null)`, removing Electron's stock File/Edit/View/
Window bar outright. Confirmed nothing in `desktop/src/` registers a menu
role or relies on a menu-provided accelerator (the tray's own context menu,
`tray.js`, is unrelated and unaffected). Do not reintroduce a visible
top-level menu bar without first confirming new functionality actually
needs one — prefer wiring it through the existing UI (nav, dialogs) first.

**The Desktop app icon
(`desktop/assets/icons/icon.ico`/`tray.png`) renders the same
two-opposing-arrows glyph as Android's launcher icon on the same
`#2D6CDF` background**, wired into `main.js`'s `BrowserWindow` `icon` (the
`.ico`, for crisper Windows title-bar/taskbar rendering) and `tray.js`'s
`Tray` (the `.png`, resized at runtime). There is still no
`electron-builder`/packaging config in `desktop/package.json` — a packaged
installer/executable icon remains open for the Packaging & Deployment
milestone, which should point that config at `icon.ico` rather than
regenerating a new asset.

### Android Upload Selection & Confirmation (P26)

**Picking a file/folder to upload (Android → desktop) never proposes a
transfer by itself — it only stashes the pick and shows
`android/src/components/UploadConfirmSheet.tsx`, a bottom-sheet `Modal`
matching `FileActionMenu.tsx`'s (P14.1) existing convention.** Nothing is
sent to the backend until the user taps that sheet's own explicit action
("Upload this file"/"Upload these files"/"Upload folder" — the exact
wording `New_Issues.txt` §7 asked for); Cancel discards the pick with zero
backend calls. This exists because neither native picker's own confirm
action can be relabeled to say "upload" — a single-file tap has no
persistent button at all, and the folder picker's "USE THIS FOLDER" is
Android system chrome. Any future upload-entry-point work (a new picker,
a new upload button) should route through this same pick → confirm →
`runFileUploads`/`runFolderUpload` shape in
`android/src/screens/transfers/TransferListScreen.tsx` rather than
proposing a transfer straight out of a picker callback.

**Folder-upload identity is already fully preserved end-to-end — do not
"fix" this again without live proof it's actually broken.** P26
re-verified (nested folders, Unicode names, a zero-byte file, an empty
folder) that `android/src/streaming/folderPicker.ts`'s enumerated
`folder_relative_path`s, combined with
`backend/app/services/upload_batch_registry.py`'s per-batch root-name
resolution and `TransferStreamService._resolve_upload_final_path`'s
`os.makedirs` reconstruction, already recreate the picked folder's exact
structure on the desktop, grouped back into one row by
`transferGrouping.js`/`receivedFiles.js` (P21). `New_Issues.txt` §6's
"folder gets flattened" description predates P13/P21 and does not
reproduce against the current codebase.

### Desktop Navigation, Devices & Empty-State Conventions (P27)

**Desktop nav's open-row/underline treatment (§1.5 of the original issue
list), first-launch routing (Pairing when unpaired, Devices when paired),
and the device card's "Paired"-only status language were already correct
going into P27 — all three date to P19 and were re-verified live, not
reimplemented.** Before assuming a Desktop UX issue from an older issue
list still applies, check `git log` on the relevant file and launch the
real app first; P19–P21 already closed several of these.

**`emptyState()` (`desktop/src/renderer/dom.js`) takes an optional
`icon`/`variant`, rendering a leading `iconBadge()` exactly like Pairing's
status cards (P20) instead of a bare heading+message.** Devices/Files/
Transfers all pass one now (`deviceIcon`/`folderIcon`/`transferIcon`,
`desktop/src/renderer/icons.js`). Any new Desktop empty state should pass
an icon through this same param rather than hand-rolling a heading-only
card. `folderIcon`/`transferIcon` intentionally reuse the exact glyph
geometry of Android's `FolderIcon`/`TransferIcon`
(`android/src/components/icons.tsx`, P23) per P25's existing
cross-platform icon-reuse convention.

**`iconBadge({ size: "sm" })` is a smaller, non-centered variant for an
icon that sits inline in a row (e.g. a device card's title) instead of
leading a centered status card.** The paired-device card
(`desktop/src/renderer/views/devices.js`) uses this via a new
`.device-card-main` wrapper (icon + info block). Reuse this pattern for
any future Desktop card that needs a small inline identity icon rather
than inventing a differently-sized badge.

**A sparse Desktop view (one device, an empty list) with a lot of
whitespace below a single centered card is not automatically a defect.**
P27 investigated this explicitly and concluded the existing single-card,
generous-whitespace layout (established by Pairing's idle state, P20) is
Relay's intentional "one focused state" language, not something to patch
by inflating card size or adding decorative content — do not "fix" this
again without a concrete design reason beyond the visual density itself.

### Desktop Rename Input & Stale-Delete Safety (P29)

**`window.prompt()` is unimplemented in this Electron build and always
throws (`"prompt() is not supported."`), confirmed live** — unlike
`window.confirm()`, which does work and remains the mechanism for
Remove/Unshare/Delete confirmations elsewhere in `desktop/src/renderer/`.
Any future Desktop UI that needs free-text input from the user cannot use
a native prompt; `desktop/src/renderer/views/devices.js`'s Rename (an
inline `<form>` swapped into the device card in place of the name/actions
row, submitted via Save/Enter, dismissed via Cancel/Escape) is the current
pattern to extend rather than reaching for `window.prompt()` again. Note
also: the `hidden` attribute/property must not be used for that swap — any
element whose class already declares `display` in `app.css` (e.g.
`.device-card-actions`, `.device-card-title`) wins the cascade over the
`[hidden]` user-agent rule regardless of selector specificity, so `hidden`
silently fails to hide it. **P29's original fix for this — setting
`element.style.display` directly — was itself wrong and is superseded by
P29.1 below; do not reintroduce it.**

**`ipcMain.handle("shell:deleteItem", ...)` (`desktop/src/main/ipc-handlers.js`)
treats an already-missing target path as a no-op success instead of
propagating `shell.trashItem`'s "Failed to parse path" failure.** This is
what lets Shared Files' Delete action complete (and therefore unshare/
remove the entry) on a source file/folder that was deleted outside Relay,
without a new existence-check call site in the renderer. This does **not**
change the separate, pre-existing, deliberate policy in
`SharedFileService.refresh_metadata`/`SharedFolderService.refresh_folder`
that a missing source is never auto-unshared on Refresh — a stale Shared
Files entry still only disappears when the user explicitly acts on it
(Delete), not automatically on every list load. Any future filesystem-
deleting IPC handler should apply the same already-gone-is-not-an-error
treatment rather than assuming its target still exists.

### Desktop Rename Edit-State Lifecycle & the Renderer's CSP (P29.1)

**`desktop/src/renderer/index.html`'s CSP (`style-src 'self'`, no
`unsafe-inline`) silently blocks all inline `style` application — the
HTML `style=""` attribute *and* JS `element.style.property = value`
mutations alike — without throwing a JS error.** The `style` attribute's
*text* still updates when JS writes to it (so `outerHTML`/`getAttribute`
read back exactly what the code intended), but Chromium never uses that
value when computing the actual rendered style; only same-origin
stylesheet rules (`desktop/styles/app.css`, loaded via `<link>`) are
exempt. This made P29's Rename fix (`element.style.display` mutations,
see above) render the edit form permanently visible regardless of state —
confirmed live via `getComputedStyle` polling and via an isolated
`width:50%` test on a standalone element (computed width stayed at the
parent's full 100px). **Any future Desktop renderer code that needs to
change an element's visual style at runtime must use a CSS class toggle
(`classList.add`/`remove` plus a rule in `app.css`) — never
`element.style.property =` or an inline `style=""` attribute.**
`desktop/src/renderer/views/devices.js`'s `.device-card.is-renaming`
class (toggled by `showRenameForm`/`hideRenameForm`) is the current
pattern to extend. Desktop device rename is transient renderer state and
must default to non-editing on every mount/remount; edit mode is entered
only through the explicit Rename click, matching this same class-toggle
mechanism.

**`desktop/src/renderer/views/transfers.js`'s progress bar
(`style="width:${progress}%"` on `.progress-fill`) has the identical bug
and remains unfixed** — discovered as a byproduct of root-causing P29.1
but out of scope for it (Transfers was excluded from that milestone's
boundary). It currently always renders at full width regardless of actual
transfer progress. Fix with the same class-toggle-or-stylesheet-variable
approach when Transfers is next in scope; do not reach for
`element.style.width =` there either.

### Application-Wide Dialog Convention (P30)

**Every Desktop confirmation dialog goes through
`desktop/src/renderer/dialog.js`'s `confirmDialog({ title, message,
confirmLabel, cancelLabel, destructive })` — never `window.confirm()`
(and never `window.prompt()`, which P29 already established Electron
doesn't implement).** It returns `Promise<boolean>` (resolves `false` on
Cancel, Escape, or a backdrop click, matching `window.confirm()`'s own
cancel semantics) and renders using `app.css`'s existing `.card`/button/
badge tokens, appended to `document.body` so it survives `renderer.js`'s
per-view `#view-container` wipes. `destructive: true` renders the confirm
button in the danger/red style — reserve it for an action that actually
destroys or permanently discards something (Unpair, Delete, Clear
History), not merely a reversible state change (Unshare, which keeps the
item on disk and re-shareable, stays primary/blue). Give the confirm
button an explicit label (`"Delete"`, `"Unpair"`, `"Clear History"`, ...),
never a bare `"OK"`.

**Every Android confirmation/alert/info dialog goes through
`android/src/components/AppDialog.tsx`'s `AppDialog` + `useAppDialog()` —
never `Alert.alert()`.** `useAppDialog()` gives a screen `dialog.show({
title, message, buttons })` (a `buttons` array shaped like
`Alert.alert`'s own, each with an optional `style: 'cancel' |
'destructive' | 'default'`) and a `dialog.props` spread onto one
`<AppDialog {...dialog.props} />` rendered near the bottom of the
screen's JSX, exactly where `FileActionMenu`/`UploadConfirmSheet` already
render. A `useCallback` that calls `dialog.show` must list the whole
`dialog` object in its dependency array (not `dialog.show` alone) —
`react-hooks/exhaustive-deps` flags the narrower form, since
`useAppDialog()` returns a fresh object every render (see
`docs/15_QA_NOTEBOOK.md`'s P30 entry for why).

Both primitives were deliberately kept separate per-platform (P30 §5) —
Desktop is DOM/CSS, Android is React Native's `Modal`, and each already
had its own established visual language (P19/P20 Desktop tokens, P14.1/
P26 Android `Modal` conventions) to extend rather than a reason to force
a shared cross-platform component. Neither platform's native OS-owned
prompts (Desktop's pre-window fatal-startup `dialog.showMessageBoxSync`,
both platforms' native file/folder pickers, Android's camera-permission
system prompt) should be replaced — only dialogs Relay's own UI renders.
Rename (inline-edit on both platforms, P29/P23) is not a confirmation
prompt and does not go through either dialog primitive.

### Android API Client Error Logging (P31.1)

**`android/src/api/client.ts`'s single fetch-catch block converts every
network failure — connection refused, DNS failure, and the client's own
internal `REQUEST_TIMEOUT_MS` `AbortController` firing (surfaced as
`AbortError`) alike — into the same friendly `ApiError`
(`UNREACHABLE_MESSAGE`), which every caller already displays correctly.**
None of these are ever logged via `console.error`/`console.warn`: React
Native's `LogBox` intercepts both in a debug build and renders a
full-screen Console Error/Warning overlay regardless of whether the error
is already fully handled downstream — this is exactly what happened with
the now-removed `[QR-DEBUG]` instrumentation (P8.1–P31.1), which logged a
handled `AbortError` via `console.error` and produced a user-visible
overlay for an outcome the app was already recovering from correctly. Any
future Android networking code (this client, `streaming/blobUtil.ts`, or a
new one) must apply the same rule: a caught error that is already being
converted into a user-facing result must not also be logged at
`console.error`/`console.warn` level; use `console.log` (or nothing) if
developer-only visibility is still wanted. A genuinely unhandled/unexpected
exception (one that isn't caught and turned into a result the UI already
displays) is not covered by this rule and should still surface loudly.

### Production Readiness Audit (P37)

**P37 was an audit-only milestone (`docs/15_QA_NOTEBOOK.md`'s P37 entry
has the full detail) — no application source, build config, or
dependencies were changed.** It confirmed the concrete state P38+ must
build on and found two genuine packaging blockers Claude Code should
treat as durable facts, not re-investigate from scratch:

* **Android's `AndroidManifest.xml` sets `android:usesCleartextTraffic=
  "${usesCleartextTraffic}"`, a Gradle manifest placeholder resolved by
  `@react-native/gradle-plugin` itself (not by anything in this repo) to
  `"true"` on a debug build and `"false"` on release.** Because Relay's
  entire networking model is plain HTTP over LAN (`docs/10_Security.md`
  §12, an already-accepted V1 design decision), a release APK will have
  cleartext traffic blocked outright by Android's default Network
  Security Config — every request to the desktop backend will fail, with
  no code-level exception to debug from. This has never surfaced in any
  physical-device testing (P1–P36) because every one of those was a debug
  build. **Any P40 (Android release APK) work must resolve this** —
  either an explicit `manifestPlaceholders["usesCleartextTraffic"] =
  "true"` for the release build type too, or a
  `network_security_config.xml` scoped to private/local IP ranges.
* **Android's release build type currently signs with the debug keystore**
  (`android/android/app/build.gradle`'s `signingConfigs.release` points at
  `signingConfigs.debug`, unchanged from the RN template default). A real
  release keystore must be generated and wired in during P40 — never
  committed, following the same "tracked template, gitignored real
  values" pattern `backend/.env.example`/`backend/.env` already
  establishes for the backend.

P37 also confirmed `desktop/src/main/backend-manager.js` **already**
anticipates the eventual backend-bundling decision: its `app.isPackaged`
branch spawns `path.join(process.resourcesPath, "backend",
"relay-backend.exe")` with `RELAY_DATA_DIR` set to Electron's
`app.getPath("userData")` — this is dead code today (nothing builds that
executable yet) but needs no rework once P38 lands, provided P38's chosen
tool produces a single `relay-backend.exe` at that exact sub-path. P37's
recommendation for P38/P39 (see `docs/15_QA_NOTEBOOK.md` for full
reasoning): **PyInstaller `--onedir`** for the backend (fits
`backend-manager.js`'s existing path assumption, avoids `--onefile`'s
per-launch extraction cost) and **`electron-builder` with an NSIS,
per-user install target** for the desktop installer (built-in
`extraResources` support to place PyInstaller's output at
`resources/backend/`, no admin rights required, works with the existing
`RELAY_DATA_DIR` mechanism unchanged). Neither tool is installed yet —
do not assume either is available until a milestone actually adds it.

Two smaller, non-blocking items P37 found and left for P38/P39 rather
than fixing immediately (in scope, per this file's Rule 3, to fold into
whichever of those milestones is already touching the relevant file):
`backend/app/core/config.py`'s `DEBUG: bool = True` setting is defined
but never read anywhere in the codebase (dead config, remove or wire it
up rather than leaving an unused `True` default); `desktop/src/main/
main.js`'s `const BACKEND_PORT = 8000` hardcodes a literal that
independently duplicates `backend/app/core/config.py`'s `PORT` default
with no shared source of truth. `requirements.txt`/`requirements-dev.txt`
remain fully unpinned (no version specifiers at all) — pin these as part
of P38, before the first real bundled build, not after.

### Backend Production Bundle (P38)

**The packaged Windows backend now actually builds** — `backend/run.py`
(a real `__main__` entry point `app/main.py` never had; parses `--host`/
`--port`, defaulting both from `Settings.HOST`/`Settings.PORT`, and calls
`uvicorn.run(app, ...)` directly rather than the CLI's import-string form)
and `backend/relay-backend.spec` (a minimal PyInstaller `--onedir` spec;
its one non-default hidden-import, `collect_submodules("sqlalchemy.dialects.sqlite")`,
exists because SQLAlchemy resolves that dialect via a runtime string
import PyInstaller's static analysis can't follow — Uvicorn's/Pydantic's
own equally dynamic resolution is already covered by
`pyinstaller-hooks-contrib`, installed automatically as a `pyinstaller`
dependency). Building `pyinstaller relay-backend.spec` from `backend/`
produces `backend/dist/relay-backend/relay-backend.exe` — the exact path
`desktop/src/main/backend-manager.js`'s packaged-mode branch already
expected (confirmed compatible, see below) — plus a `_internal/` support
directory, together ~36 MB. **Always build from a clean virtual
environment holding only `requirements.txt` + `requirements-build.txt`,
never `backend/.venv`** — the tracked dev venv has accumulated unrelated
packages (`lxml`, `Pillow`, `python-docx`, `python-pptx`, `reportlab`,
`xlsxwriter`, `lameenc`; none imported anywhere in `backend/app` or
`backend/tests`, none of Relay's making) that must never end up
bundled into a production executable.

**`requirements.txt`/`requirements-dev.txt` are now pinned** to the exact
versions 343 backend tests were verified against (dev-only, this pass:
`starlette` drifted `1.3.1` → `1.6.0` on a from-scratch resolve, since only
`fastapi` is pinned directly — re-tested, no regression). A third file,
**`requirements-build.txt`** (`-r requirements.txt` + `pyinstaller`),
holds the one build-only dependency — never installed for ordinary
development/testing, never shipped to an end user. This three-way split
(production / dev-test / build-only) is the durable convention for any
future backend dependency addition: know which of the three categories a
new package belongs to before adding it to any requirements file.

**`backend-manager.js` needed zero changes.** Its packaged-mode
`resolveCommand()` (`args: ["--port", ...]` — deliberately *no* `--host`,
which is exactly why `run.py` defaults `--host` from `Settings.HOST`
itself rather than requiring it) was verified against the real P38 build
by replicating that function's exact logic in a standalone Node script
(Electron's `app` module doesn't run outside a real Electron process) and
spawning the actual built executable through it — command resolution,
`cwd`, and `env.RELAY_DATA_DIR` all matched and the spawned process passed
its own health check. A real `electron-builder`/`extraResources` copy into
a packaged app's actual `resources/backend/` remains P39's job.

The P38 bundle was verified as genuinely self-contained, not merely
"launches while the repo/venv happens to be present": copied to an
isolated directory (path containing spaces), launched with `PATH` scrubbed
of every Python/venv reference, against a freshly created
Unicode-named `RELAY_DATA_DIR` — started cleanly, served real API traffic
(settings, devices, shared files/folders, a full pairing handshake, and a
complete send + receive transfer with byte-verified streamed content),
survived a forced kill and restart with all data intact, and reconciled
cleanly on the restart's `_reconcile_after_unclean_shutdown()` pass. Full
detail, including the one process mistake made and corrected during this
verification (a disposable upload test briefly landed in the real
`Downloads` folder before `download_directory` was redirected to a
scratch path — caught and cleaned up immediately), is in
`docs/15_QA_NOTEBOOK.md`'s P38 entry.

## Not Yet Implemented

* Resume/`Range` support, checksum verification, compression, end-to-end encryption, bandwidth limiting (all explicitly deferred future enhancements per `docs/11_File_Transfer.md` §16)
* WebSockets / real-time push (transfer progress is currently polled via `GET /transfers/{id}`)
* Packaging & distribution (`docs/12_Packaging_Deployment.md`): the backend now has a verified PyInstaller `--onedir` production bundle (P38), but there is still no `electron-builder` installer and no signed release APK — the desktop app and Android app both still run from source
* Whether `Devices`/`Settings`/`Pairing`/`Discovery` should also require a paired-device session was raised during M9 and left open — revisit if Android is ever expected to call those routes directly

## Next Planned Milestone

**Packaging & Deployment** (`docs/12_Packaging_Deployment.md`) — the last
major piece before Version 1 is distributable. P37 (an audit-only
milestone) broke this into a concrete four-milestone sequence; **P38 is
now complete** (see "Backend Production Bundle (P38)" above and
`docs/15_QA_NOTEBOOK.md`'s P38 entry for full detail):

* ~~**P38 — Backend Production Bundle.**~~ **Done.** Pinned backend
  dependencies (three-way split: production/dev-test/build-only); added
  `backend/run.py` + `backend/relay-backend.spec`; built and verified a
  self-contained `relay-backend.exe` against a real, isolated, no-Python
  environment; confirmed `backend-manager.js` needs no changes.
* **P39 — Windows Desktop Installer.** Add `electron-builder` (NSIS,
  per-user install, per P37's recommendation); wire P38's `backend/dist/
  relay-backend/` output into `resources/backend/` via `extraResources`;
  produce and validate a real installer on a clean VM. While already
  touching `desktop/package.json`/`main.js`, also resolve the
  `BACKEND_PORT`/`config.py` duplication and remove/wire up the unused
  `DEBUG` config field (both flagged by P37, still open after P38).
* **P40 — Android Release APK.** Fix the `usesCleartextTraffic`
  release-build blocker and the debug-keystore release-signing gap (both
  confirmed by P37, detailed above); produce a real signed APK.
* **P41 — Packaged End-to-End Release Validation.** The full
  Windows/Android/cross-platform matrix in `docs/15_QA_NOTEBOOK.md`'s P37
  entry, run against the real packaged artifacts from P38–P40.

Do not begin P39 automatically — each of these remains its own
milestone, reviewed before the next starts, per this file's Git Workflow
rules.

## Documentation

The `docs/` directory contains the official project specification, including:

* Project Charter
* Project Overview
* Architecture
* Technology Stack
* Project Structure
* API Design
* Coding Standards
* Development Workflow
* Architecture Decisions
* 09_Networking.md
* 10_Security.md
* 11_File_Transfer.md
* 12_Packaging_Deployment.md
* 13_Database_Design.md

These documents are the source of truth for Version 1.

Claude Code should read the relevant documentation before implementing any feature.

If documentation conflicts, follow the most specific document and report the inconsistency instead of making assumptions.

---

## Technology Stack

The technology stack for Version 1 has been finalized.

Desktop

* Electron
* HTML
* CSS
* JavaScript

Backend

* Python 3.13+
* FastAPI
* SQLAlchemy
* SQLite
* Pydantic
* Uvicorn

Android

* React Native

Development

* Git
* Ruff
* Pytest
* Visual Studio Code
* Claude Code


---

# Development Philosophy

This project is being developed with Claude Code.

Claude is expected to generate code, but every architectural decision should prioritize:

* Simplicity
* Maintainability
* Readability
* Modularity
* Testability

Avoid unnecessary abstractions.

Prefer explicit code to clever code.

---

## Layer Responsibilities

The project follows strict layered architecture.

- API routes may call Services only.
- Services may call Repositories only.
- Repositories may access SQLAlchemy only.
- SQLAlchemy models must never be queried directly from API routes or Services.

Each layer has a single responsibility.

Claude Code should preserve these boundaries unless explicitly instructed otherwise.

---

# Primary Goal

The goal is **not** to finish the project as quickly as possible.

The goal is to produce production-quality code that is easy to understand, extend, debug, and maintain.

---

# Project Rules

Claude must follow these rules at all times.

## Rule 1

Never redesign the project architecture unless explicitly instructed.

Follow the architecture described inside the `/docs` directory.

---

## Rule 2

Never introduce new technologies without explaining why they are needed.

---

## Rule 3

Never add features outside the current milestone.

Stay focused on the requested task.

---

## Rule 4

Before writing code:

* understand the current milestone
* inspect the existing project structure
* reuse existing code whenever possible

---

## Rule 5

Do not duplicate logic.

If functionality already exists, extend it instead.

---

## Rule 6

Always keep files organized.

Avoid creating unnecessary files.

---

## Rule 7

Every public function should have a clear purpose.

Use descriptive names.

---

## Rule 8

Write code suitable for developers.

Avoid unnecessary complexity.

---

## Rule 9

When making architectural decisions:

1. Explain the reasoning.
2. Explain the trade-offs.
3. Recommend the best option.

---

## Rule 10

If multiple implementations are possible, recommend one and explain why.

---

# Code Quality

Claude should produce code that is:

* modular
* readable
* documented where necessary
* type hinted
* consistent

---

# Error Handling

Never silently ignore exceptions.

Return meaningful errors.

Log unexpected failures.

---

# Testing

Every completed milestone should include:

* testing checklist
* manual verification steps
* known limitations

---

# Documentation

Whenever architecture changes:

Update the relevant documentation inside `/docs`.

If README information becomes outdated, recommend updating it.

---

# Git Workflow

Work in small milestones.

After each completed milestone:

* verify the project builds
* verify tests pass
* recommend creating a Git commit

Never continue implementing additional milestones automatically.

---

# If Requirements Are Unclear

Do not guess.

State the ambiguity and recommend the most reasonable approach before implementing.

---

## Engineering Decisions

Claude Code should distinguish between:

- Project Requirements
- Architectural Decisions
- Implementation Decisions

If a question concerns implementation rather than architecture, defer the decision until the appropriate milestone instead of expanding the project scope prematurely.

---

# Success Criteria

Every milestone should end with:

* Summary of completed work
* Files created or modified
* Testing checklist
* Suggested Git commit message
* Next recommended milestone

---
## Documentation Ownership

Claude Code may modify project documentation when the changes are necessary to keep it accurate and up to date.

This includes:

* `CLAUDE.md`
* `README.md`
* Documentation inside `/docs`
* Component-specific documentation such as `backend/README.md` and `android/README.md`

Whenever an implementation, architecture, workflow, milestone, configuration, or project status changes, Claude Code should update the relevant documentation to reflect the current state.

Claude Code should not make unnecessary documentation changes unrelated to the task.


---