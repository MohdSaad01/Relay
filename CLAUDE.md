# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

# Relay

Relay is a local-first file transfer application for Windows and Android. Users send files directly between a Windows desktop and an Android phone over a local Wi-Fi network or mobile hotspot — no cloud storage, no internet server, no account. The desktop hosts the backend; the phone discovers it, pairs with it once, and transfers files directly to and from it from then on.

## Status

**Relay `v1.0.0` has shipped and is publicly distributed.** The backend, Electron desktop app, and React Native Android app all implement the full pairing → discovery → share → transfer → stream flow. Packaging is complete and verified end-to-end on real hardware: a real Windows installer, a real bundled backend, and a real Android release APK (signed with a genuine production keystore) work together as one product. The GitHub Release (tag `v1.0.0`) is published with all three assets, and the GitHub Pages website is live with working download links.

Known, deliberately-accepted V1 limitations: the Windows installer is unsigned (no free option puts Relay's own name on a certificate); Windows Firewall's first-run prompt has never been observed in the dev environment (functional connectivity confirmed regardless); a couple of narrow, non-blocking UI sync gaps on Android. See [Not Yet Implemented](#not-yet-implemented) below and `docs/14_Testing_Plan.md` §6 for the current, complete list.

Any further product work is a new milestone, reviewed and authorized by the project owner before starting — see [Git Workflow](#git-workflow) below.

## Documentation Map

One canonical source per topic — read the relevant doc before implementing in that area, rather than relying on this file's summary:

| Topic | Canonical source |
|---|---|
| Project vision, scope, functional requirements | `docs/00_Project_Overview.md` |
| System architecture, layering, repository structure | `docs/02_Architecture.md` |
| Technology stack and why each choice was made | `docs/03_Tech_Stack.md` |
| API conventions (versioning, response envelope, status codes) | `docs/05_API_Design.md` |
| Coding standards, naming, milestone/Git workflow | `docs/06_Coding_Standards.md` |
| Architectural Decision Records (ADRs) | `docs/08_Architecture_Decisions.md` |
| Networking (discovery, ports, firewall) | `docs/09_Networking.md` |
| Security model (pairing, sessions, auth) | `docs/10_Security.md` |
| File transfer protocol (streaming, folders, duplicates) | `docs/11_File_Transfer.md` |
| Packaging, signing, and release process | `docs/12_Packaging_Deployment.md` |
| Database schema | `docs/13_Database_Design.md` |
| Current test status, commands, and known open items | `docs/14_Testing_Plan.md` |
| Full historical investigation/verification detail, by milestone | `docs/15_QA_NOTEBOOK.md` |
| Full backend internals (routes, services, DI) | `backend/README.md` |
| Android setup and native build notes | `android/README.md` |

Every doc above is already condensed to its essentials and cross-references the others by section number — extend a doc in place rather than duplicating its content here.

## Architecture Snapshot

```
API Layer → Service Layer → Repository Layer → SQLAlchemy Models
```

Backend resources: `Devices`, `AppSettings`, `Pairing`, `Discovery`, `Shared Files`/`Shared Folders`, `Transfers` (including byte streaming). `Devices`, `Settings`, `Pairing`, and `Discovery` are unauthenticated (desktop's own Electron UI always calls them over loopback). `Shared Files`/`Transfers` enforce a `DeviceSession` bearer-token check for any non-loopback caller (`AuthService`, `get_current_device`/`get_requesting_device` in `app/api/dependencies.py`).

Key in-memory (non-persisted) singletons: `PairingManager` (pending pairing attempts), `TransferManager` (pending transfer proposals), `ActiveStreamRegistry` (one active stream per transfer), `UploadBatchRegistry` (folder-upload name conflicts) — see `docs/13_Database_Design.md` §9 for why these are deliberately not database rows.

The backend runs embedded inside the Electron desktop app (`desktop/`, Milestone 14: `desktop/src/main/backend-manager.js` starts/stops it as a child process alongside the Electron app's own lifecycle — the approved architecture this file's design comment refers to). The Android client (`android/`, React Native/TypeScript) discovers the desktop via UDP broadcast (`docs/09_Networking.md` §4), pairs with it, and drives the transfer flow from the phone side. Full repository/directory layout: `docs/02_Architecture.md` §11.

---

# Project Rules

Claude must follow these rules at all times.

## Rule 1

Never redesign the project architecture unless explicitly instructed. Follow the architecture described inside the `/docs` directory.

## Rule 2

Never introduce new technologies without explaining why they are needed.

## Rule 3

Never add features outside the current milestone. Stay focused on the requested task.

## Rule 4

Before writing code: understand the current milestone, inspect the existing project structure, reuse existing code whenever possible.

## Rule 5

Do not duplicate logic. If functionality already exists, extend it instead.

## Rule 6

Always keep files organized. Avoid creating unnecessary files.

## Rule 7

Every public function should have a clear purpose. Use descriptive names.

## Rule 8

Write code suitable for developers. Avoid unnecessary complexity.

## Rule 9

When making architectural decisions: explain the reasoning, explain the trade-offs, recommend the best option.

## Rule 10

If multiple implementations are possible, recommend one and explain why.

---

# Layer Responsibilities

The backend follows strict layered architecture (`docs/02_Architecture.md` §4/§8):

- API routes may call Services only.
- Services may call Repositories only.
- Repositories may access SQLAlchemy only.
- SQLAlchemy models must never be queried directly from API routes or Services.

Preserve these boundaries unless explicitly instructed otherwise.

---

# Durable Conventions & Gotchas

Cross-cutting rules discovered the hard way during development. Each is a standing convention for any future change in its area — the investigation/verification narrative behind each lives in `docs/15_QA_NOTEBOOK.md` (search by the milestone tag in parentheses) if you need the evidence trail.

## Backend/Android identity & data-reuse

**Backend ID Reuse (P17).** A backend integer primary key (`shared_folders.id`, `shared_files.id`, any plain SQLite `INTEGER PRIMARY KEY` without `AUTOINCREMENT`) is **not** durable external identity — it is only unique while its row exists, and SQLite recycles ids once a table empties. Any local state keyed by one of these ids and expected to survive across the id's reuse must validate it against an independent signal the backend already provides (`shared_at`, set once at creation, untouched by refresh) before trusting a cached entry — never derive that signal from a display name, since two different logical items can legitimately share one. This mirrors `docs/13_Database_Design.md`'s existing `devices.device_identifier` precedent: the primary key is an internal implementation detail, not a stable identity contract. Do not "fix" this at the database layer (no `AUTOINCREMENT`, no UUID column) without a proven need.

**Android Download Identity (P16).** Any Android download-path code (existence checks, Open, notifications, reconciliation) must resolve identity through the appropriate id-keyed registry (`android/src/files/fileIdentity.ts` for standalone files, `folderIdentity.ts` for folders), never through `file_name`/`folder_name` directly. Two different shared items can legitimately carry the same display name — deriving on-device identity from the name instead of the id lets one item's download/deletion silently affect the other's Download/Open state.

**Device lifecycle & re-pairing (P43/P43.1).** `device_identifier` is Android-install-scoped: generated once and persisted independently of the paired `Session` (`android/src/pairing/deviceIdentifier.ts`), reused for every later pairing attempt from that install — it is only lost on a genuine uninstall. A pairing request presenting an already-known `device_identifier` is a legitimate re-pair, not an error: `PairingService.approve_pairing` reconciles onto the existing `Device` row (rotating credentials, invalidating every prior session) rather than rejecting or duplicating it. **Identity precedence is strict:** a matching `device_identifier` is always checked first and always wins, regardless of whether the name also matches. Only when the identifier is genuinely new is a name collision (e.g. a reinstalled phone resubmitting its old device-model name) even considered — resolved via a live-checked Replace/Make-new user choice on the desktop (`DeviceService.find_name_collision_or_none`, checked both at poll time and again at commit time, never a cached snapshot). There is no database-level uniqueness constraint on `device_name`, deliberately. A stale `Device` row is not detectable or auto-prunable — there is no uninstall signal, and no reliable way to distinguish "this install is gone for good" from "a second legitimate phone." Do not add heuristic staleness detection.

## Backend actions with no delete primitive

**Desktop Files/Transfers Conventions (P21).** A backend action with no delete/undo primitive by design (`Transfer` rows are permanent history — `docs/13_Database_Design.md` §7/§10, `TransferRepository` has no delete method) must not grow one just to make a "clear"/"remove" UI feature easier. Filter what's displayed via a client-local marker instead — Desktop's `transferHistory.js`/`receivedFiles.js` and Android's `historyReset.ts` both follow this shape (`localStorage` on Desktop, a JSON marker file on Android). Any future "hide history"/"remove entry" feature over data the backend deliberately never deletes should do the same, not add a backend delete route.

A **received file/folder** (an Android upload the desktop accepted) has no `SharedFile`/`SharedFolder` row — `TransferStreamService.receive_upload` only ever writes bytes and updates the `Transfer` row. Where a view needs to present one as shared (Desktop's Shared Files), derive it from `GET /transfers` (`direction === 'receive' && status === 'completed'`, grouped by `upload_batch_id`) rather than inventing a backend row.

**Desktop Stale Received-Item Handling (P44).** A received item's physical path is derived state, not authoritative — it can go stale (moved/deleted outside Relay) independently of its `Transfer` row. Any Desktop action that touches that path (Open, Show in Folder) must check it exists first (`window.relay.pathExists`, a thin `fs.existsSync` IPC wrapper) rather than reacting to the OS call's own failure mode after the fact. A missing path marks the item removed via the existing local marker — never touches the backend `Transfer` row.

**IPC handlers that touch the filesystem** should treat an already-missing target as a no-op success rather than propagating the OS call's raw failure (`shell:deleteItem`, P29) — this is what lets Delete/Open/Show-in-Folder complete cleanly on a source that was removed outside Relay.

## Desktop renderer (Electron CSP)

**The renderer's CSP (`style-src 'self'`, no `unsafe-inline`) silently blocks every inline style from being applied** — both an HTML `style="..."` attribute and a JS `element.style.property = value` mutation. The DOM's `style` attribute *text* still updates (so a shallow source or live check can look correct), but Chromium never renders it; only a matching CSS class rule wins. Any renderer code that needs to change an element's visual style at runtime must use a CSS class toggle (`classList.add`/`remove`, e.g. `devices.js`'s `.device-card.is-renaming`) or a native DOM property the CSP doesn't govern (a `<progress>` element's `value`/`max`, used for the transfer progress bar) — never `element.style.property =` or an inline `style=""` attribute (P29.1, P33).

**`window.prompt()` is unimplemented in this Electron build and always throws.** `window.confirm()` does work but every confirmation now goes through `dialog.js`'s `confirmDialog({title, message, confirmLabel, cancelLabel, destructive})` instead — never a raw `window.confirm()`/`window.prompt()`. `destructive: true` is reserved for an action that actually destroys/permanently discards something (Unpair, Delete, Clear History); a reversible action (Unshare) stays primary/blue. `alertDialog({title, message, okLabel})` is the single-button, non-confirmation sibling for "just tell the user" moments (P30, P44). Free-text input needs its own inline UI (`devices.js`'s inline Rename form is the pattern to extend) — there is no native prompt to fall back on.

**Toggling an element's visibility via the `hidden` attribute silently loses to any author CSS rule that sets `display` on that same element**, regardless of selector specificity (P29).

**A `<table>` with no `table-layout`/column-width rule sizes every column to its widest cell's unbounded content width** — one pathological long value drags the whole table, and every row's action column, wider than the window. Any table column holding unbounded free text needs `table-layout: fixed`, an explicit `<colgroup>` column width, and `.cell-truncate` (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap` plus a `title` attribute) on the one flexible free-text column (P32). A single row's action failing must fail into a row-scoped error (`showRowError(row, message, onRetry)`), never `renderError()`'s whole-view replacement.

**Shared UI primitives** — reuse rather than reinvent: `pageHeader()`/`emptyState()`/`iconBadge()` (`desktop/src/renderer/dom.js`) plus hand-written inline SVGs (`desktop/src/renderer/icons.js`, no icon-font/library dependency) for any new Desktop view/empty state (P19/P20/P27); `.row-actions` (`app.css`) for a table cell holding more than one or two action buttons (P21).

## Packaging, signing & distribution

**PyInstaller backend builds must always use a clean, isolated venv** — never the tracked `backend/.venv`, which accumulates unrelated dev packages — installing only `requirements.txt` + `requirements-build.txt` (P38). `pydantic-settings`' `env_file=".env"` resolves relative to the process's **working directory**, not the exe's own folder — any isolation test must set an explicit working directory away from a reachable `backend/.env`, or it will silently pick up the dev database path and look like `RELAY_DATA_DIR` is broken when it isn't (P48).

**Android release signing must never fall back to the debug keystore.** `android/android/app/build.gradle` resolves credentials from a gitignored `keystore.properties` (template: `keystore.properties.example`) or environment variables; if neither supplies all four values, the release build fails fast with a clear error. The **production** signing keystore (`CN=Relay Labs, OU=Relay`) lives at a fixed location **outside the repository entirely**, and its password was generated randomly and is recorded nowhere in the tracked repo — never committed, never logged, never written to any doc. **Losing this keystore permanently breaks the Android update chain** for every existing user (recovery requires publishing under a new `applicationId`, which every install sees as a different app) — keep it backed up securely outside the repo. The release Network Security Config (`android/android/app/src/main/res/xml/network_security_config.xml`, `cleartextTrafficPermitted="true"`) must stay in place — Relay has no TLS layer, and `minSdk` 26 makes this file take precedence over the RN Gradle plugin's own per-build-type placeholder regardless of what that plugin resolves.

**`desktop/package.json`'s `build.compression` must stay `"store"`.** NSIS's default solid-7z packaging runs installation as independently-timed phases sharing one progress bar, producing a backward jump partway through; `"store"` removes the mismatch at its source (no decompression math) at a small (~1MB) size cost, since this payload is already mostly incompressible binary data. `nsis.useZip` has no effect once a build is differential-update-aware (produces a `.blockmap`, which this build always does).

**`desktop/package.json`'s `description` must stay `""` and `author` must be the object form (`{ "name": "Relay Labs" }`)** — a bare string silently fails to set anything. `description` is written verbatim into the Desktop/Start Menu shortcuts' Comment field and Control Panel's Comments value by electron-builder; `author.name` is the sole source of `Relay.exe`'s `CompanyName` and the NSIS `Publisher` value.

**Distribution model:** GitHub Releases is the sole artifact host — one release per `vX.Y.Z` tag, exactly three assets (`Relay-Setup-<version>.exe`, `Relay-<version>.apk`, `SHA256SUMS.txt`). `relay-backend.exe` is never a standalone release asset — it is only ever consumed embedded inside the Windows installer. The website (`web/`, GitHub Pages) links out to GitHub Releases rather than serving binaries itself. Updates are manual on both platforms — no auto-updater exists. Windows ships unsigned for V1 by deliberate choice (no genuinely free option puts Relay's own name, rather than a foundation's, on the certificate; SignPath Foundation is the credible $0 path for a future signed release once a CI pipeline exists).

## Testing gotchas

**`TestClient`'s in-process ASGI transport cannot simulate a real dropped TCP connection or real network backpressure.** Client-disconnect/write-timeout logic needs a real `uvicorn` process and a raw socket to test, and should be exercised over a real Wi-Fi link, not loopback — a stalled `send()` may never occur on loopback even against a dead peer.

**Backend timestamps are naive (no UTC designator) but represent UTC.** Any code parsing one with `new Date(...)` on Android must force UTC interpretation or it will silently misbehave by the device's own UTC offset — this bit both the Electron desktop and Android independently.

**A patched third-party native dependency is tracked via `patch-package`** (`android/patches/`) — check `docs/upstream/` for the full writeup before assuming a library behaves per its own docs (the Okio `Source`-contract violation in `react-native-blob-util` is the current example).

**An error already converted into a user-facing result must not also be logged at `console.error`/`console.warn` level** on Android — React Native's `LogBox` intercepts both into a full-screen overlay in a debug build regardless of whether the error is already handled downstream. Use `console.log` or nothing for developer-only visibility; a genuinely unhandled exception is unaffected by this rule.

---

# Known Architectural Gotchas (Documented, Not Bugs)

- **`docs/issues/New_Issues.txt` and `docs/issues/Pre_Release_Issues.txt`** (`docs/issues/`) are archived, superseded requirements documents — every item in them has been implemented. They are kept, unedited, because dozens of source comments and QA notebook entries cite them by exact section number (`New_Issues.txt §1.4`, etc.); those citations resolve by filename search regardless of which `docs/` subdirectory the file lives in. Do not delete either file, and use `docs/issues/` for any new reference to them.
- **A stale local `app_settings.download_directory` or similar dev-database value is local dev state, not a code defect.** Check the local `backend/relay.db` (gitignored) for a leftover value from a manual test before assuming default-resolution code is broken.
- **Backend/Desktop/Android version fields are the single canonical source per component** — `backend/app/core/config.py`'s `Settings.APP_VERSION`, `desktop/package.json`'s `version`, `android/android/app/build.gradle`'s `versionName` — unified at `1.0.0` for the V1 public release. Android `versionCode` only advances for a genuinely new public release, never merely on a rebuild.

---

# Not Yet Implemented

- Resume/`Range` support, checksum verification, compression, end-to-end encryption, bandwidth limiting, WebSockets/real-time push (transfer progress is polled) — all explicitly deferred future enhancements.
- Windows code signing (no $0 option puts Relay's own name on the certificate).
- Automatic Desktop-address rediscovery when a paired Android session's stored address goes stale — Android's Settings has a user-triggered "Forget this desktop" recovery action instead (`SessionManager.clearSession()`), not automatic reconnection or network scanning.
- Android's `react-native-saf-x`-based folder picker intermittently fails with "Unsupported Uri" on some real devices — self-recovers on retry, no data loss; a post-V1 candidate for a retry-with-backoff or an alternative SAF library.
- Android's Files and Transfers screens share one Clear History marker but don't live-sync it — clearing history from one doesn't retroactively filter an already-mounted instance of the other until it's cleared there too or the app restarts.
- `fileIdentity.ts` has the same `shared_files.id` reuse gap `folderIdentity.ts` already guards against (P17's pattern, not yet applied to files) — reachable only via an unshare-to-empty-then-reshare sequence, not normal use.

Full, current, and periodically re-audited: `docs/14_Testing_Plan.md` §6.

---

# Development & Testing Commands

**Backend** (`backend/`): `pytest` (test suite), `ruff check .` (lint). Run the dev server with `uvicorn app.main:app --reload` or `python run.py`.

**Desktop** (`desktop/`): `npm start` (dev, launches Electron against the dev backend), `node --input-type=module --check <file>` (syntax-check a renderer ES module — plain `node --check` silently under-validates a file with a leading `import`). No automated test suite exists for the plain-JS renderer by design — verify by launching the real app.

**Android** (`android/`): `npx jest` (tests), `npx tsc --noEmit` (typecheck), `npx eslint .` (lint), `npm start` (Metro) + `npx react-native run-android` (dev build).

See `docs/14_Testing_Plan.md` §3 for current aggregate test counts and known pre-existing warnings.

---

# Release / Build Procedure

Condensed pipeline — full detail and exact commands: `docs/12_Packaging_Deployment.md` §15-16.

```
Update version (backend/desktop/android version fields)
↓
Build backend (clean venv, PyInstaller --onedir)
↓
Build Desktop installer (npm run dist, pulls in the fresh backend bundle)
↓
Build signed Android APK (production keystore.properties required)
↓
Generate SHA256SUMS.txt
↓
Verify artifacts (signing, version metadata, isolated launch)
↓
Tag release (git tag vX.Y.Z) → GitHub Release (3 assets)
↓
Update website download links
↓
Smoke test
```

---

# Code Quality

Claude should produce code that is modular, readable, documented where necessary, type hinted, and consistent.

# Error Handling

Never silently ignore exceptions. Return meaningful errors. Log unexpected failures.

# Testing

Every completed milestone should include a testing checklist, manual verification steps, and known limitations.

# Documentation

Whenever architecture changes, update the relevant documentation inside `/docs`. If README information becomes outdated, recommend updating it.

---

# Git Workflow

Work in small milestones. After each completed milestone: verify the project builds, verify tests pass, recommend creating a Git commit. **Never continue implementing additional milestones automatically.**

---

# If Requirements Are Unclear

Do not guess. State the ambiguity and recommend the most reasonable approach before implementing.

---

# Engineering Decisions

Distinguish between Project Requirements, Architectural Decisions, and Implementation Decisions. If a question concerns implementation rather than architecture, defer the decision until the appropriate milestone instead of expanding scope prematurely.

---

# Success Criteria

Every milestone should end with: a summary of completed work, files created or modified, a testing checklist, a suggested Git commit message, and a next recommended milestone.

---

# Documentation Ownership

Claude Code may modify project documentation when the changes are necessary to keep it accurate and up to date. This includes `CLAUDE.md`, `README.md`, documentation inside `/docs`, and component-specific documentation (`backend/README.md`, `android/README.md`). Whenever an implementation, architecture, workflow, milestone, configuration, or project status changes, Claude Code should update the relevant documentation to reflect the current state — but should not make unnecessary documentation changes unrelated to the task at hand.
