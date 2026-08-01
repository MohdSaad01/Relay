# Project Structure

Version: 1.0

---

# 1. Purpose

This document defines the official directory structure for the Relay project.

Claude Code should follow this structure unless explicitly instructed otherwise.

The goal is to keep the repository organized, predictable, and maintainable.

---

# 2. Repository Structure

```text
Relay/
│
├── CLAUDE.md
├── README.md
├── .gitignore
├── requirements.txt
├── package.json
│
├── docs/
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── database/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── repositories/
│   │   ├── utils/
│   │   ├── websocket/
│   │   └── main.py
│   │
│   └── tests/
│
├── desktop/
│   ├── src/
│   ├── assets/
│   ├── styles/
│   └── package.json
│
├── android/
│
├── shared/
│
└── scripts/
```

---

# 3. Root Directory

The root directory should contain only project-wide files.

Examples:

* CLAUDE.md
* README.md
* .gitignore
* requirements.txt
* package.json

No feature-specific code should exist at the repository root.

---

# 4. Documentation

The `docs/` directory contains:

* Specifications
* Architecture
* API documentation
* Design decisions
* Development workflow

No application code belongs here.

---

# 5. Backend

The `backend/` directory contains the FastAPI application.

Responsibilities include:

* Business logic
* REST API
* WebSocket support
* Authentication
* Database access
* File transfer
* Logging

---

# 6. Backend App

`backend/app/`

Contains all backend source code.

Subdirectories should remain focused on a single responsibility.

---

# 7. API

`backend/app/api/`

Contains:

* API routes
* Endpoint definitions
* Request handling

No business logic should exist here.

---

# 8. Core

`backend/app/core/`

Contains:

* Configuration
* Security
* Constants
* Application startup
* Shared infrastructure

---

# 9. Database

`backend/app/database/`

Contains:

* Database initialization
* Session management
* Database configuration

---

# 10. Models

`backend/app/models/`

Contains SQLAlchemy models only.

Models should represent database tables.

---

# 11. Schemas

`backend/app/schemas/`

Contains Pydantic models.

Used for:

* Requests
* Responses
* Validation

---

# 12. Services

`backend/app/services/`

Contains business logic.

Services coordinate workflows.

They should not directly depend on API endpoints.

---

# 13. Repositories

`backend/app/repositories/`

Responsible for database access.

Services communicate with repositories rather than SQLAlchemy directly.

---

# 14. Utilities

`backend/app/utils/`

Contains reusable helper functions.

Avoid placing business logic here.

---

# 15. WebSocket

`backend/app/websocket/`

Contains:

* WebSocket endpoints
* Connection manager
* Event broadcasting

---

# 16. Tests

`backend/tests/`

Contains:

* Unit tests
* Integration tests

Tests should mirror the application structure whenever practical.

---

# 17. Desktop

The desktop application lives inside:

```text
desktop/
```

Responsibilities:

* User interface
* Backend communication
* File management UI
* Transfer progress
* Device management

No backend business logic should exist here.

---

# 18. Android

The Android client lives inside:

```text
android/
```

Responsibilities:

* Pairing
* Device discovery
* File browsing
* Uploads
* Downloads
* Transfer progress

Business logic should remain inside the backend whenever practical.

---

# 19. Shared

The `shared/` directory contains resources used by multiple components.

Examples:

* Shared constants
* Icons
* Common assets
* Shared documentation

Avoid duplicating resources across projects.

---

# 20. Scripts

The `scripts/` directory contains development utilities.

Examples:

* Setup scripts
* Build helpers
* Development automation
* Release scripts

---

# 21. Naming Conventions

Directory names:

* lowercase
* descriptive
* singular where appropriate

Python modules:

* snake_case

Classes:

* PascalCase

Functions:

* snake_case

Constants:

* UPPER_CASE

---

# 22. Structure Rules

Claude Code must follow these rules:

* Do not create unnecessary folders.
* Do not duplicate functionality.
* Keep related files together.
* Respect separation of concerns.
* Follow the existing directory structure.
* If a new folder is required, explain why before creating it.
