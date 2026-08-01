"""Tests for TransferRepository."""

from sqlalchemy.orm import Session

from app.models.enums import TransferDirection, TransferStatus
from app.models.transfer import Transfer
from app.repositories.device_repository import DeviceRepository
from app.repositories.transfer_repository import TransferRepository
from tests.repositories.conftest import make_device


def _make_transfer(**overrides: object) -> Transfer:
    fields: dict[str, object] = {
        "direction": TransferDirection.SEND,
        "file_name": "report.pdf",
        "file_size": 1024,
        "device_name": "Test Phone",
        "status": TransferStatus.IN_PROGRESS,
    }
    fields.update(overrides)
    return Transfer(**fields)


def test_create_assigns_id(db_session: Session) -> None:
    repo = TransferRepository(db_session)

    transfer = repo.create(_make_transfer())

    assert transfer.id is not None


def test_list_by_status_filters_correctly(db_session: Session) -> None:
    repo = TransferRepository(db_session)
    repo.create(_make_transfer(status=TransferStatus.IN_PROGRESS, file_name="a.pdf"))
    repo.create(_make_transfer(status=TransferStatus.COMPLETED, file_name="b.pdf"))

    in_progress = repo.list_by_status(TransferStatus.IN_PROGRESS)

    assert [t.file_name for t in in_progress] == ["a.pdf"]


def test_list_history_respects_limit_and_offset(db_session: Session) -> None:
    repo = TransferRepository(db_session)
    for i in range(5):
        repo.create(_make_transfer(file_name=f"file-{i}.pdf"))

    page = repo.list_history(limit=2, offset=1)

    assert len(page) == 2


def test_list_by_device_returns_only_that_devices_transfers(
    db_session: Session,
) -> None:
    device_repo = DeviceRepository(db_session)
    device_a = device_repo.create(make_device(identifier="device-a"))
    device_b = device_repo.create(make_device(identifier="device-b"))
    repo = TransferRepository(db_session)
    repo.create(_make_transfer(device_id=device_a.id, file_name="a.pdf"))
    repo.create(_make_transfer(device_id=device_b.id, file_name="b.pdf"))

    transfers = repo.list_by_device(device_a.id)

    assert [t.file_name for t in transfers] == ["a.pdf"]


def test_update_persists_mutated_field(db_session: Session) -> None:
    repo = TransferRepository(db_session)
    transfer = repo.create(_make_transfer())

    transfer.status = TransferStatus.COMPLETED
    transfer.bytes_transferred = 1024
    repo.update(transfer)

    refetched = repo.get_by_id(transfer.id)
    assert refetched is not None
    assert refetched.status == TransferStatus.COMPLETED
    assert refetched.bytes_transferred == 1024


def test_repository_exposes_no_delete_method() -> None:
    assert not hasattr(TransferRepository, "delete")
