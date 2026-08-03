"""TransferService — orchestrates the transfer lifecycle described in
docs/11_File_Transfer.md §7 and docs/13_Database_Design.md §7: a paired
Android device proposes a transfer (downloading a shared file, or
proposing an upload), the desktop user accepts or rejects it, and only an
accepted request ever becomes a persisted `Transfer` row.

Persistence is delegated to existing services and repositories rather than
duplicated here: SharedFileService supplies the shared-file snapshot for a
download, DeviceRepository supplies the fresh device snapshot, and
TransferRepository owns `Transfer` rows. Pending-request state lives
entirely in TransferManager and is never written to the database
(13_Database_Design.md §7 has no "pending"/"rejected" transfer status).

This milestone does not implement byte streaming, so the only DB-level state
transition it performs is `in_progress -> cancelled`; `completed`/`failed`
belong to the future streaming milestone.
"""

import logging
from datetime import timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.device import Device
from app.models.enums import TransferDirection, TransferStatus
from app.models.transfer import Transfer
from app.repositories.device_repository import DeviceRepository
from app.repositories.transfer_repository import TransferRepository
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.shared_file_service import SharedFileService
from app.services.transfer_manager import (
    PendingTransferRequest,
    TransferManager,
    TransferRequestStatus,
    generate_request_id,
)
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


