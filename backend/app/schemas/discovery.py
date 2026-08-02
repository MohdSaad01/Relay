"""Schemas for device discovery (09_Networking.md §4, Device Discovery milestone).

DiscoveryAnnouncePayload is not an HTTP schema — it is the JSON payload
DiscoveryService broadcasts over UDP. It is still modeled as a Pydantic class
for the same reason PairingQrPayload (app/schemas/pairing.py) is: consistent
validation and JSON serialization at the point data leaves the backend.
"""

from typing import Literal

from pydantic import BaseModel


class DiscoveryAnnouncePayload(BaseModel):
    """Broadcast every DISCOVERY_BROADCAST_INTERVAL_SECONDS while discovery is enabled.

    Contains no credentials, per 10_Security.md §5 — the same minimal-
    disclosure principle applied to PairingQrPayload, applied even more
    conservatively here since a broadcast is passively visible to every
    device on the LAN, not just someone who scans a displayed QR code.
    """

    type: Literal["relay_discovery_announce"] = "relay_discovery_announce"
    protocol_version: int
    relay_version: str
    instance_id: str
    device_display_name: str
    desktop_ip: str
    port: int


class DiscoveryStatusResponse(BaseModel):
    """Response for GET /discovery/status: read-only runtime broadcaster state.

    Reflects whether the broadcast thread is actually running, which can
    differ from app_settings.discovery_enabled if socket creation failed at
    startup (see DiscoveryService.start).
    """

    broadcasting: bool
    instance_id: str
    port: int
