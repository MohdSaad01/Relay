# Relay Project Overview

Version: 1.0 — consolidated from the former `00_Project_Charter.md` and
`01_Project_Overview.md`, which covered the same ground with no meaningful
differences.

---

# 1. Vision

Relay is a local-first file transfer application for Windows and Android.
It lets a user send files directly between a Windows computer and an
Android phone over the same local Wi-Fi network or a mobile hotspot —
without cloud storage, messaging apps, USB cables, or internet-based
services. All communication happens directly between paired devices.

---

# 2. Problem Statement

Common ways to move a file between a computer and a phone — WhatsApp Web,
Google Drive, OneDrive, Telegram, email, USB cable — share the same
drawbacks: they require internet access, upload the file to a third-party
server, are slower than a direct local transfer, or add unnecessary
friction. Relay solves this with direct device-to-device communication.

---

# 3. Target Users

Anyone who frequently moves files between a PC and an Android phone —
students, professionals, developers, general users. No technical knowledge
should be required to use the application.

---

# 4. Core Principles

Relay should always be fast, secure, local-first, simple, reliable, and
easy to understand. The user should never need to think about networking
details.

---

# 5. Version 1 Scope

**In scope:**

* Windows desktop application and Android application
* Local device discovery and QR-code pairing
* Secure pairing confirmation
* File upload/download, multiple-file support, transfer progress
* Shared files list, device management, basic transfer history
* Logging and error handling

**Out of scope for Version 1** (may be considered later):

* Cloud synchronization, user accounts, internet-based transfers
* End-to-end encrypted relay servers, group sharing
* Multiple simultaneous desktop clients
* iOS, Linux, or macOS support
* Automatic backups, file versioning, collaborative sharing
* Background synchronization across the internet

---

# 6. High-Level Workflow

1. Open Relay on both devices; the Windows app becomes discoverable.
2. Android detects available desktops on the local network, or the user
   scans a QR code.
3. The user pairs the devices; pairing is confirmed on both sides.
4. The user selects files to share; the receiving device requests them.
5. Files transfer directly over the local connection with visible progress.
6. The transfer completes.

---

# 7. Functional Requirements

Version 1 must support: device discovery, secure pairing, file selection,
file transfer (single and multiple files), transfer progress, transfer
cancellation, device management, transfer history, and error reporting.

---

# 8. Non-Functional Requirements

* **Performance** — fast transfer speeds on local networks, minimal
  startup time, low memory/CPU usage.
* **Reliability** — transfers complete successfully, recover gracefully
  from common errors, and report failures clearly.
* **Security** — require explicit pairing, prevent unauthorized transfers,
  never expose files without user approval, keep all communication within
  the local network.
* **Maintainability** — modular, well-documented, consistent, easy to
  extend.
* **User experience** — clean, responsive, minimal, modern, predictable;
  as few steps as possible to complete a transfer.

---

# 9. Success Criteria

Version 1 is complete when: Windows and Android devices pair successfully;
devices discover each other on the local network; files transfer reliably
and survive normal network latency; progress is visible; errors are
handled gracefully; the application is stable; documentation is complete.

A user should be able to discover another device, pair securely, transfer
files quickly, and repeat the process with minimal effort — entirely
without a cloud service.

---

# 10. Future Expansion (Not Version 1)

The architecture should allow future support for macOS, Linux, iOS, folder
synchronization, clipboard/text sharing, file preview, background
transfers, and multiple connected devices. None of these are part of
Version 1.

---

# 11. Development Principles

Prioritize simplicity, readability, reliability, maintainability, and
testability over unnecessary complexity. Prefer well-known, stable
solutions over experimental ones.

---

# 12. AI-Assisted Development

Relay is intentionally developed with AI assistance using Claude Code,
treated as a software engineering assistant rather than an autonomous
developer. All generated code should be reviewed, understood, tested, and
validated. Architecture and technical direction remain under developer
control (see `CLAUDE.md` for the operating rules this implies).

---

# 13. Milestones & Definition of Done

Development proceeds in small milestones. Each milestone must have a clear
objective, be independently testable, compile successfully, and avoid
introducing unrelated features. No milestone continues automatically into
the next without review.

A milestone is complete only when: implementation is finished, code is
readable, the project builds, tests pass, documentation is updated, and a
Git commit can be created.

See `CLAUDE.md` for the actual per-milestone history and current project
status, and `docs/14_Testing_Plan.md` for validation status.
