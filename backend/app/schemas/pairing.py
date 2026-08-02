"""Pydantic schema for the pairing QR payload.

Other pairing request/response shapes (submitting a request, viewing a
pending request, collecting the result) are added alongside the pairing API
endpoints in a later step. PairingService currently works with plain
arguments and the dataclasses in app.services.pairing_manager, matching how
DeviceService methods take plain arguments rather than schema objects.
"""

from pydantic import BaseModel


class PairingQrPayload(BaseModel):
    """Data encoded into the QR code the desktop displays.

    Contains no credentials, per 10_Security.md §5 — only what an Android
    device needs to locate the desktop and begin the pairing handshake.
    """

    desktop_ip: str
    port: int
    pairing_token: str
    protocol_version: int
    relay_version: str
