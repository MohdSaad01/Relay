# Relay Project Charter

Version: 1.0

---

# 1. Project Vision

Relay is a local-first file transfer application for Windows and Android.

Its purpose is to provide a fast, secure, and simple way to transfer files directly between a Windows computer and an Android phone without relying on cloud storage, messaging applications, USB cables, or internet-based services.

All communication should occur directly between paired devices on the same local network or mobile hotspot.

---

# 2. Problem Statement

Current methods for transferring files between a computer and a phone usually require one of the following:

* WhatsApp Web
* Google Drive
* OneDrive
* Telegram
* Email
* USB cable

These solutions either:

* require internet access
* upload files to third-party servers
* are slower than a local transfer
* introduce unnecessary friction

Relay aims to solve this by providing direct device-to-device communication.

---

# 3. Project Goals

The primary goals are:

* Fast local file transfer
* Secure device pairing
* Clean and intuitive user interface
* Simple installation
* Reliable transfers
* Maintainable architecture
* Modular codebase
* Cross-platform communication between Windows and Android

---

# 4. Version 1 Scope

Version 1 will include:

* Windows desktop application
* Android application
* Local device discovery
* QR-code pairing
* Secure pairing confirmation
* File upload
* File download
* Transfer progress
* Multiple file support
* Shared files list
* Device management
* Basic transfer history
* Logging
* Error handling

---

# 5. Out of Scope (Version 1)

The following features will NOT be implemented in Version 1:

* Cloud synchronization
* User accounts
* Internet-based transfers
* End-to-end encrypted relay servers
* Group sharing
* Multiple simultaneous desktop clients
* iOS support
* Linux support
* macOS support
* Automatic backups
* File versioning
* Collaborative sharing
* Background synchronization across the internet

These may be considered in future versions.

---

# 6. Success Criteria

Version 1 will be considered complete when:

* Windows and Android devices can pair successfully.
* Devices discover each other on the local network.
* Files transfer reliably.
* Transfers survive normal network latency.
* Progress is visible to users.
* Errors are handled gracefully.
* The application is stable.
* Documentation is complete.

---

# 7. Development Principles

Development should prioritize:

* Simplicity
* Readability
* Reliability
* Maintainability
* Testability

Avoid unnecessary complexity.

Prefer well-known, stable solutions over experimental ones.

---

# 8. AI-Assisted Development

Relay is intentionally being developed with AI assistance using Claude Code.

AI should be treated as a software engineering assistant rather than an autonomous developer.

All generated code should be:

* reviewed
* understood
* tested
* validated

Architecture and technical direction remain under developer control.

---

# 9. Milestones

Development will proceed in small milestones.

Each milestone must:

* have a clear objective
* be independently testable
* compile successfully
* avoid introducing unrelated features

No milestone should automatically continue into the next without review.

---

# 10. Definition of Done

A milestone is complete only when:

* Implementation is finished.
* Code is readable.
* Project builds successfully.
* Tests pass.
* Documentation is updated.
* A Git commit can be created.
