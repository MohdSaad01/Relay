"""Request/response schemas for the /transfers and /transfers/requests endpoints.

TransferService itself works with plain arguments and the
PendingTransferRequest dataclass in app.services.transfer_manager, matching
how PairingService relates to app/schemas/pairing.py. These schemas exist
only at the API boundary: to validate incoming requests and to serialize
PendingTransferRequest/Transfer for HTTP responses.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import TransferDirection, TransferStatus
from app.services.transfer_manager import TransferRequestStatus


class TransferRequestCreate(BaseModel):
    """Payload for POST /transfers/requests, submitted by a paired Android device.

    Validates structure and type only. The direction-dependent field rules
    (shared_file_id required for `send`, file_name/file_size required for
    `receive`) are enforced by TransferService, not duplicated here.
    """

    direction: TransferDirection
    shared_file_id: int | None = None
    file_name: str | None = None
    file_size: int | None = None


class TransferRequestResponse(BaseModel):
    """Response for the /transfers/requests endpoints: a pending or
    already-decided transfer request, before any Transfer database row exists.
    """

    model_config = ConfigDict(from_attributes=True)

    request_id: str
    direction: TransferDirection
    status: TransferRequestStatus
    device_id: int
    device_name: str
    shared_file_id: int | None
    file_name: str
    file_size: int
    created_at: datetime
    expires_at: datetime
    transfer_id: int | None


class TransferResponse(BaseModel):
    """Response for the /transfers endpoints: a persisted Transfer row."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int | None
    shared_file_id: int | None
    direction: TransferDirection
    file_name: str
    file_size: int
    device_name: str
    status: TransferStatus
    bytes_transferred: int
    failure_reason: str | None
    started_at: datetime
    completed_at: datetime | None
