"""Tests for TransferService."""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.enums import TransferDirection, TransferStatus
from app.models.transfer import Transfer
from app.repositories.device_repository import DeviceRepository
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.shared_file_service import SharedFileService
from app.services.transfer_manager import TransferManager, TransferRequestStatus
from app.services.transfer_service import TransferService
from app.services.upload_batch_registry import UploadBatchRegistry
from tests.repositories.conftest import make_device


def _make_file(tmp_path: Path, name: str = "report.pdf", content: bytes = b"content") -> str:
    file_path = tmp_path / name
    file_path.write_bytes(content)
    return str(file_path)


def _service(db_session: Session) -> TransferService:
    return TransferService(db_session, TransferManager(), UploadBatchRegistry())


def _register_device(db_session: Session, identifier: str = "device-uuid-1") -> Device:
    return DeviceRepository(db_session).create(make_device(identifier=identifier))


def _create_upload_transfer(
    service: TransferService,
    device: Device,
    file_name: str = "a.jpg",
    file_size: int = 100,
) -> Transfer:
    """Propose an upload (auto-accepted) and return its resulting Transfer."""
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, file_name, file_size)
    return service.get_transfer_or_raise(request.transfer_id, None)


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


def test_request_transfer_upload_auto_accepts_and_creates_transfer(db_session: Session) -> None:
    """An upload follows the exact same auto-accept path as a download now:
    the desktop already decided when it paired with the device, so a second
    per-upload approval is redundant (docs/15_QA_NOTEBOOK.md, Milestone P1)."""
    device = _register_device(db_session)
    service = _service(db_session)

    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    assert request.status is TransferRequestStatus.ACCEPTED
    assert request.shared_file_id is None
    assert request.file_name == "photo.jpg"
    assert request.transfer_id is not None

    transfer = service.get_transfer_or_raise(request.transfer_id, None)
    assert transfer.status is TransferStatus.IN_PROGRESS
    assert transfer.device_id == device.id
    assert transfer.shared_file_id is None
    assert transfer.file_name == "photo.jpg"


def test_request_transfer_upload_raises_when_device_removed_meanwhile(db_session: Session) -> None:
    """_create_transfer re-validates the device fresh, even for the
    now-synchronous auto-accept path (10_Security.md §9)."""
    device_repository = DeviceRepository(db_session)
    device = _register_device(db_session)
    device_repository.delete(device)
    db_session.commit()
    service = _service(db_session)

    with pytest.raises(NotFoundError):
        service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)


# --- request_transfer: folder download (P13) ------------------------------------


def test_request_transfer_download_of_folder_child_carries_folder_fields(
    db_session: Session, tmp_path: Path
) -> None:
    from app.services.shared_folder_service import SharedFolderService

    device = _register_device(db_session)
    root = tmp_path / "University Notes"
    (root / "Semester 1").mkdir(parents=True)
    (root / "Semester 1" / "DBMS.pdf").write_bytes(b"notes")
    shared_folder, _ = SharedFolderService(db_session).share_folder(str(root))
    child = SharedFolderService(db_session).list_folder_files(shared_folder.id)[0]
    service = _service(db_session)

    request = service.request_transfer(device, TransferDirection.SEND, child.id, None, None)
    transfer = service.get_transfer_or_raise(request.transfer_id, None)

    assert transfer.shared_folder_id == shared_folder.id
    assert transfer.folder_relative_path == "University Notes/Semester 1/DBMS.pdf"
    assert transfer.file_name == "DBMS.pdf"


def test_request_transfer_download_of_standalone_file_has_no_folder_fields(
    db_session: Session, tmp_path: Path
) -> None:
    device = _register_device(db_session)
    shared_file, _ = SharedFileService(db_session).share_file(_make_file(tmp_path))
    service = _service(db_session)

    request = service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)
    transfer = service.get_transfer_or_raise(request.transfer_id, None)

    assert transfer.shared_folder_id is None
    assert transfer.folder_relative_path is None


# --- request_transfer: folder upload (P13) --------------------------------------


