"""Tests for the get_current_device authentication dependency.

Not yet attached to any router (M9 design decision), so it is unit-tested
directly rather than through the TestClient/`client` fixture.
"""

from datetime import timedelta

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_device
from app.core.security import hash_token
from app.models.device_session import DeviceSession
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.services.auth_service import AuthService
from app.services.exceptions import AuthenticationError
from app.utils.time import utc_now
from tests.api.conftest import make_device


def _credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_get_current_device_returns_device_for_valid_credentials(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    DeviceSessionRepository(db_session).create(
        DeviceSession(
            device_id=device.id,
            token_hash=hash_token("valid-token"),
            expires_at=utc_now() + timedelta(minutes=30),
        )
    )

    found = get_current_device(_credentials("valid-token"), AuthService(db_session))

    assert found.id == device.id


def test_get_current_device_raises_when_credentials_missing(db_session: Session) -> None:
    with pytest.raises(AuthenticationError):
        get_current_device(None, AuthService(db_session))


def test_get_current_device_raises_for_unknown_token(db_session: Session) -> None:
    with pytest.raises(AuthenticationError):
        get_current_device(_credentials("unknown-token"), AuthService(db_session))
