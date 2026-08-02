"""Shared fixtures for API-layer tests."""

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_transfer_manager
from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app.services.transfer_manager import TransferManager
from tests.repositories.conftest import db_session, make_device  # noqa: F401


def _build_test_client(client_address: tuple[str, int]) -> Generator[TestClient, None, None]:
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
    # TransferManager is a process-wide singleton in production (transfer
    # requests are runtime-only state, like PairingManager -- see
    # app/services/transfer_manager.py), so without this override it would
    # otherwise leak pending requests across tests within the same pytest
    # session. A fresh instance per test client keeps tests isolated while
    # still letting the client/desktop_client pair share one instance, since
    # both point at the same overridden `app`.
    test_transfer_manager = TransferManager()
    app.dependency_overrides[get_transfer_manager] = lambda: test_transfer_manager
    test_client = TestClient(app, client=client_address)
    test_client.session_factory = test_session_local  # type: ignore[attr-defined]

    try:
        yield test_client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """A TestClient simulating a non-loopback (LAN/Android) caller.

    Installs the `get_db` override used by both this fixture and
    `desktop_client` below.
    """
    yield from _build_test_client(("198.51.100.10", 50000))


@pytest.fixture
def desktop_client(client: TestClient) -> TestClient:
    """A second TestClient simulating the desktop's own loopback caller.

    Depends on `client` so both point at the same FastAPI `app` instance
    with the same already-installed `get_db` override — i.e. the same
    in-memory database — rather than each fixture standing up its own
    isolated database. Tests that need both perspectives (e.g. "share a
    file as the desktop, then browse it as a paired Android device") need
    the two callers to see the same data.
    """
    return TestClient(app, client=("127.0.0.1", 50000))
