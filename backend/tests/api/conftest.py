"""Shared fixtures for API-layer tests."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.database.session import get_db
from app.main import app
from tests.repositories.conftest import db_session, make_device  # noqa: F401


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """A TestClient backed by an isolated in-memory SQLite database.

    Uses StaticPool so the single in-memory connection is shared across the
    threadpool FastAPI runs synchronous route handlers on, rather than each
    request silently getting its own empty database.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    test_session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def _get_test_db() -> Generator:
        db = test_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_test_db
    test_client = TestClient(app)
    test_client.session_factory = test_session_local  # type: ignore[attr-defined]

    try:
        yield test_client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
