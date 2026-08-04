"""Tests for TransferService."""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.enums import TransferDirection, TransferStatus
from app.repositories.device_repository import DeviceRepository
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.shared_file_service import SharedFileService
from app.services.transfer_manager import TransferManager, TransferRequestStatus
from app.services.transfer_service import TransferService
from tests.repositories.conftest import make_device


def _make_file(tmp_path: Path, name: str = "report.pdf", content: bytes = b"content") -> str:
    file_path = tmp_path / name
    file_path.write_bytes(content)
    return str(file_path)


def _service(db_session: Session) -> TransferService:
    return TransferService(db_session, TransferManager())


def _register_device(db_session: Session, identifier: str = "device-uuid-1") -> Device:
    return DeviceRepository(db_session).create(make_device(identifier=identifier))


# --- request_transfer ----------------------------------------------------------


def test_request_transfer_download_auto_accepts_and_creates_transfer(
    db_session: Session, tmp_path: Path
) -> None:
    """A download no longer waits for the desktop's decision: request_transfer
    itself creates the Transfer row and returns an already-ACCEPTED request."""
    device = _register_device(db_session)
    shared_file, _ = SharedFileService(db_session).share_file(_make_file(tmp_path))
    service = _service(db_session)

    request = service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)

    assert request.status is TransferRequestStatus.ACCEPTED
    assert request.file_name == "report.pdf"
    assert request.shared_file_id == shared_file.id
    assert request.transfer_id is not None

    transfer = service.get_transfer_or_raise(request.transfer_id, None)
    assert transfer.status is TransferStatus.IN_PROGRESS
    assert transfer.device_id == device.id
    assert transfer.shared_file_id == shared_file.id
    assert transfer.file_name == "report.pdf"


