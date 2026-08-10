# Networking Specification

Version: 1.0 — condensed. Section numbers are unchanged from the original
(cross-referenced by number elsewhere, notably `backend/README.md`,
`CLAUDE.md`, and `08_Architecture_Decisions.md` ADR-010).

---

# 1. Purpose

Relay is local-first: all communication occurs directly between devices on
the same local network or mobile hotspot. No internet connection or cloud
infrastructure is required.

---

# 2. Networking Goals

The networking layer should be fast, reliable, secure, simple, and easy to
maintain.

---

# 3. Supported Networks

Supported: home Wi-Fi, office LAN, mobile hotspots. Not supported:
internet relay, Bluetooth, NFC, USB, or cellular data without a shared
local network.

---

# 4. Device Discovery Requirements

Devices must discover each other automatically wherever possible: no
manual configuration, entirely on the local network, discovering only
Relay-enabled devices, reliable on common home networks.

**Decision (Device Discovery milestone):** UDP broadcast, not
mDNS/Zeroconf. The desktop backend broadcasts a periodic, credential-free
announcement (protocol version, Relay version, instance id, device display
name, desktop IP, and port) to the LAN broadcast address on a fixed port,
and Android listens for it — no extra runtime dependency, and simpler to
reason about and test than resolving mDNS/Zeroconf across Windows and
Android. The one-directional nature of the broadcast — the desktop never
listens for a reply — means there is no new inbound firewall rule beyond
the one the API's own TCP port already needs (§10), and no listening
socket that could be flooded. Whether broadcasting is currently active is
a user-editable preference (`app_settings.discovery_enabled`); the desktop
can check the broadcaster's live status via `GET /discovery/status`. See
`backend/README.md` ("Device Discovery Infrastructure") for the
implementation, and `08_Architecture_Decisions.md` ADR-010 for the
alternatives considered.

---

# 5. Communication

REST APIs for request/response communication. No proprietary networking
protocol unless a clear technical need exists. (An earlier design also
considered WebSockets for real-time events; Version 1 does not use them —
see `docs/05_API_Design.md` §10.)

---

# 6. Network Topology

The Windows desktop application hosts the Relay backend; Android devices
connect directly to it over the local network. The desktop acts as the
server for Version 1.

---

# 7. Ports

The backend exposes a configurable port (default development port:
`8000`). Avoid hardcoding port values where practical.

---

# 8. Connection Workflow

1. Desktop starts the backend.
2. Desktop advertises availability via UDP broadcast (§4).
3. Android discovers available Relay instances.
4. User selects a desktop.
5. Pairing begins and authentication succeeds.
6. File operations become available.

---

# 9. Network Reliability

Relay should gracefully handle temporary disconnects, backend restarts,
lost connections, and network timeouts, with errors communicated clearly
to the user.

---

# 10. Firewall Considerations

If the OS blocks incoming connections, Relay should detect the problem and
explain how the user can allow access. Relay must never modify firewall
settings automatically.

---

# 11. Performance

Prioritize low latency, minimal overhead, efficient file streaming, and
stable long-running transfers. Large files are streamed instead of loaded
entirely into memory.

---

# 12. Future Expansion

Outside Version 1's scope: manual IP connection, multiple desktop hosts,
internet relay, IPv6 improvements, cross-network communication.

---

# 13. Networking Rules

Claude Code should prefer well-established networking libraries over
custom implementations, keep networking logic isolated from business
logic, avoid assumptions about discovery technology until the
corresponding milestone, and explain the advantages/disadvantages of a
proposed discovery mechanism before implementation.
