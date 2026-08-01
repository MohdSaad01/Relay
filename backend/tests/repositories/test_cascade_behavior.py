"""Repository-level tests for cross-table delete behavior defined in the schema.

These exercise the behavior through the repository layer (not raw SQLAlchemy
model operations) since that is the layer the Service Layer will actually call.

Repositories never commit (that is now the Service Layer's responsibility —
see the repository docstrings), so each test commits explicitly after calling
the repository method, standing in for the transaction boundary a service
would normally close. This also lets SQLAlchemy's default expire-on-commit
refresh already-loaded objects, which is what surfaces the SQLite FK trigger's
effect (SET NULL / CASCADE) on rows the ORM didn't touch directly.
"""

from sqlalchemy.orm import Session

from app.models.device_session import DeviceSession
from app.models.enums import TransferDirection, TransferStatus
from app.models.transfer import Transfer
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.repositories.shared_file_repository import SharedFileRepository
from app.repositories.transfer_repository import TransferRepository
from app.utils.time import utc_now
from tests.repositories.conftest import make_device, make_shared_file


def test_deleting_device_removes_its_sessions(db_session: Session) -> None:
    device_repo = DeviceRepository(db_session)
    session_repo = DeviceSessionRepository(db_session)
    device = device_repo.create(make_device())
    session = session_repo.create(
        DeviceSession(
            device_id=device.id, token_hash="hashed-token", expires_at=utc_now()
        )
    )

    session_id = session.id
    device_repo.delete(device)
    db_session.commit()
    # Drop the stale identity-mapped instance: it was removed by the DB-level
    # CASCADE, not through the ORM, so session_repo.get_by_id() must issue a
    # fresh SELECT rather than try to refresh an object that no longer exists.
    db_session.expunge(session)

    assert session_repo.get_by_id(session_id) is None


def test_deleting_device_sets_transfer_device_id_null(db_session: Session) -> None:
    device_repo = DeviceRepository(db_session)
    transfer_repo = TransferRepository(db_session)
    device = device_repo.create(make_device())
    transfer = transfer_repo.create(
        Transfer(
            device_id=device.id,
            direction=TransferDirection.SEND,
            file_name="report.pdf",
            file_size=1024,
            device_name=device.device_name,
            status=TransferStatus.COMPLETED,
        )
    )

    device_repo.delete(device)
    db_session.commit()

    refetched = transfer_repo.get_by_id(transfer.id)
    assert refetched is not None
    assert refetched.device_id is None
    assert refetched.device_name == "Test Phone"  # snapshot survives device deletion


def test_deleting_shared_file_sets_transfer_shared_file_id_null(
    db_session: Session,
) -> None:
    shared_file_repo = SharedFileRepository(db_session)
    transfer_repo = TransferRepository(db_session)
    shared_file = shared_file_repo.create(make_shared_file())
    transfer = transfer_repo.create(
        Transfer(
            shared_file_id=shared_file.id,
            direction=TransferDirection.RECEIVE,
            file_name=shared_file.file_name,
            file_size=shared_file.file_size,
            device_name="Test Phone",
            status=TransferStatus.IN_PROGRESS,
        )
    )

    shared_file_repo.delete(shared_file)
    db_session.commit()

    refetched = transfer_repo.get_by_id(transfer.id)
    assert refetched is not None
    assert refetched.shared_file_id is None