def test_request_transfer_download_raises_for_unknown_shared_file(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    with pytest.raises(NotFoundError):
        service.request_transfer(device, TransferDirection.SEND, 999, None, None)


def test_request_transfer_download_requires_shared_file_id(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    with pytest.raises(ValidationError):
        service.request_transfer(device, TransferDirection.SEND, None, None, None)


def test_request_transfer_upload_requires_file_name_and_size(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    with pytest.raises(ValidationError):
        service.request_transfer(device, TransferDirection.RECEIVE, None, "", 1024)

    with pytest.raises(ValidationError):
        service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", None)


@pytest.mark.parametrize(
    "file_name",
    [
        "../evil.txt",
        "..\\evil.txt",
        "subdir/evil.txt",
        "subdir\\evil.txt",
        "/etc/passwd",
        "C:\\Windows\\System32\\evil.txt",
        "C:evil.txt",
        "..",
    ],
)
def test_request_transfer_upload_rejects_path_like_file_name(
    db_session: Session, file_name: str
) -> None:
    """A malicious file_name must never reach resolve_available_path's
    os.path.join with app_settings.download_directory (10_Security.md §10:
    directory traversal must be prevented)."""
    device = _register_device(db_session)
    service = _service(db_session)

    with pytest.raises(ValidationError):
        service.request_transfer(device, TransferDirection.RECEIVE, None, file_name, 1024)


def test_request_transfer_upload_creates_pending_request(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    assert request.status is TransferRequestStatus.PENDING
    assert request.shared_file_id is None
    assert request.file_name == "photo.jpg"


# --- get_request_or_raise / list_requests / withdraw_request -------------------


def test_withdraw_request_removes_own_pending_request(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    service.withdraw_request(request.request_id, device)

    with pytest.raises(NotFoundError):
        service.get_request_or_raise(request.request_id, device)


def test_withdraw_request_raises_when_not_owned(db_session: Session) -> None:
    owner = _register_device(db_session, identifier="device-a")
    other = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    request = service.request_transfer(owner, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    with pytest.raises(NotFoundError):
        service.withdraw_request(request.request_id, other)


def test_withdraw_request_raises_for_auto_accepted_download(db_session: Session, tmp_path: Path) -> None:
    """A download is never PENDING, so there is nothing left to withdraw."""
    device = _register_device(db_session)
    shared_file, _ = SharedFileService(db_session).share_file(_make_file(tmp_path))
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)

    with pytest.raises(NotFoundError):
        service.withdraw_request(request.request_id, device)


def test_list_requests_scopes_to_device(db_session: Session) -> None:
    device_a = _register_device(db_session, identifier="device-a")
    device_b = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    service.request_transfer(device_a, TransferDirection.RECEIVE, None, "a.jpg", 100)
    service.request_transfer(device_b, TransferDirection.RECEIVE, None, "b.jpg", 200)

    assert [r.file_name for r in service.list_requests(device_a)] == ["a.jpg"]
    assert len(service.list_requests(None)) == 2


def test_list_requests_never_includes_auto_accepted_downloads(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    shared_file, _ = SharedFileService(db_session).share_file(_make_file(tmp_path))
    service = _service(db_session)
    service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)
    service.request_transfer(device, TransferDirection.RECEIVE, None, "a.jpg", 100)

    pending = service.list_requests(device)

    assert [r.file_name for r in pending] == ["a.jpg"]


# --- accept_request / reject_request --------------------------------------------


def test_accept_request_creates_transfer(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    transfer = service.accept_request(request.request_id)

    assert transfer.id is not None
    assert transfer.status is TransferStatus.IN_PROGRESS
    assert transfer.device_id == device.id
    assert transfer.shared_file_id is None
    assert transfer.file_name == "photo.jpg"


def test_accept_request_raises_for_unknown_request(db_session: Session) -> None:
    service = _service(db_session)

    with pytest.raises(NotFoundError):
        service.accept_request("missing")


def test_accept_request_raises_for_already_auto_accepted_download(
    db_session: Session, tmp_path: Path
) -> None:
    """A download's request_id is never PENDING (it's auto-accepted by
    request_transfer), so accept_request -- desktop's upload-review path --
    can never claim it either."""
    device = _register_device(db_session)
    shared_file, _ = SharedFileService(db_session).share_file(_make_file(tmp_path))
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)

    with pytest.raises(NotFoundError):
        service.accept_request(request.request_id)


def test_accept_request_raises_when_device_removed_meanwhile(db_session: Session) -> None:
    device_repository = DeviceRepository(db_session)
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)
    device_repository.delete(device)
    db_session.commit()

    with pytest.raises(NotFoundError):
        service.accept_request(request.request_id)

    # The request is not silently dropped -- it becomes observable as rejected.
    rejected = service.get_request_or_raise(request.request_id, None)
    assert rejected.status is TransferRequestStatus.REJECTED


def test_reject_request_marks_rejected_without_persisting(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    service.reject_request(request.request_id)

    updated = service.get_request_or_raise(request.request_id, device)
    assert updated.status is TransferRequestStatus.REJECTED
    assert service.list_transfers(None) == []


def test_reject_request_raises_for_unknown_request(db_session: Session) -> None:
    service = _service(db_session)

    with pytest.raises(NotFoundError):
        service.reject_request("missing")


def test_reject_request_raises_for_already_auto_accepted_download(
    db_session: Session, tmp_path: Path
) -> None:
    device = _register_device(db_session)
    shared_file, _ = SharedFileService(db_session).share_file(_make_file(tmp_path))
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)

    with pytest.raises(NotFoundError):
        service.reject_request(request.request_id)


# --- list_transfers / get_transfer_or_raise / cancel_transfer ------------------


def test_list_transfers_scopes_to_device(db_session: Session) -> None:
    device_a = _register_device(db_session, identifier="device-a")
    device_b = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    request_a = service.request_transfer(device_a, TransferDirection.RECEIVE, None, "a.jpg", 100)
    request_b = service.request_transfer(device_b, TransferDirection.RECEIVE, None, "b.jpg", 200)
    service.accept_request(request_a.request_id)
    service.accept_request(request_b.request_id)

    assert [t.file_name for t in service.list_transfers(device_a)] == ["a.jpg"]
    assert len(service.list_transfers(None)) == 2


def test_get_transfer_or_raise_raises_when_not_owned(db_session: Session) -> None:
    owner = _register_device(db_session, identifier="device-a")
    other = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    request = service.request_transfer(owner, TransferDirection.RECEIVE, None, "a.jpg", 100)
    transfer = service.accept_request(request.request_id)

    with pytest.raises(NotFoundError):
        service.get_transfer_or_raise(transfer.id, other)


def test_cancel_transfer_marks_cancelled(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "a.jpg", 100)
    transfer = service.accept_request(request.request_id)

    cancelled = service.cancel_transfer(transfer.id, None)

    assert cancelled.status is TransferStatus.CANCELLED
    assert cancelled.completed_at is not None


def test_cancel_transfer_raises_when_not_owned(db_session: Session) -> None:
    owner = _register_device(db_session, identifier="device-a")
    other = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    request = service.request_transfer(owner, TransferDirection.RECEIVE, None, "a.jpg", 100)
    transfer = service.accept_request(request.request_id)

    with pytest.raises(NotFoundError):
        service.cancel_transfer(transfer.id, other)


def test_cancel_transfer_raises_when_already_terminal(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "a.jpg", 100)
    transfer = service.accept_request(request.request_id)
    service.cancel_transfer(transfer.id, None)

    with pytest.raises(ConflictError):
        service.cancel_transfer(transfer.id, None)


# --- reconcile_interrupted_transfers ---------------------------------------------


def test_reconcile_interrupted_transfers_marks_stuck_transfers_failed(db_session: Session) -> None:
    """Reproduces the T7 finding: a transfer an unclean shutdown left
    IN_PROGRESS has no ActiveStreamRegistry entry and no TransferManager
    state in a freshly started process -- nothing will ever move it out of
    IN_PROGRESS on its own. Without this reconciliation, GET /transfers/{id}
    would report IN_PROGRESS forever."""
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "a.jpg", 100)
    stuck = service.accept_request(request.request_id)
    assert stuck.status is TransferStatus.IN_PROGRESS

    reconciled_count = service.reconcile_interrupted_transfers()

    assert reconciled_count == 1
    refreshed = service.get_transfer_or_raise(stuck.id, None)
    assert refreshed.status is TransferStatus.FAILED
    assert refreshed.failure_reason == "Interrupted by backend restart."
    assert refreshed.completed_at is not None


def test_reconcile_interrupted_transfers_leaves_terminal_transfers_untouched(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "a.jpg", 100)
    transfer = service.accept_request(request.request_id)
    cancelled = service.cancel_transfer(transfer.id, None)

    reconciled_count = service.reconcile_interrupted_transfers()

    assert reconciled_count == 0
    refreshed = service.get_transfer_or_raise(cancelled.id, None)
    assert refreshed.status is TransferStatus.CANCELLED


def test_reconcile_interrupted_transfers_returns_zero_when_nothing_stuck(db_session: Session) -> None:
    service = _service(db_session)

    assert service.reconcile_interrupted_transfers() == 0
