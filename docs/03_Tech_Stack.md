# Technology Stack

Version: 1.0

---

# 1. Purpose

This document defines the official technology stack for Relay Version 1.

Unless explicitly instructed, these technologies should not be replaced during development.

---

# 2. Guiding Principles

Technology choices prioritize:

* Stability
* Maintainability
* Developer productivity
* Large community support
* Long-term scalability
* Ease of learning

---

# 3. Desktop Application

## Framework

Electron

### Reason

Electron provides:

* Native Windows desktop application
* Large ecosystem
* Easy integration with backend services
* Mature tooling
* Future cross-platform support

---

## User Interface

HTML

CSS

JavaScript

### Reason

The UI should remain lightweight and easy to understand.

No frontend framework (React, Vue, Angular, etc.) will be used in Version 1.

---

# 4. Backend

## Language

Python 3.13+

---

## Framework

FastAPI

### Reason

FastAPI provides:

* Excellent performance
* Automatic API documentation
* Type safety
* Modern async support
* Strong developer experience

---

## API Style

REST API

WebSockets for real-time events where appropriate.

---

# 5. Database

SQLite

### Reason

Version 1 is designed for a single desktop installation.

SQLite requires:

* No database server
* No configuration
* Minimal maintenance

The architecture should allow migration to PostgreSQL in the future.

---

# 6. ORM

SQLAlchemy

### Reason

SQLAlchemy separates business logic from database implementation.

It also simplifies future database migrations.

---

# 7. Data Validation

Pydantic

### Reason

Pydantic provides:

* Request validation
* Response validation
* Type checking
* Automatic serialization

---

# 8. ASGI Server

Uvicorn

### Reason

Recommended production-ready server for FastAPI.

---

# 9. Android Application

Framework:

React Native

### Reason

* Mature ecosystem
* Cross-platform potential
* Good community support
* Native device access

Version 1 will target Android only.

---

# 10. Networking

Communication should occur over:

* Local Wi-Fi
* Mobile Hotspot
* Private LAN

Internet connectivity is not required.

---

# 11. File Transfer

Files should be streamed.

Large files should never be loaded completely into memory.

Transfers should support:

* Progress updates
* Cancellation
* Error recovery

---

# 12. Authentication

Version 1 should use secure device pairing.

Authentication should be based on trusted paired devices.

No online accounts are required.

---

# 13. Development Tools

Primary IDE

* Claude Code

Secondary IDE

* Visual Studio Code

Version Control

* Git

Operating System

* Windows

---

# 14. Code Quality

Formatting

* Ruff (Python)

Linting

* Ruff

Testing

* Pytest

---

# 15. Dependency Management

Python

* pip
* virtual environment (venv)

Node.js

* npm

---

# 16. Logging

Python logging module

Structured log messages where practical.

---

# 17. Configuration

Environment variables

Configuration files

Sensitive values should never be hardcoded.

---

# 18. Technologies Not Used

Version 1 will NOT use:

* Flask
* Django
* PostgreSQL
* MongoDB
* Firebase
* Supabase
* Docker
* Kubernetes
* Redis
* GraphQL
* Microservices

These may be evaluated in future versions if requirements change.

---

# 19. Future Upgrades

The architecture should support future migration to:

* PostgreSQL
* Native desktop packaging improvements
* End-to-end encryption
* Cross-platform desktop support
* Cross-platform mobile support

These upgrades should not require a complete redesign.

---

# 20. Technology Rules

Claude Code should not introduce additional frameworks, libraries, or services without first explaining:

* Why they are needed
* What problem they solve
* Their advantages
* Their trade-offs

Technology choices should remain consistent throughout the project unless explicitly approved.
