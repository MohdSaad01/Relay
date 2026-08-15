# Relay Architecture & Project Structure

Version: 1.0 — consolidated from the former `02_Architecture.md` and
`04_Project_Structure.md`, and corrected to match the as-built system
(see `backend/README.md` for full backend internals).

---

# 1. Architecture Philosophy

Relay follows a modular, local-first architecture. Each major component
has a single responsibility and communicates through clearly defined
interfaces, prioritizing simplicity, maintainability, testability, and
separation of concerns over speculative flexibility.

---

# 2. High-Level Architecture

Relay consists of three components plus local storage:

```text
┌─────────────────────────────┐         Wi-Fi / hotspot         ┌───────────────────────┐
│   Windows Desktop (Electron)│◄────────────────────────────────►│  Android (React Native) │
│                              │      UDP discovery + REST API   │                         │
│  ┌────────────────────────┐  │                                  └───────────────────────┘
│  │ FastAPI backend         │  │
│  │ (embedded, auto-started)│  │
│  └───────────┬────────────┘  │
│      ┌───────┴───────┐       │
│      ▼               ▼       │
│  ┌────────┐     ┌─────────┐  │
│  │ SQLite │     │  Files   │  │
│  │  (meta)│     │ (on disk)│  │
│  └────────┘     └─────────┘  │
└─────────────────────────────┘
```

The Windows desktop hosts the FastAPI backend as an embedded child process
(Electron). Android connects to it directly over the local network — the
desktop acts as the server for Version 1. No component runs in the cloud.

---

# 3. Component Responsibilities

**Desktop (`desktop/`)** — the host. Starts/stops the backend as a child
process, displays the desktop UI (devices, shared files, transfer
progress, settings), and provides system tray integration. Contains no
backend business logic — it is a host and a UI.

**Backend (`backend/`)** — the central coordinator and the only place
business rules live: device discovery, pairing validation, authentication/
authorization, shared-file and transfer management, byte streaming,
database access, configuration, and logging.

**Android (`android/`)** — discovers the desktop, pairs with it, browses
its shared files, and proposes/streams transfers in both directions. Like
the desktop, it stays thin; business logic lives in the backend wherever
practical.

Both clients communicate with the backend only through its REST API —
neither embeds any business logic that duplicates what the backend already
enforces.

---

# 4. Backend Layered Design

The backend follows a strict four-layer design (not the generic
Presentation/Application/Domain/Infrastructure split considered during
initial planning — the concrete layering below is what was actually built
and is enforced throughout):

```text
API Layer          (app/api/)           HTTP routing, request/response schemas, DI, exception mapping
        │
Service Layer       (app/services/)      Business rules, workflows, transaction boundaries (commit/rollback)
        │
Repository Layer    (app/repositories/)  SQLAlchemy queries only
        │
Models              (app/models/)        SQLAlchemy ORM models (database tables)
```

**Rules, enforced throughout:**

* API routes may call services only.
* Services may call repositories only; they never touch SQLAlchemy or
  FastAPI request/response objects directly.
* Repositories may access SQLAlchemy only; they are the only code that
  queries the database.
* SQLAlchemy models must never be queried directly from API routes or
  services.
* Each layer has a single responsibility; new features integrate with this
  structure rather than bypassing it.

Cross-cutting infrastructure (configuration, security/token hashing,
startup, logging) lives in `app/core/`, and stateless helpers (filesystem
validation, network utilities) live in `app/utils/` — neither contains
business logic.

Some backend state is deliberately **not** persisted to the database:
in-memory, lock-guarded singletons (`PairingManager`, `TransferManager`,
`ActiveStreamRegistry`, `UploadBatchRegistry`) hold short-lived,
process-lifetime state such as pending pairing attempts and pending
transfer proposals. See `docs/13_Database_Design.md` §9 for the reasoning.

---

# 5. Database & File Storage

Version 1 uses SQLite (`03_Tech_Stack.md`, `08_Architecture_Decisions.md`
ADR-005) and stores metadata only — paired devices, sessions, shared-file/
folder metadata, transfer history, and app settings. Actual files always
remain on disk; the database references them through metadata and Relay
never duplicates a file's bytes unless required to perform a transfer. See
`docs/13_Database_Design.md` for the full schema.

---

# 6. API Layer

All communication happens through the backend's REST API, versioned under
`/api/v1`. See `docs/05_API_Design.md` for conventions and
`backend/README.md` for the full endpoint reference. There is no
WebSocket layer in Version 1 — transfer progress is polled
(`GET /transfers/{id}`); see `docs/05_API_Design.md` §10.

