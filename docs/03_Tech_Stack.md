# Technology Stack

Version: 1.0 — condensed.

---

# 1. Purpose & Guiding Principles

This document defines the official technology stack for Relay Version 1.
Unless explicitly instructed, these technologies should not be replaced
during development. Choices prioritize stability, maintainability,
developer productivity, community support, and ease of learning over
novelty.

---

# 2. The Stack

| Layer | Choice | Why |
|---|---|---|
| Desktop framework | **Electron** | Native Windows desktop app, mature ecosystem, easy backend integration, future cross-platform potential. |
| Desktop UI | **HTML / CSS / JavaScript** | No frontend framework (React, Vue, Angular) in Version 1 — kept lightweight and easy to understand. |
| Backend language | **Python 3.13+** | — |
| Backend framework | **FastAPI** | Performance, automatic OpenAPI docs, type safety, modern async support. |
| API style | **REST**, versioned under `/api/v1` | See `docs/05_API_Design.md`. WebSockets were considered for real-time events but are not used in V1 — see that document §11. |
| Database | **SQLite** | Version 1 targets a single desktop installation: no server, no configuration, minimal maintenance. Architecture allows future migration to PostgreSQL (`08_Architecture_Decisions.md` ADR-005). |
| ORM | **SQLAlchemy** | Separates business logic from database implementation; simplifies a future DB migration. |
| Validation | **Pydantic** | Request/response validation, type checking, automatic serialization. |
| ASGI server | **Uvicorn** | Standard production-ready server for FastAPI. |
| Android framework | **React Native** (TypeScript) | Mature ecosystem, cross-platform potential, native device access. Android only in Version 1. |

---

# 3. Networking

Communication occurs over local Wi-Fi, mobile hotspot, or private LAN
only. Internet connectivity is not required or used.

---

# 4. File Transfer

Files are streamed — never loaded completely into memory — with support
for progress updates, cancellation, and error recovery. See
`docs/11_File_Transfer.md`.

---

# 5. Authentication

Version 1 uses secure device pairing; authentication is based on trusted
paired devices. No online accounts. See `docs/10_Security.md`.

---

# 6. Development Tools

* **Primary:** Claude Code. **Secondary:** Visual Studio Code.
* **Version control:** Git.
* **Formatting/linting (Python):** Ruff. **Testing (Python):** Pytest.
* **Dependency management:** pip + venv (Python), npm (Node.js).
* **Logging:** Python `logging` module, structured where practical.
* **Configuration:** environment variables and config files — sensitive
  values are never hardcoded.

---

# 7. Technologies Not Used

Version 1 does **not** use: Flask, Django, PostgreSQL, MongoDB, Firebase,
Supabase, Docker, Kubernetes, Redis, GraphQL, or a microservices split.
These may be evaluated in future versions if requirements change.

---

# 8. Future Upgrades

The architecture should support, without a complete redesign: PostgreSQL,
native desktop packaging improvements, end-to-end encryption, and
cross-platform desktop/mobile support.

---

# 9. Technology Rules

Claude Code should not introduce additional frameworks, libraries, or
services without first explaining why they are needed, what problem they
solve, their advantages, and their trade-offs. Technology choices remain
consistent throughout the project unless explicitly approved otherwise.
