# Architecture Decisions

Version: 1.0

---

# Purpose

This document records important architectural decisions made during the development of Relay.

Every significant decision should include:

* The decision
* The reasoning
* The alternatives considered
* The trade-offs
* The date (optional)

This document serves as the project's long-term architectural memory.

Claude Code should always respect existing decisions unless explicitly instructed to change them.

---

# ADR-001

## Decision

Project Architecture

## Choice

Layered Architecture

## Reason

A layered architecture provides:

* Clear separation of concerns
* Better maintainability
* Easier testing
* Cleaner project organization

## Alternatives Considered

* Monolithic application without layers
* Clean Architecture
* Hexagonal Architecture

## Why This Was Chosen

Layered architecture offers the best balance between simplicity and scalability for Version 1.

---

# ADR-002

## Decision

Backend Framework

## Choice

FastAPI

## Reason

FastAPI provides:

* Excellent performance
* Automatic API documentation
* Strong typing
* Modern asynchronous support
* Excellent Python ecosystem

## Alternatives Considered

* Flask
* Django

## Why This Was Chosen

FastAPI aligns well with the project's goals and future scalability.

---

# ADR-003

## Decision

Desktop Application

## Choice

Electron

## Reason

Electron provides:

* Mature ecosystem
* Easy desktop deployment
* Strong community support
* Cross-platform potential

## Alternatives Considered

* Tauri
* PySide6
* Tkinter

## Why This Was Chosen

Electron offers the best balance between ecosystem maturity and future flexibility.

---

# ADR-004

## Decision

Android Framework

## Choice

React Native

## Reason

React Native provides:

* Large ecosystem
* Cross-platform potential
* Strong community support
* Native device capabilities

## Alternatives Considered

* Native Android (Kotlin)
* Flutter

## Why This Was Chosen

It provides flexibility for future platform expansion while remaining well supported.

---

# ADR-005

## Decision

Database

## Choice

SQLite

## Reason

Version 1 is designed for a single desktop installation.

SQLite:

* Requires no server
* Is lightweight
* Is reliable
* Is easy to deploy

## Alternatives Considered

* PostgreSQL
* MySQL

## Why This Was Chosen

SQLite is sufficient for Version 1 and keeps deployment simple.

---

# ADR-006

## Decision

Communication Model

## Choice

Local-First Networking

## Reason

Relay should function without:

* Internet
* Cloud servers
* Third-party services

Communication occurs directly between paired devices on the local network.

## Alternatives Considered

* Cloud relay
* Peer-to-peer over the internet

## Why This Was Chosen

Privacy, speed, and simplicity.

---

# ADR-007

## Decision

Project Development

## Choice

AI-Assisted Development with Claude Code

## Reason

Claude Code is used as a software engineering assistant.

The developer remains responsible for:

* Architecture
* Code review
* Testing
* Final technical decisions

## Why This Was Chosen

This approach combines rapid development with human oversight and learning.

---

# ADR-008

## Decision

Documentation Strategy

## Choice

Documentation-First Development

## Reason

The project specifications are written before implementation begins.

This provides Claude Code with stable project context and reduces architectural drift.

---

# ADR-009

## Decision

Version Control

## Choice

Git

## Reason

Development proceeds through small, reviewable milestones.

Each completed milestone should result in a logical Git commit before moving to the next feature.

---

# ADR-010

## Decision

Device Discovery Protocol

## Choice

UDP Broadcast

## Reason

The desktop backend broadcasts a periodic, credential-free announcement to
the LAN broadcast address on a fixed port; Android listens for it. This
requires no manual configuration, matching `docs/09_Networking.md` §4, and
needs no new inbound firewall rule beyond the one the API's own TCP port
already needs, since the broadcast is one-directional (the desktop never
listens for a reply).

## Alternatives Considered

* mDNS/Zeroconf — richer service discovery, but pulls in an extra
  dependency and behaves inconsistently across Windows and Android without
  clear Version 1 benefit over a simple broadcast.
* Manual IP entry only — no discovery at all; rejected as a fallback rather
  than the primary mechanism, since `docs/09_Networking.md` §4 requires no
  manual configuration wherever possible.

## Why This Was Chosen

UDP broadcast is simpler to implement, test, and reason about than
mDNS/Zeroconf, while still satisfying every requirement in
`docs/09_Networking.md` §4 for Version 1's supported networks (§3: home
Wi-Fi, office LAN, mobile hotspot). See `backend/README.md`
("Device Discovery Infrastructure") for the implementation.

---

# Future Decisions

Additional ADRs should be added as new architectural choices are made.

Examples:

* Authentication mechanism
* QR pairing implementation
* File transfer protocol
* Encryption strategy
* Logging framework
* Packaging strategy
* Deployment process

Each new decision should follow the same format used above.
