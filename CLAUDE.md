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
* **M9: Authentication infrastructure** — `AuthService` (`app/services/auth_service.py`) validates the bearer `DeviceSession` token (`Authorization: Bearer <token>`) issued by `PairingService.approve_pairing` (M7/M8), per `docs/10_Security.md` §7-9: hashes the presented token, looks it up, rejects a missing/unknown/expired token with a new `AuthenticationError` (mapped to `401` via the M6 exception-handler pattern, generic message in every failure case), and on success updates `last_used_at`/`last_seen_at` without committing — that bookkeeping rides along inside whatever transaction the request's own service commits, so authentication itself never owns a transaction boundary. Exposed as the `get_current_device`/`CurrentDeviceDep` FastAPI dependency (`app/api/dependencies.py`). **Not yet attached to any router** — every endpoint remains unauthenticated until a future milestone wires it in. See `backend/README.md` for full details.

## Current Architecture

The backend follows the layered design in `docs/02_Architecture.md`:

```
API Layer → Service Layer → Repository Layer → SQLAlchemy Models
```

Implemented resources: `Devices`, `AppSettings`, `Pairing`. All endpoints are
currently unauthenticated. The pairing handshake (`PairingManager`/`PairingService`)
is exposed over HTTP via `app/api/v1/pairing.py` (M8), so a client can drive
the full start → submit → approve/reject → collect flow. M9 added the
session-token validation infrastructure (`AuthService`, `get_current_device`/
`CurrentDeviceDep` in `app/api/dependencies.py`) that will enforce the
resulting `DeviceSession` token on protected requests, but it is not yet
attached to any router — every endpoint remains open until a future
milestone wires it in.

## Not Yet Implemented

* Authentication enforcement on routes (`AuthService`/`get_current_device` from M9 validate a `DeviceSession` bearer token, but no router requires one yet — every endpoint is still reachable without one)
* Shared files
* Transfers
* Device discovery
* Desktop (Electron) and Android clients

## Next Planned Milestone

**Shared Files** — the first Android-facing resource endpoints
(`docs/13_Database_Design.md` `shared_files` table), and the first router
expected to actually attach the M9 `get_current_device`/`CurrentDeviceDep`
dependency so requests require a valid paired-device session. Whether
`Devices`/`Settings` should also become protected was raised during M9 and
left open — revisit if Android is ever expected to call those routes
directly.

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