# Architecture Decisions

Version: 1.0 — condensed.

---

# Purpose

This document records significant architectural decisions made during
Relay's development: the decision, the reasoning, alternatives considered,
and trade-offs. It is the project's long-term architectural memory.
Claude Code should always respect existing decisions unless explicitly
instructed to change them.

---

# ADR-001 — Project Architecture: Layered Architecture

Chosen over a monolithic (no-layers) design, Clean Architecture, or
Hexagonal Architecture. A layered architecture (see `docs/02_Architecture.md`
§4 for the concrete `API → Service → Repository → Models` split actually
built) gives the best balance of separation of concerns, maintainability,
and testability against simplicity for Version 1.

---

# ADR-002 — Backend Framework: FastAPI

Chosen over Flask and Django for performance, automatic API documentation,
strong typing, and modern async support — the best fit for the project's
goals and future scalability.

---

# ADR-003 — Desktop Application: Electron

Chosen over Tauri, PySide6, and Tkinter for ecosystem maturity, easy
desktop deployment, strong community support, and cross-platform
potential.

---

# ADR-004 — Android Framework: React Native

Chosen over native Android (Kotlin) and Flutter for its large ecosystem,
cross-platform potential, and native device capabilities, while keeping
future platform expansion open.

---

# ADR-005 — Database: SQLite

Chosen over PostgreSQL and MySQL. Version 1 targets a single desktop
installation, where SQLite's lack of a server requirement, light weight,
and reliability keep deployment simple. See `docs/13_Database_Design.md`
for the schema this produced.

---

# ADR-006 — Communication Model: Local-First Networking

Chosen over a cloud relay or peer-to-peer-over-internet model. Relay
functions without internet, cloud servers, or third-party services —
communication occurs directly between paired devices on the local
network — for privacy, speed, and simplicity.

---

# ADR-007 — Project Development: AI-Assisted Development with Claude Code

Claude Code is used as a software engineering assistant; the developer
remains responsible for architecture, code review, testing, and final
technical decisions. This combines rapid development with human oversight
and learning.

---

# ADR-008 — Documentation Strategy: Documentation-First Development

Project specifications are written before implementation begins, giving
Claude Code stable project context and reducing architectural drift.

---

# ADR-009 — Version Control: Git

Development proceeds through small, reviewable milestones; each completed
milestone results in a logical Git commit before moving to the next
feature.

---

# ADR-010 — Device Discovery Protocol: UDP Broadcast

## Decision

The desktop backend broadcasts a periodic, credential-free announcement to
the LAN broadcast address on a fixed port; Android listens for it. This
requires no manual configuration, matching `docs/09_Networking.md` §4, and
needs no new inbound firewall rule beyond the one the API's own TCP port
already needs, since the broadcast is one-directional (the desktop never
listens for a reply).

## Alternatives Considered

* **mDNS/Zeroconf** — richer service discovery, but pulls in an extra
  dependency and behaves inconsistently across Windows and Android without
  clear Version 1 benefit over a simple broadcast.
* **Manual IP entry only** — no discovery at all; rejected as a fallback
  rather than the primary mechanism, since `docs/09_Networking.md` §4
  requires no manual configuration wherever possible.

## Why This Was Chosen

UDP broadcast is simpler to implement, test, and reason about than
mDNS/Zeroconf, while satisfying every requirement in `docs/09_Networking.md`
§4 for Version 1's supported networks (home Wi-Fi, office LAN, mobile
hotspot). See `backend/README.md` ("Device Discovery Infrastructure") for
the implementation.

---

# Future Decisions

Additional ADRs should be added as new architectural choices are made —
for example, an encryption strategy or a packaging/deployment process —
following the same format used above.
