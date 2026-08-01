# Security Specification

Version: 1.0

---

# 1. Purpose

This document defines the security model for Relay Version 1.

The objective is to provide secure local file transfers while keeping the implementation simple and maintainable.

---

# 2. Security Principles

Relay should:

* Require explicit device pairing.
* Never expose shared files to unknown devices.
* Never require cloud authentication.
* Never transmit sensitive information unnecessarily.
* Default to the principle of least privilege.

---

# 3. Threat Model

Version 1 is designed to defend against:

* Accidental connections
* Unauthorized devices on the same LAN
* Unauthorized file browsing
* Unauthorized file downloads

Version 1 does **not** attempt to defend against:

* A fully compromised local machine
* Nation-state adversaries
* Physical access to an unlocked device

---

# 4. Device Pairing

A device must be paired before it can access any protected endpoint.

Pairing requires explicit approval by the desktop user.

Unpaired devices may discover Relay but cannot browse files or initiate transfers.

---

# 5. QR Code

The QR code should **not** contain sensitive information.

It should contain only the information necessary to initiate pairing, such as:

* Desktop IP address
* Backend port
* Temporary pairing identifier
* Protocol version

Authentication credentials must never be embedded directly in the QR code.

---

# 6. Pairing Token

When pairing begins:

* The desktop generates a temporary pairing token.
* The token has a short expiration time.
* The token is single-use.
* After successful pairing, the token is discarded.

---

# 7. Trusted Devices

Successfully paired devices become trusted.

Each trusted device should receive a unique identifier stored locally.

Future requests must present valid credentials associated with that trusted device.

---

# 8. Session Authentication

Authenticated requests should use a session token issued after successful pairing.

Session tokens should:

* Expire after a configurable period.
* Be renewable.
* Be invalidated if a device is removed.

---

# 9. Authorization

Even trusted devices should only access endpoints appropriate to their permissions.

Every request should be validated before performing file operations.

---

# 10. File Access

Relay must never expose the entire file system.

Only files intentionally shared by the user are accessible.

Directory traversal attacks must be prevented.

---

# 11. Logging

Security logs should include:

* Pairing attempts
* Successful pairings
* Failed authentication
* Device removal

Logs must never contain:

* Session tokens
* Authentication secrets
* Sensitive file contents

---

# 12. Transport Security

Version 1 uses HTTP over a trusted local network.

This is an accepted design decision for Version 1 to reduce implementation complexity.

Future versions may introduce HTTPS and end-to-end encryption without changing the overall architecture.

---

# 13. Future Improvements

Potential future enhancements include:

* TLS
* End-to-end encryption
* Certificate pinning
* Device revocation lists
* Mutual authentication
* Hardware-backed key storage

These features are outside the scope of Version 1.

---

# 14. Security Rules

Claude Code should:

* Never hardcode secrets.
* Never expose authentication tokens.
* Validate every protected request.
* Follow the principle of least privilege.
* Explain any security-related dependency before introducing it.
