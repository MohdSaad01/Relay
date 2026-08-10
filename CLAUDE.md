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

## Not Yet Implemented

* Resume/`Range` support, checksum verification, compression, end-to-end encryption, bandwidth limiting (all explicitly deferred future enhancements per `docs/11_File_Transfer.md` §16)
* WebSockets / real-time push (transfer progress is currently polled via `GET /transfers/{id}`)
* Packaging & distribution (`docs/12_Packaging_Deployment.md`): no PyInstaller (or equivalent) backend bundling, no `electron-builder` installer, no signed release APK — all three components currently run from source
* Whether `Devices`/`Settings`/`Pairing`/`Discovery` should also require a paired-device session was raised during M9 and left open — revisit if Android is ever expected to call those routes directly

## Next Planned Milestone

**Packaging & Deployment** (`docs/12_Packaging_Deployment.md`) — the last
major piece before Version 1 is distributable: bundling the FastAPI backend
so it runs without a system Python install, packaging the Electron app into
a Windows installer that starts the backend automatically, and producing a
signed release APK for Android. The exact backend packaging tool
(PyInstaller or an equivalent) is still to be selected, per that document.

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