def test_request_transfer_folder_upload_resolves_relative_path(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    request = service.request_transfer(
        device,
        TransferDirection.RECEIVE,
        None,
        None,
        100,
        "Semester 1/DBMS.pdf",
        "batch-1",
        "University Notes",
    )
    transfer = service.get_transfer_or_raise(request.transfer_id, None)

    assert transfer.folder_relative_path == "University Notes/Semester 1/DBMS.pdf"
    assert transfer.file_name == "DBMS.pdf"
    assert transfer.upload_batch_id == "batch-1"
    assert transfer.shared_folder_id is None


def test_request_transfer_folder_upload_reuses_resolved_root_name_across_batch(
    db_session: Session,
) -> None:
    """Every file in the same folder-upload batch must land under the exact
    same (conflict-resolved) top-level folder name."""
    device = _register_device(db_session)
    service = _service(db_session)

    first = service.request_transfer(
        device, TransferDirection.RECEIVE, None, None, 10, "a.txt", "batch-1", "Photos"
    )
    second = service.request_transfer(
        device, TransferDirection.RECEIVE, None, None, 20, "sub/b.txt", "batch-1", "Photos"
    )

    first_transfer = service.get_transfer_or_raise(first.transfer_id, None)
    second_transfer = service.get_transfer_or_raise(second.transfer_id, None)
    assert first_transfer.folder_relative_path == "Photos/a.txt"
    assert second_transfer.folder_relative_path == "Photos/sub/b.txt"


def test_request_transfer_folder_upload_requires_batch_id_and_folder_name(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    with pytest.raises(ValidationError):
        service.request_transfer(
            device, TransferDirection.RECEIVE, None, None, 10, "a.txt", None, "Photos"
        )
    with pytest.raises(ValidationError):
        service.request_transfer(
            device, TransferDirection.RECEIVE, None, None, 10, "a.txt", "batch-1", None
        )


@pytest.mark.parametrize(
    "folder_relative_path",
    [
        "../evil.txt",
        "sub/../../evil.txt",
        "sub//evil.txt",
        "/etc/passwd",
        "C:\\Windows\\evil.txt",
        "",
    ],
)
def test_request_transfer_folder_upload_rejects_path_like_segment(
    db_session: Session, folder_relative_path: str
) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    with pytest.raises(ValidationError):
        service.request_transfer(
            device, TransferDirection.RECEIVE, None, None, 10, folder_relative_path, "batch-1", "Photos"
        )


def test_request_transfer_folder_upload_rejects_path_like_folder_name(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)

    with pytest.raises(ValidationError):
        service.request_transfer(
            device, TransferDirection.RECEIVE, None, None, 10, "a.txt", "batch-1", "../evil"
        )


# --- get_request_or_raise / list_requests ---------------------------------------


def test_get_request_or_raise_returns_the_auto_accepted_request(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    request = service.request_transfer(device, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    fetched = service.get_request_or_raise(request.request_id, device)

    assert fetched.status is TransferRequestStatus.ACCEPTED
    assert fetched.transfer_id == request.transfer_id


def test_get_request_or_raise_raises_when_not_owned(db_session: Session) -> None:
    owner = _register_device(db_session, identifier="device-a")
    other = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    request = service.request_transfer(owner, TransferDirection.RECEIVE, None, "photo.jpg", 2048)

    with pytest.raises(NotFoundError):
        service.get_request_or_raise(request.request_id, other)


def test_list_requests_is_always_empty_since_every_direction_auto_accepts(
    db_session: Session, tmp_path: Path
) -> None:
    """list_requests only ever surfaces still-PENDING requests, and nothing
    proposed through request_transfer is ever left PENDING anymore, for
    either direction."""
    device = _register_device(db_session)
    shared_file, _ = SharedFileService(db_session).share_file(_make_file(tmp_path))
    service = _service(db_session)
    service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)
    service.request_transfer(device, TransferDirection.RECEIVE, None, "a.jpg", 100)

    assert service.list_requests(device) == []
    assert service.list_requests(None) == []


# --- list_transfers / get_transfer_or_raise / cancel_transfer ------------------


def test_list_transfers_scopes_to_device(db_session: Session) -> None:
    device_a = _register_device(db_session, identifier="device-a")
    device_b = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    _create_upload_transfer(service, device_a, "a.jpg")
    _create_upload_transfer(service, device_b, "b.jpg")

    assert [t.file_name for t in service.list_transfers(device_a)] == ["a.jpg"]
    assert len(service.list_transfers(None)) == 2


def test_get_transfer_or_raise_raises_when_not_owned(db_session: Session) -> None:
    owner = _register_device(db_session, identifier="device-a")
    other = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    transfer = _create_upload_transfer(service, owner)

    with pytest.raises(NotFoundError):
        service.get_transfer_or_raise(transfer.id, other)


def test_cancel_transfer_marks_cancelled(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    transfer = _create_upload_transfer(service, device)

    cancelled = service.cancel_transfer(transfer.id, None)

    assert cancelled.status is TransferStatus.CANCELLED
    assert cancelled.completed_at is not None


def test_cancel_transfer_raises_when_not_owned(db_session: Session) -> None:
    owner = _register_device(db_session, identifier="device-a")
    other = _register_device(db_session, identifier="device-b")
    service = _service(db_session)
    transfer = _create_upload_transfer(service, owner)

    with pytest.raises(NotFoundError):
        service.cancel_transfer(transfer.id, other)


def test_cancel_transfer_raises_when_already_terminal(db_session: Session) -> None:
    device = _register_device(db_session)
    service = _service(db_session)
    transfer = _create_upload_transfer(service, device)
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
    stuck = _create_upload_transfer(service, device)
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
    transfer = _create_upload_transfer(service, device)
    cancelled = service.cancel_transfer(transfer.id, None)

    reconciled_count = service.reconcile_interrupted_transfers()

    assert reconciled_count == 0
    refreshed = service.get_transfer_or_raise(cancelled.id, None)
    assert refreshed.status is TransferStatus.CANCELLED


def test_reconcile_interrupted_transfers_returns_zero_when_nothing_stuck(db_session: Session) -> None:
    service = _service(db_session)

    assert service.reconcile_interrupted_transfers() == 0
