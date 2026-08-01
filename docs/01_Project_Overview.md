# Relay Project Overview

Version: 1.0

---

# 1. Introduction

Relay is a local-first file transfer application that enables users to securely transfer files between a Windows computer and an Android phone.

Unlike cloud-based file sharing services, Relay performs all communication directly between paired devices on the same local network or mobile hotspot.

No files are uploaded to external servers.

---

# 2. Purpose

Relay exists to solve a common problem:

A user has a file on one device and wants it on another device quickly, without relying on:

* WhatsApp
* Google Drive
* Telegram
* Email
* USB cables
* Internet connectivity

Relay should provide a simple solution that works entirely within the local network.

---

# 3. Target Users

Relay is intended for:

* Students
* Professionals
* Developers
* General users
* Anyone who frequently transfers files between a PC and an Android phone

No technical knowledge should be required to use the application.

---

# 4. Core Principles

Relay should always be:

* Fast
* Secure
* Local-first
* Simple
* Reliable
* Easy to understand

The user should never need to think about networking details.

---

# 5. High-Level Workflow

The expected user experience is:

1. Open Relay on both devices.
2. The Windows application becomes discoverable.
3. The Android app detects available devices on the local network.
4. The user pairs the devices using a QR code.
5. Pairing is confirmed on both devices.
6. The user selects files to share.
7. The receiving device requests the selected files.
8. Files are transferred directly over the local connection.
9. Transfer progress is displayed in real time.
10. The transfer completes successfully.

---

# 6. Functional Requirements

Version 1 must support:

* Device discovery
* Secure pairing
* File selection
* File transfer
* Transfer progress
* Multiple file transfers
* Transfer cancellation
* Device management
* Transfer history
* Error reporting

---

# 7. Non-Functional Requirements

Relay should prioritize:

## Performance

* Fast transfer speeds on local networks
* Minimal startup time
* Low memory usage
* Low CPU usage

---

## Reliability

Transfers should:

* Complete successfully
* Recover gracefully from common errors
* Report failures clearly

---

## Security

Relay should:

* Require explicit pairing
* Prevent unauthorized transfers
* Never expose files without user approval
* Keep all communication within the local network

---

## Maintainability

The codebase should:

* Be modular
* Be well documented
* Follow consistent coding standards
* Be easy to extend

---

# 8. User Experience Goals

The application should feel:

* Clean
* Responsive
* Minimal
* Modern
* Predictable

Users should be able to complete a file transfer with as few steps as possible.

---

# 9. Future Expansion

Although Version 1 focuses on Windows and Android, the architecture should allow future support for:

* macOS
* Linux
* iOS
* Folder synchronization
* Clipboard sharing
* Text sharing
* File preview
* Background transfers
* Multiple connected devices

These features are not part of Version 1.

---

# 10. Project Success

Relay succeeds when a user can:

* Discover another device.
* Pair securely.
* Transfer files quickly.
* Complete the transfer without using any cloud service.
* Repeat the process with minimal effort.

The application should provide a dependable and straightforward alternative to internet-based file sharing.
