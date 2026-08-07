"""TransferService — orchestrates the transfer lifecycle described in
docs/11_File_Transfer.md §7 and docs/13_Database_Design.md §7.

Both directions are auto-accepted the moment they're proposed. A download
(`send`) always has been: the desktop user already made the sharing decision
when they shared the file, so requiring a second manual accept for every
download was redundant friction — see docs/15_QA_NOTEBOOK.md. An upload
(`receive`) now follows the exact same reasoning: the desktop explicitly
paired with the device before it could propose anything, so a second
per-upload approval step added no real protection, just friction — see the
Milestone P1 entry in docs/15_QA_NOTEBOOK.md. There is therefore no longer
any desktop-decision step in this service: proposing a transfer and having
it accepted are the same call, and `request_transfer` immediately returns an
already-ACCEPTED request with its `Transfer` row created.

Persistence is delegated to existing services and repositories rather than
duplicated here: SharedFileService supplies the shared-file snapshot for a
download, DeviceRepository supplies the fresh device snapshot, and
TransferRepository owns `Transfer` rows. Pending-request bookkeeping (the
short-lived, in-memory record `GET /transfers/requests/{id}` polls) lives
entirely in TransferManager and is never written to the database
(13_Database_Design.md §7 has no "pending"/"rejected" transfer status) — but
since every request is now decided in the same call that creates it, nothing
this service creates ever actually sits in TransferManager as PENDING.

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
from app.services.app_settings_service import AppSettingsService
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.shared_file_service import SharedFileService
from app.services.shared_folder_service import SharedFolderService
from app.services.transfer_manager import (
    PendingTransferRequest,
    TransferManager,
    TransferRequestStatus,
    generate_request_id,
)
from app.services.upload_batch_registry import UploadBatchRegistry
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


class TransferService:
    """Business logic for proposing, deciding on, listing, and cancelling transfers."""

    def __init__(
        self,
        db: Session,
        transfer_manager: TransferManager,
        upload_batch_registry: UploadBatchRegistry,
    ) -> None:
        self.db = db
        self.transfer_manager = transfer_manager
        self.upload_batch_registry = upload_batch_registry
        self.transfer_repository = TransferRepository(db)
        self.device_repository = DeviceRepository(db)
        self.shared_file_service = SharedFileService(db)
        self.shared_folder_service = SharedFolderService(db)
        self.app_settings_service = AppSettingsService(db)

    # --- Requests (pending, in-memory) --------------------------------------

    def request_transfer(
        self,
        requesting_device: Device,
        direction: TransferDirection,
        shared_file_id: int | None,
        file_name: str | None,
        file_size: int | None,
        folder_relative_path: str | None = None,
        upload_batch_id: str | None = None,
        upload_folder_name: str | None = None,
    ) -> PendingTransferRequest:
        """Propose a transfer: a download of a shared file (`send`) or an
        upload (`receive`). Both directions are auto-accepted in this same
        call — the desktop already made the decision that matters (sharing
        the file, or pairing with the device) before this request could ever
        be made, so a second manual per-transfer approval is redundant.

        `folder_relative_path`/`upload_batch_id`/`upload_folder_name` (P13)
        are only ever meaningful for `receive`, when this call is one file
        of an Android folder upload — they are ignored entirely for `send`
        (a SEND transfer's folder membership, if any, is derived fresh from
        the shared file itself in `_resolve_accepted_file`) and left unset
        for an ordinary flat single-file upload. This keeps every existing
        single-file call to this method — the overwhelming majority —
        completely unaffected.

        Raises ValidationError for a malformed payload, NotFoundError if a
        `send` request names a shared file that does not currently exist.

        Its `Transfer` row is created immediately (`_create_transfer`), and
        the returned request already carries `status=ACCEPTED`/`transfer_id`
        — nothing is ever stored as PENDING.
        """
        resolved_folder_relative_path: str | None = None
        if direction is TransferDirection.SEND:
            if shared_file_id is None:
                raise ValidationError("shared_file_id is required to request a download.")
            shared_file = self.shared_file_service.get_shared_file_or_raise(shared_file_id)
            snapshot_name, snapshot_size = shared_file.file_name, shared_file.file_size
        elif folder_relative_path is not None:
            snapshot_name, snapshot_size, resolved_folder_relative_path = self._validate_folder_upload_payload(
                file_size, folder_relative_path, upload_batch_id, upload_folder_name
            )
            shared_file_id = None
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
            folder_relative_path=resolved_folder_relative_path,
            upload_batch_id=upload_batch_id if resolved_folder_relative_path is not None else None,
        )

        transfer = self._create_transfer(request)
        request.status = TransferRequestStatus.ACCEPTED
        request.transfer_id = transfer.id
        self.transfer_manager.store_decided(request)
        logger.info(
            "Transfer auto-accepted: request_id=%s transfer_id=%s device_id=%s direction=%s file=%s",
            request.request_id,
            transfer.id,
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
        own for a paired Android device.

        Always empty in practice now that both directions are auto-accepted
        by `request_transfer` — kept for API compatibility (existing clients
        poll this endpoint) and because TransferManager still supports
        genuinely pending requests as a building block, even though nothing
        in this service currently produces one.
        """
        device_id = requesting_device.id if requesting_device is not None else None
        return self.transfer_manager.list_pending(device_id)

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
        if file_name is None or not file_name.strip():
            raise ValidationError("file_name is required to propose an upload.")
        name = self._validate_plain_name_segment(file_name, field_label="file_name")
        if file_size is None or file_size < 0:
            raise ValidationError("file_size must be a non-negative integer to propose an upload.")
        return name, file_size

    def _validate_folder_upload_payload(
        self,
        file_size: int | None,
        folder_relative_path: str,
        upload_batch_id: str | None,
        upload_folder_name: str | None,
    ) -> tuple[str, int, str]:
        """Validate and resolve one file of an Android folder upload (P13).

        Unlike a flat upload, `file_name` is never taken from the client
        directly — it's derived from `folder_relative_path`'s own last
        segment, so the two can never disagree. Returns
        (basename, file_size, resolved_folder_relative_path), where the
        resolved path is root-inclusive (see UploadBatchRegistry) and is
        what ends up on Transfer.folder_relative_path.
        """
        if file_size is None or file_size < 0:
            raise ValidationError("file_size must be a non-negative integer to propose an upload.")
        if not upload_batch_id or not upload_folder_name:
            raise ValidationError(
                "upload_batch_id and upload_folder_name are required to propose a folder upload."
            )
        raw_segments = folder_relative_path.split("/")
        if not raw_segments:
            raise ValidationError("folder_relative_path cannot be empty.")
        segments = [
            self._validate_plain_name_segment(segment, field_label="folder_relative_path")
            for segment in raw_segments
        ]
        root_name = self._validate_plain_name_segment(upload_folder_name, field_label="upload_folder_name")

        download_directory = self.app_settings_service.get_settings().download_directory
        resolved_root = self.upload_batch_registry.resolve(upload_batch_id, root_name, download_directory)
        resolved_path = "/".join([resolved_root, *segments])
        return segments[-1], file_size, resolved_path

    def _validate_plain_name_segment(self, segment: str, *, field_label: str) -> str:
        """Validate a single path segment (a flat file name, or one component
        of a folder-relative path) contains no directory separator or
        traversal token.

        This is joined onto app_settings.download_directory as-is by
        TransferStreamService/resolve_available_path at upload time. Without
        this check, a path separator or drive letter here would let a
        proposed upload escape that directory (10_Security.md §10: directory
        traversal must be prevented) — e.g. "../../evil.txt" or an absolute
        Windows path. Rejecting anything but a plain name per segment is
        required, not just a stricter-than-necessary input rule.
        """
        name = segment.strip()
        if not name or "/" in name or "\\" in name or ":" in name or name in (".", ".."):
            raise ValidationError(f"{field_label} must be a plain name, not a path.")
        return name

    def _create_transfer(self, request: PendingTransferRequest) -> Transfer:
        """Create and persist the `Transfer` row for an accepted request.

        Called by `request_transfer` for both directions, immediately after
        proposing. Re-resolves the file and device fresh at this moment
        rather than trusting the request's own snapshot (10_Security.md §9:
        every request must be validated before proceeding) — raises
        NotFoundError if either no longer exists.
        """
        (
            file_name,
            file_size,
            resolved_shared_file_id,
            resolved_shared_folder_id,
            folder_relative_path,
        ) = self._resolve_accepted_file(request)
        device = self._resolve_accepted_device(request)

        transfer = Transfer(
            device_id=device.id,
            shared_file_id=resolved_shared_file_id,
            shared_folder_id=resolved_shared_folder_id,
            folder_relative_path=folder_relative_path,
            upload_batch_id=request.upload_batch_id,
            direction=request.direction,
            file_name=file_name,
            file_size=file_size,
            device_name=device.device_name,
            status=TransferStatus.IN_PROGRESS,
        )
        self.transfer_repository.create(transfer)
        self.db.commit()
        return transfer

    def _resolve_accepted_file(
        self, request: PendingTransferRequest
    ) -> tuple[str, int, int | None, int | None, str | None]:
        """Fresh snapshot of the file being transferred, taken at accept
        time. Returns (file_name, file_size, shared_file_id,
        shared_folder_id, folder_relative_path).

        For SEND, folder membership is derived fresh from the shared file
        itself (not trusted from the request) — if it belongs to a shared
        folder, folder_relative_path is rebuilt as
        "<folder_name>/<file's relative_path>" so a folder rename between
        request and accept is reflected, matching how device_name below is
        also re-resolved fresh rather than trusted from the request.
        """
        if request.direction is TransferDirection.SEND:
            shared_file = self.shared_file_service.get_shared_file_or_raise(request.shared_file_id)
            folder_relative_path = None
            if shared_file.shared_folder_id is not None:
                shared_folder = self.shared_folder_service.get_shared_folder_or_raise(
                    shared_file.shared_folder_id
                )
                folder_relative_path = f"{shared_folder.folder_name}/{shared_file.relative_path}"
            return (
                shared_file.file_name,
                shared_file.file_size,
                shared_file.id,
                shared_file.shared_folder_id,
                folder_relative_path,
            )
        return request.file_name, request.file_size, None, None, request.folder_relative_path

    def _resolve_accepted_device(self, request: PendingTransferRequest) -> Device:
        """Fresh Device lookup at accept time, so a rename between request and
        accept is reflected in the persisted device_name snapshot."""
        device = self.device_repository.get_by_id(request.device_id)
        if device is None:
            raise NotFoundError("The requesting device is no longer paired.")
        return device
