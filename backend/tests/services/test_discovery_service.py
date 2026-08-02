"""Tests for DiscoveryService."""

import json
import socket
from collections.abc import Generator
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.database.base import Base
from app.services.app_settings_service import AppSettingsService
from app.services.discovery_service import DiscoveryService


@pytest.fixture
def session_factory() -> Generator[sessionmaker, None, None]:
    """A sessionmaker bound to a single shared in-memory SQLite connection.

    Uses StaticPool so the broadcast thread (a different thread than the
    test itself) sees the same database the test set up, matching how
    tests/api/conftest.py builds its test engine for the same reason.
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
    yield sessionmaker(bind=engine, autoflush=False, autocommit=False)
    engine.dispose()


def test_instance_id_is_unique_per_instance() -> None:
    first = DiscoveryService()
    second = DiscoveryService()

    assert first.instance_id != second.instance_id


def test_is_broadcasting_false_before_start() -> None:
    service = DiscoveryService()

    assert service.is_broadcasting is False


def test_start_then_stop_toggles_is_broadcasting(session_factory: sessionmaker) -> None:
    service = DiscoveryService(session_factory=session_factory)

    service.start()
    try:
        assert service.is_broadcasting is True
    finally:
        service.stop()

    assert service.is_broadcasting is False


def test_start_is_idempotent(session_factory: sessionmaker) -> None:
    service = DiscoveryService(session_factory=session_factory)

    service.start()
    try:
        first_thread = service._thread
        service.start()  # should not replace the running thread
        assert service._thread is first_thread
    finally:
        service.stop()


def test_stop_before_start_is_a_no_op() -> None:
    service = DiscoveryService()

    service.stop()  # does not raise


def test_start_swallows_socket_creation_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise_os_error(*args: object, **kwargs: object) -> socket.socket:
        raise OSError("no network")

    monkeypatch.setattr(socket, "socket", _raise_os_error)
    service = DiscoveryService()

    service.start()  # does not raise

    assert service.is_broadcasting is False


def test_broadcast_once_sends_nothing_when_discovery_disabled(
    session_factory: sessionmaker,
) -> None:
    db = session_factory()
    AppSettingsService(db).update_settings(discovery_enabled=False)
    db.close()

    service = DiscoveryService(session_factory=session_factory)
    fake_socket = MagicMock()

    service._broadcast_once(fake_socket, get_settings())

    fake_socket.sendto.assert_not_called()


def test_broadcast_once_sends_expected_payload_when_enabled(
    session_factory: sessionmaker,
) -> None:
    db = session_factory()
    app_settings = AppSettingsService(db).update_settings(
        device_display_name="Saad's PC", discovery_enabled=True
    )
    device_display_name = app_settings.device_display_name
    db.close()

    service = DiscoveryService(session_factory=session_factory)
    fake_socket = MagicMock()
    settings = get_settings()

    service._broadcast_once(fake_socket, settings)

    fake_socket.sendto.assert_called_once()
    message, address = fake_socket.sendto.call_args.args
    assert address == ("255.255.255.255", settings.DISCOVERY_PORT)

    payload = json.loads(message.decode("utf-8"))
    assert payload["type"] == "relay_discovery_announce"
    assert payload["protocol_version"] == settings.DISCOVERY_PROTOCOL_VERSION
    assert payload["instance_id"] == service.instance_id
    assert payload["device_display_name"] == device_display_name
    assert payload["port"] == settings.PORT