---

# 7. Communication Flow

Typical transfer flow: Android discovers the desktop (or scans its QR
code) → pairing is requested and approved → Android receives a session
token → Android lists shared files → Android proposes a download/upload →
the desktop accepts or rejects it → an accepted proposal streams over
HTTP with either side polling status → the transfer reaches a terminal
state. See `docs/11_File_Transfer.md` §7 for the full two-phase lifecycle.

---

# 8. Design Principles

Relay follows Single Responsibility, Dependency Inversion, Separation of
Concerns, explicit dependencies, loose coupling, and high cohesion.
Unnecessary abstractions are avoided until there is a clear, demonstrated
need — see `CLAUDE.md` Rules 1–10 for how this is enforced day to day.

---

# 9. Error Handling

Errors are logged, return meaningful messages, never expose internal
implementation details, and never fail silently. Unexpected failures
should be recoverable whenever possible. The backend centralizes this as
FastAPI-agnostic service exceptions (`NotFoundError`, `ValidationError`,
`ConflictError`, `AuthenticationError`) mapped to HTTP responses in one
place (`app/api/exception_handlers.py`) rather than per-route try/except.

---

# 10. Future Scalability

The architecture should allow, without a redesign: migration to
PostgreSQL, multiple desktop clients, an internet relay mode, end-to-end
encryption, cross-platform desktop support, and a plugin system. These are
explicitly out of scope for Version 1 (see `docs/00_Project_Overview.md`
§5, §10).

---

# 11. Repository Structure

```text
Relay/
├── CLAUDE.md                Instructions for Claude Code working in this repo
├── README.md                Project overview, setup, and status
├── LICENSE
├── requirements.txt          Backend runtime dependencies
├── requirements-dev.txt      Backend dev/test/lint dependencies
├── requirements-build.txt    Backend build-only dependencies (PyInstaller)
│
├── docs/                    Project specification — source of truth for Version 1
│   ├── upstream/             Notes on upstream (third-party) defects encountered
│   └── issues/               Archived source-requirements documents, superseded but
│                                cited by section number from source comments/QA notes
│
├── backend/                 FastAPI application
│   ├── app/
│   │   ├── api/               Routes (v1/), dependencies, exception handlers, response envelope
│   │   ├── core/               Configuration, security/token hashing, logging setup
│   │   ├── database/            Session management, base, init
│   │   ├── models/              SQLAlchemy models (database tables)
│   │   ├── schemas/             Pydantic request/response models
│   │   ├── services/            Business logic, in-memory managers/registries
│   │   ├── repositories/        SQLAlchemy queries — the only code that touches the ORM directly
│   │   ├── utils/               Stateless helpers (filesystem, network, time)
│   │   └── main.py              FastAPI app, lifespan (startup/shutdown reconciliation)
│   ├── tests/                 Mirrors app/ (api/, services/, repositories/, database/, core/, utils/)
│   ├── .env / .env.example
│   └── README.md              Full backend internals reference
│
├── desktop/                 Electron shell — embeds the backend, hosts the desktop UI
│   ├── src/main/               Main process: backend lifecycle, tray, IPC handlers
│   ├── src/preload/            Preload bridge (renderer ↔ main IPC)
│   ├── src/renderer/           Plain HTML/CSS/JS UI — one view module per resource
│   │   └── views/                devices.js, files.js, pairing.js, settings.js, transfers.js
│   ├── assets/                 Icons (desktop + tray)
│   └── styles/                 app.css (design tokens, shared components)
│
└── android/                 React Native (TypeScript) client
    ├── src/                   api/, discovery/, pairing/, session/, files/, transfers/,
    │                            streaming/, screens/, navigation/, components/
    ├── __tests__/              Jest suite mirroring src/
    └── README.md               Android setup, native build notes
```

`app/websocket/` and a top-level `shared/` directory were part of early
planning but were never created: Version 1's only real-time need is
transfer progress, which polling already satisfies (§6 above), and no
resource has yet needed cross-component shared assets beyond what already
lives in `docs/`.

---

# 12. Naming Conventions

Directory names: lowercase, descriptive, singular where appropriate.
Python: modules `snake_case`, classes `PascalCase`, functions
`snake_case`, constants `UPPER_CASE`.

---

# 13. Structure Rules

* Do not create unnecessary folders or duplicate functionality.
* Keep related files together; respect separation of concerns.
* Follow the existing directory structure; if a new top-level folder is
  genuinely required, explain why before creating it.
* No application code belongs at the repository root or inside `docs/`.
