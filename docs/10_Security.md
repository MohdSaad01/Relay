# Security Specification

Version: 1.0 — condensed. Section numbers are unchanged from the original
— heavily cross-referenced by number elsewhere (`backend/README.md`,
`CLAUDE.md`, `13_Database_Design.md`, `15_QA_NOTEBOOK.md`).

---

# 1. Purpose

Defines the security model for Relay Version 1: secure local file
transfers, kept simple and maintainable.

---

# 2. Security Principles

Relay requires explicit device pairing, never exposes shared files to
unknown devices, never requires cloud authentication, never transmits
sensitive information unnecessarily, and defaults to least privilege.

---

# 3. Threat Model

Defends against: accidental connections, unauthorized devices on the same
LAN, unauthorized file browsing/downloads. Does **not** defend against: a
fully compromised local machine, nation-state adversaries, or physical
access to an unlocked device.

---

# 4. Device Pairing

A device must be paired before it can access any protected endpoint.
Pairing requires explicit approval by the desktop user. Unpaired devices
may discover Relay but cannot browse files or initiate transfers.

---

# 5. QR Code

The QR code contains only what's needed to initiate pairing — desktop IP
address, backend port, temporary pairing identifier, protocol version —
deliberately no credentials. Authentication credentials are never embedded
in the QR code.

---

# 6. Pairing Token

When pairing begins, the desktop generates a temporary pairing token with
a short expiration, single-use, discarded after successful pairing. Not
persisted to the database — see `docs/13_Database_Design.md` §9.

---

# 7. Trusted Devices

Successfully paired devices become trusted; each receives a unique
identifier stored locally. Future requests must present valid credentials
associated with that trusted device.

---

# 8. Session Authentication

Authenticated requests use a session token issued after successful
pairing. Session tokens expire after a configurable period
(`app_settings.session_token_lifetime_minutes`, `docs/13_Database_Design.md`
§8), are renewable, and are invalidated if a device is removed.

---

# 9. Authorization

Even trusted devices only access endpoints appropriate to their
permissions; every request is validated before performing file
operations.

---

# 10. File Access

Relay never exposes the entire file system — only files intentionally
shared by the user are accessible, and directory traversal attacks must
be prevented.

---

# 11. Logging & Failure Responses

Security logs include pairing attempts, successful pairings, failed
authentication, and device removal — never session tokens, authentication
secrets, or sensitive file contents. Every authentication failure path
(missing, unknown, or expired token; a valid token for the wrong device)
returns the same generic error, so a caller can never use the response to
probe which case occurred; the specific cause is only ever logged
server-side. See `backend/README.md`'s authentication sections for where
this is enforced.

---

# 12. Transport Security

Version 1 uses HTTP over a trusted local network — an accepted design
decision to reduce implementation complexity. Future versions may
introduce HTTPS and end-to-end encryption without changing the overall
architecture.

---

# 13. Future Improvements

Outside Version 1's scope: TLS, end-to-end encryption, certificate
pinning, device revocation lists, mutual authentication, hardware-backed
key storage.

---

# 14. Security Rules

Claude Code should never hardcode secrets, never expose authentication
tokens, validate every protected request, follow least privilege, and
explain any security-related dependency before introducing it.
