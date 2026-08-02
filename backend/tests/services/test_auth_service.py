"""Tests for AuthService."""

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from app.core.security import hash_token
from app.models.device import Device
from app.models.device_session import DeviceSession
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.services.auth_service import AuthService
from app.services.exceptions import AuthenticationError
from app.utils.time import utc_now
from tests.services.conftest import make_device


def _paired_device_with_session(
    db_session: Session, token: str, *, expired: bool = False
) -> tuple[Device, DeviceSession]:
    device = DeviceRepository(db_session).create(make_device())
    now = utc_now()
    expires_at = now - timedelta(minutes=1) if expired else now + timedelta(minutes=30)
    session = DeviceSessionRepository(db_session).create(
        DeviceSession(device_id=device.id, token_hash=hash_token(token), expires_at=expires_at)
    )
    return device, session


def test_authenticate_returns_device_for_valid_token(db_session: Session) -> None:
    service = AuthService(db_session)
    device, _ = _paired_device_with_session(db_session, "valid-token")

    found = service.authenticate("valid-token")

    assert found.id == device.id


def test_authenticate_raises_for_missing_token(db_session: Session) -> None:
    service = AuthService(db_session)

    with pytest.raises(AuthenticationError):
        service.authenticate(None)


def test_authenticate_raises_for_unknown_token(db_session: Session) -> None:
    service = AuthService(db_session)
    _paired_device_with_session(db_session, "some-other-token")

    with pytest.raises(AuthenticationError):
        service.authenticate("unknown-token")


def test_authenticate_raises_and_deletes_expired_session(db_session: Session) -> None:
    service = AuthService(db_session)
    _, session = _paired_device_with_session(db_session, "expired-token", expired=True)
    session_id = session.id

    with pytest.raises(AuthenticationError):
        service.authenticate("expired-token")

    assert DeviceSessionRepository(db_session).get_by_id(session_id) is None


def test_authenticate_updates_last_used_and_last_seen(db_session: Session) -> None:
    service = AuthService(db_session)
    device, session = _paired_device_with_session(db_session, "valid-token")
    assert session.last_used_at is None
    assert device.last_seen_at is None

    service.authenticate("valid-token")

    assert session.last_used_at is not None
    assert device.last_seen_at is not None


def test_authenticate_does_not_commit(db_session: Session) -> None:
    """AuthService must not own the transaction boundary (M9 design decision):
    without a commit from the caller, its last_used_at/last_seen_at writes
    are rolled back like any other uncommitted change."""
    service = AuthService(db_session)
    device, session = _paired_device_with_session(db_session, "valid-token")
    db_session.commit()  # persist the paired device/session as a baseline

    service.authenticate("valid-token")
    db_session.rollback()

    refetched_session = DeviceSessionRepository(db_session).get_by_id(session.id)
    refetched_device = DeviceRepository(db_session).get_by_id(device.id)
    assert refetched_session is not None
    assert refetched_session.last_used_at is None
    assert refetched_device is not None
    assert refetched_device.last_seen_at is None
