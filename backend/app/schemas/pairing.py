"""Request/response schemas for the /pairing endpoints.

PairingService itself works with plain arguments and the dataclasses in
app.services.pairing_manager (RequestingDeviceInfo, ApprovedResult) rather
than schema objects, matching how DeviceService methods take plain
arguments. These schemas exist only at the API boundary: to validate
incoming requests and to serialize those dataclasses/attempts for HTTP
responses.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.enums import Platform


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


class PairingStartResponse(BaseModel):
    """Response for POST /pairing/start: the QR payload plus the attempt's expiry."""

    qr: PairingQrPayload
    expires_at: datetime


class PairingRequestSubmitRequest(BaseModel):
    """Payload for POST /pairing/request, submitted by a scanning Android device.

    Validates structure and type only. The non-empty device_name rule is
    enforced by PairingService.submit_pairing_request, not duplicated here.
    """

    pairing_token: str
    device_identifier: str
    device_name: str
    platform: Platform


class NameConflictResponse(BaseModel):
    """A live P43.1 name collision: `device_name` above already belongs to a
    different, already-paired device (identified here so the Desktop can show
    both names in its Replace/Make-it-a-new-device dialog)."""

    existing_device_id: int
    existing_device_name: str


class PairingPendingRequestResponse(BaseModel):
    """Response for GET /pairing/pending/{token}: the requesting device's info,
    for the desktop user to review before approving or rejecting, plus a live
    P43.1 name-collision check (null when there is none, or when the request
    is actually a P43 re-pair of a known device_identifier).
    """

    device_identifier: str
    device_name: str
    platform: Platform
    name_conflict: NameConflictResponse | None = None


class PairingApproveRequest(BaseModel):
    """Payload for POST /pairing/approve.

    name_conflict_action resolves a P43.1 name collision the Desktop learned
    about from GET /pairing/pending/{token}'s name_conflict field — "replace"
    or "make_new". Left unset for an ordinary approval with no collision;
    ignored entirely when the request turns out to be a P43 re-pair (a known
    device_identifier always takes precedence over any name collision).
    """

    pairing_token: str
    name_conflict_action: Literal["replace", "make_new"] | None = None


class PairingRejectRequest(BaseModel):
    """Payload for POST /pairing/reject."""

    pairing_token: str


class PairingResultResponse(BaseModel):
    """Response for GET /pairing/result/{token}: one-time credentials for the
    newly paired Android device. Collected exactly once, per 10_Security.md §6.
    """

    model_config = ConfigDict(from_attributes=True)

    device_id: int
    device_identifier: str
    device_name: str
    device_secret: str
    session_token: str
    session_expires_at: datetime
