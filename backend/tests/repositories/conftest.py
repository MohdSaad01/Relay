"""Shared fixtures and entity factories for repository-layer tests."""

from collections.abc import Generator

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.database.base import Base
from app.models.device import Device
from app.models.enums import Platform
from app.models.shared_file import SharedFile


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """An isolated in-memory SQLite session with foreign keys enforced and autoflush off.

    autoflush is disabled to match the production `SessionLocal` configuration
    (see app/database/session.py), so these tests exercise the same flush
    semantics the repositories rely on rather than being masked by autoflush.
    """
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def make_device(identifier: str = "device-uuid-1", name: str = "Test Phone") -> Device:
    """Build an unsaved Device instance with the required fields filled in."""
    return Device(
        device_identifier=identifier,
        device_name=name,
        platform=Platform.ANDROID,
        device_secret_hash="hashed-secret",
    )


def make_shared_file(
    file_name: str = "report.pdf",
    file_path: str = "/tmp/report.pdf",
    file_size: int = 2048,
) -> SharedFile:
    """Build an unsaved SharedFile instance with the required fields filled in."""
    return SharedFile(file_name=file_name, file_path=file_path, file_size=file_size)
