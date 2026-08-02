"""Network helpers."""

import socket


def get_local_ip_address() -> str:
    """Best-effort detection of this machine's LAN IPv4 address.

    Opens a UDP socket toward a public address without sending any traffic,
    purely so the OS selects an outbound interface, then reads the local
    address it bound to. Falls back to loopback if no network is reachable.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def get_broadcast_address() -> str:
    """Return the UDP address device-discovery announcements are broadcast to.

    Always the limited broadcast address ("255.255.255.255") for Version 1
    (09_Networking.md §4, Device Discovery milestone) — simpler and more
    portable across Windows/Android than computing a subnet-directed
    broadcast address per network interface. Kept as its own function so a
    future milestone could compute an interface-specific address without
    changing DiscoveryService.
    """
    return "255.255.255.255"
