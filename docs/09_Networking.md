# Networking Specification

Version: 1.0

---

# 1. Purpose

This document defines the networking requirements for Relay Version 1.

Relay is a local-first application. All communication occurs directly between devices on the same local network or mobile hotspot.

No internet connection or cloud infrastructure is required.

---

# 2. Networking Goals

The networking layer should be:

* Fast
* Reliable
* Secure
* Simple
* Easy to maintain

---

# 3. Supported Networks

Version 1 supports:

* Home Wi-Fi
* Office LAN
* Mobile Hotspots

Version 1 does not support:

* Internet relay
* Bluetooth
* NFC
* USB
* Cellular data without a shared local network

---

# 4. Device Discovery Requirements

Relay must allow devices to discover each other automatically whenever possible.

The discovery mechanism should:

* Require no manual configuration.
* Operate entirely on the local network.
* Discover only Relay-enabled devices.
* Be reliable on common home networks.

The specific discovery technology (such as mDNS/Zeroconf or UDP broadcast) will be selected during the **Device Discovery milestone** after evaluating the available options.

---

# 5. Communication

Version 1 uses:

* REST APIs for request/response communication.
* WebSockets for real-time events.

No proprietary networking protocol should be created unless a clear technical need exists.

---

# 6. Network Topology

The Windows desktop application hosts the Relay backend.

Android devices connect directly to the desktop backend over the local network.

The desktop acts as the server for Version 1.

---

# 7. Ports

The backend should expose a configurable port.

The default development port may be:

```text
8000
```

The implementation should avoid hardcoding port values where practical.

---

# 8. Connection Workflow

Typical communication flow:

1. Desktop starts the backend.
2. Desktop advertises availability using the selected discovery mechanism.
3. Android discovers available Relay instances.
4. User selects a desktop.
5. Pairing begins.
6. Authentication succeeds.
7. File operations become available.

---

# 9. Network Reliability

Relay should gracefully handle:

* Temporary disconnects
* Backend restarts
* Lost connections
* Network timeouts

Errors should be communicated clearly to the user.

---

# 10. Firewall Considerations

If the operating system blocks incoming connections, Relay should detect the problem and explain how the user can allow access.

Relay must never modify firewall settings automatically.

---

# 11. Performance

Networking should prioritize:

* Low latency
* Minimal overhead
* Efficient file streaming
* Stable long-running transfers

Large files should be streamed instead of loaded entirely into memory.

---

# 12. Future Expansion

Future versions may introduce:

* Manual IP connection
* Multiple desktop hosts
* Internet relay
* IPv6 improvements
* Cross-network communication

These features are outside the scope of Version 1.

---

# 13. Networking Rules

Claude Code should:

* Prefer well-established networking libraries over custom implementations.
* Keep networking logic isolated from business logic.
* Avoid assumptions about discovery technology until the corresponding milestone.
* Explain the advantages and disadvantages of the proposed discovery mechanism before implementation.
