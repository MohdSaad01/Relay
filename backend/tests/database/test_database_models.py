"""Tests for the SQLAlchemy database models, constraints, and delete behavior."""

from collections.abc import Generator

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.database.base import Base
from app.models import Device, DeviceSession, SharedFile, Transfer
from app.models.enums import Platform, TransferDirection, TransferStatus
from app.utils.time import utc_now


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """An isolated in-memory SQLite database with foreign keys enforced."""
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _make_device(session: Session, identifier: str = "device-uuid-1") -> Device:
    device = Device(
        device_identifier=identifier,
        device_name="Test Phone",
        platform=Platform.ANDROID,
        device_secret_hash="hashed-secret",
    )
    session.add(device)
    session.commit()
    return device


def test_device_identifier_must_be_unique(db_session: Session) -> None:
    _make_device(db_session, "duplicate-id")
    db_session.add(
        Device(
            device_identifier="duplicate-id",
            device_name="Other Phone",
            platform=Platform.ANDROID,
            device_secret_hash="hashed-secret-2",
        )
    )

    with pytest.raises(IntegrityError):
        db_session.commit()


def test_deleting_device_cascades_to_sessions(db_session: Session) -> None:
    device = _make_device(db_session)
    db_session.add(
        DeviceSession(device_id=device.id, token_hash="hashed-token", expires_at=utc_now())
    )
    db_session.commit()

    db_session.delete(device)
    db_session.commit()

    assert db_session.query(DeviceSession).count() == 0


def test_deleting_device_sets_transfer_device_id_null(db_session: Session) -> None:
    device = _make_device(db_session)
    transfer = Transfer(
        device_id=device.id,
        direction=TransferDirection.SEND,
        file_name="report.pdf",
        file_size=1024,
        device_name=device.device_name,
        status=TransferStatus.COMPLETED,
    )
    db_session.add(transfer)
    db_session.commit()

    db_session.delete(device)
    db_session.commit()
    db_session.refresh(transfer)

    assert transfer.device_id is None
    assert transfer.device_name == "Test Phone"  # snapshot survives device deletion


def test_deleting_shared_file_sets_transfer_shared_file_id_null(db_session: Session) -> None:
    shared_file = SharedFile(file_name="report.pdf", file_path="/tmp/report.pdf", file_size=2048)
    db_session.add(shared_file)
    db_session.commit()

    transfer = Transfer(
        shared_file_id=shared_file.id,
        direction=TransferDirection.RECEIVE,
        file_name="report.pdf",
        file_size=2048,
        device_name="Test Phone",
        status=TransferStatus.IN_PROGRESS,
    )
    db_session.add(transfer)
    db_session.commit()

    db_session.delete(shared_file)
    db_session.commit()
    db_session.refresh(transfer)

    assert transfer.shared_file_id is None