class TransferService:
    """Business logic for proposing, deciding on, listing, and cancelling transfers."""

    def __init__(self, db: Session, transfer_manager: TransferManager) -> None:
        self.db = db
        self.transfer_manager = transfer_manager
        self.transfer_repository = TransferRepository(db)
        self.device_repository = DeviceRepository(db)
        self.shared_file_service = SharedFileService(db)

    # --- Requests (pending, in-memory) --------------------------------------

    def request_transfer(
        self,
        requesting_device: Device,
        direction: TransferDirection,
        shared_file_id: int | None,
        file_name: str | None,
        file_size: int | None,
    ) -> PendingTransferRequest:
        """Propose a transfer: a download of a shared file (`send`) or a proposed
        upload (`receive`).

        Raises ValidationError for a malformed payload, NotFoundError if a
        `send` request names a shared file that does not currently exist.
        Does not touch the database — the request lives only in TransferManager
        until the desktop user accepts or rejects it.
        """
        if direction is TransferDirection.SEND:
            if shared_file_id is None:
                raise ValidationError("shared_file_id is required to request a download.")
            shared_file = self.shared_file_service.get_shared_file_or_raise(shared_file_id)
            snapshot_name, snapshot_size = shared_file.file_name, shared_file.file_size
        else:
            snapshot_name, snapshot_size = self._validate_upload_payload(file_name, file_size)
            shared_file_id = None

        settings = get_settings()
        now = utc_now()
        request = PendingTransferRequest(
            request_id=generate_request_id(),
            device_id=requesting_device.id,
            device_name=requesting_device.device_name,
            direction=direction,
            shared_file_id=shared_file_id,
            file_name=snapshot_name,
            file_size=snapshot_size,
            status=TransferRequestStatus.PENDING,
            created_at=now,
            expires_at=now + timedelta(seconds=settings.TRANSFER_REQUEST_TTL_SECONDS),
        )
        self.transfer_manager.create(request)
        logger.info(
            "Transfer requested: request_id=%s device_id=%s direction=%s file=%s",
            request.request_id,
            requesting_device.id,
            direction.value,
            snapshot_name,
        )
        return request

    def get_request_or_raise(
        self, request_id: str, requesting_device: Device | None
    ) -> PendingTransferRequest:
        """Fetch a pending or already-decided transfer request by id.

        Ownership-checked when requesting_device is given (a paired Android
        device may only see its own requests); NotFoundError otherwise so
        existence is never leaked to a device that doesn't own it.
        """
        request = self.transfer_manager.get(request_id)
        if request is None or (
            requesting_device is not None and request.device_id != requesting_device.id
        ):
            raise NotFoundError(f"Transfer request {request_id} was not found.")
        return request

    def list_requests(self, requesting_device: Device | None) -> list[PendingTransferRequest]:
        """List pending transfer requests: every one for the desktop, only its
        own for a paired Android device."""
        device_id = requesting_device.id if requesting_device is not None else None
        return self.transfer_manager.list_pending(device_id)

    def withdraw_request(self, request_id: str, requesting_device: Device) -> None:
        """Withdraw one's own still-pending transfer request before the desktop decides."""
        request = self.transfer_manager.withdraw(request_id, requesting_device.id)
        if request is None:
            raise NotFoundError(f"Transfer request {request_id} was not found.")
        logger.info(
            "Transfer request withdrawn: request_id=%s device_id=%s",
            request_id,
            requesting_device.id,
        )

    # --- Decisions (desktop only) --------------------------------------------

    def accept_request(self, request_id: str) -> Transfer:
        """Accept a pending transfer request, creating its `Transfer` row.

        Re-validates a `send` request's shared file still exists and
        re-snapshots file_name/file_size/device_name at this moment, so the
        persisted record reflects what is actually about to be transferred
        rather than what was true when the request was first made
        (10_Security.md §9: every request must be validated before proceeding).
        If that re-validation fails, the claimed request is put back as
        REJECTED (rather than silently dropped) so a polling requester still
        observes a definite outcome.
        """
        request = self.transfer_manager.claim_for_decision(request_id)
        if request is None:
            raise NotFoundError(f"No pending transfer request found for id {request_id}.")

        try:
            file_name, file_size, resolved_shared_file_id = self._resolve_accepted_file(request)
            device = self._resolve_accepted_device(request)
        except NotFoundError:
            request.status = TransferRequestStatus.REJECTED
            self.transfer_manager.store_decided(request)
            raise

        transfer = Transfer(
            device_id=device.id,
            shared_file_id=resolved_shared_file_id,
            direction=request.direction,
            file_name=file_name,
            file_size=file_size,
            device_name=device.device_name,
            status=TransferStatus.IN_PROGRESS,
        )
        self.transfer_repository.create(transfer)
        self.db.commit()

        request.status = TransferRequestStatus.ACCEPTED
        request.transfer_id = transfer.id
        self.transfer_manager.store_decided(request)

        logger.info(
            "Transfer accepted: request_id=%s transfer_id=%s device_id=%s direction=%s",
            request_id,
            transfer.id,
            device.id,
            request.direction.value,
        )
        return transfer

    def reject_request(self, request_id: str) -> None:
        """Reject a pending transfer request. Nothing is persisted — the schema
        has no "rejected" transfer status."""
        request = self.transfer_manager.claim_for_decision(request_id)
        if request is None:
            raise NotFoundError(f"No pending transfer request found for id {request_id}.")

        request.status = TransferRequestStatus.REJECTED
        self.transfer_manager.store_decided(request)
        logger.info(
            "Transfer request rejected: request_id=%s device_id=%s", request_id, request.device_id
        )

    # --- Transfers (persisted) ------------------------------------------------

    def list_transfers(
        self, requesting_device: Device | None, *, limit: int = 100, offset: int = 0
    ) -> list[Transfer]:
        """List transfers: full history for the desktop, only its own for a
        paired Android device."""
        if requesting_device is None:
            return self.transfer_repository.list_history(limit=limit, offset=offset)
        return self.transfer_repository.list_by_device(requesting_device.id, limit=limit, offset=offset)

    def get_transfer_or_raise(self, transfer_id: int, requesting_device: Device | None) -> Transfer:
        """Fetch a transfer by id. Ownership-checked when requesting_device is given."""
        transfer = self.transfer_repository.get_by_id(transfer_id)
        if transfer is None or (
            requesting_device is not None and transfer.device_id != requesting_device.id
        ):
            raise NotFoundError(f"Transfer {transfer_id} was not found.")
        return transfer

    def reconcile_interrupted_transfers(self) -> int:
        """Mark any transfer left IN_PROGRESS by an unclean shutdown as FAILED.

        Intended to be called once at backend startup (docs/09_Networking.md
        §9: Relay "should gracefully handle... backend restarts"). A freshly
        started process has an empty ActiveStreamRegistry and TransferManager
        — nothing is actually streaming these rows anymore, and V1 has no
        resume support (11_File_Transfer.md §16), so without this sweep an
        interrupted transfer would stay IN_PROGRESS forever, misleading any
        client still polling GET /transfers/{id}. Returns the number of
        transfers reconciled.
        """
        stuck = self.transfer_repository.list_by_status(TransferStatus.IN_PROGRESS, limit=10_000)
        for transfer in stuck:
            transfer.status = TransferStatus.FAILED
            transfer.completed_at = utc_now()
            transfer.failure_reason = "Interrupted by backend restart."
            self.transfer_repository.update(transfer)
        if stuck:
            self.db.commit()
            logger.warning(
                "Reconciled %s transfer(s) left in-progress by an unclean shutdown.", len(stuck)
            )
        return len(stuck)

    def cancel_transfer(self, transfer_id: int, requesting_device: Device | None) -> Transfer:
        """Cancel an in-progress transfer.

        No streaming exists yet in this milestone, so cancellation is a
        direct status transition — there is no open resource to release.
        Raises ConflictError if the transfer has already reached a terminal
        state.
        """
        transfer = self.get_transfer_or_raise(transfer_id, requesting_device)
        if transfer.status is not TransferStatus.IN_PROGRESS:
            raise ConflictError(f"Transfer {transfer_id} is not in progress and cannot be cancelled.")

        transfer.status = TransferStatus.CANCELLED
        transfer.completed_at = utc_now()
        self.transfer_repository.update(transfer)
        self.db.commit()
        logger.info("Transfer cancelled: transfer_id=%s", transfer_id)
        return transfer

    def _validate_upload_payload(self, file_name: str | None, file_size: int | None) -> tuple[str, int]:
        name = (file_name or "").strip()
        if not name:
            raise ValidationError("file_name is required to propose an upload.")
        # file_name is joined onto app_settings.download_directory as-is by
        # TransferStreamService/resolve_available_path at upload time. Without
        # this check, a path separator or drive letter here would let a
        # proposed upload escape that directory (10_Security.md §10: directory
        # traversal must be prevented) — e.g. "../../evil.txt" or an absolute
        # Windows path. Rejecting anything but a plain file name is required,
        # not just a stricter-than-necessary input rule.
        if "/" in name or "\\" in name or ":" in name or name in (".", ".."):
            raise ValidationError("file_name must be a plain file name, not a path.")
        if file_size is None or file_size < 0:
            raise ValidationError("file_size must be a non-negative integer to propose an upload.")
        return name, file_size

    def _resolve_accepted_file(self, request: PendingTransferRequest) -> tuple[str, int, int | None]:
        """Fresh snapshot of the file being transferred, taken at accept time."""
        if request.direction is TransferDirection.SEND:
            shared_file = self.shared_file_service.get_shared_file_or_raise(request.shared_file_id)
            return shared_file.file_name, shared_file.file_size, shared_file.id
        return request.file_name, request.file_size, None

    def _resolve_accepted_device(self, request: PendingTransferRequest) -> Device:
        """Fresh Device lookup at accept time, so a rename between request and
        accept is reflected in the persisted device_name snapshot."""
        device = self.device_repository.get_by_id(request.device_id)
        if device is None:
            raise NotFoundError("The requesting device is no longer paired.")
        return device
