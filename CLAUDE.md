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

Relay has completed its specification phase and is in active backend implementation.

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

## Current Architecture

The backend follows the layered design in `docs/02_Architecture.md`:

```
API Layer → Service Layer → Repository Layer → SQLAlchemy Models
```

Implemented resources: `Devices`, `AppSettings`, `Pairing`, `Shared Files`,
`Transfers` (including byte streaming). `Devices`, `Settings`, and `Pairing`
remain fully unauthenticated — the desktop's own Electron UI always calls
them over loopback. `Shared Files` and `Transfers` enforce the M9
`DeviceSession` bearer-token check (`AuthService`, `get_current_device`/
`CurrentDeviceDep`, `get_requesting_device`/`RequestingDeviceDep` in
`app/api/dependencies.py`) for any non-loopback caller — `GET /files` and
the dual-audience `/transfers` routes accept the trusted desktop caller or
a session token; the Android-only proposal and byte-streaming routes
(`POST /transfers/requests`, `DELETE /transfers/requests/{id}`,
`GET /transfers/{id}/download`, `POST /transfers/{id}/upload`) require a
session token outright.

## Not Yet Implemented

* Device discovery
* Resume/`Range` support, checksum verification, compression, end-to-end encryption, bandwidth limiting (all explicitly deferred future enhancements per `docs/11_File_Transfer.md` §16)
* WebSockets / real-time push (transfer progress is currently polled via `GET /transfers/{id}`)
* Desktop (Electron) and Android clients
* Whether `Devices`/`Settings`/`Pairing` should also require a paired-device session was raised during M9 and left open — revisit if Android is ever expected to call those routes directly

## Next Planned Milestone

**Device Discovery** (`docs/09_Networking.md` §4) — automatic desktop/Android
discovery over the local network (mDNS/Zeroconf vs. UDP broadcast to be
evaluated during that milestone), the last major backend piece before the
Electron and React Native clients have something to connect to
automatically without manual configuration.

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

Claude Code must not replace major technologies without developer approval.

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

The developer owns all documentation.

Claude Code must **never automatically modify**:

* CLAUDE.md

Claude Code may recommend documentation updates when information becomes outdated, but should wait for developer approval before making documentation changes.

Implementation-specific documentation may be updated only when explicitly requested.

---