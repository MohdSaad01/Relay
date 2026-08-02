"""Tests for the get_requesting_device dependency (Milestone 10).

Backs the one dual-audience route, GET /files: a loopback caller (the
desktop) resolves to None, any other caller must present a valid device
session, exactly like get_current_device.
"""

from datetime import timedelta

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.api.dependencies import get_requesting_device
from app.core.security import hash_token
from app.models.device_session import DeviceSession
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.services.auth_service import AuthService
from app.services.exceptions import AuthenticationError
from app.utils.time import utc_now
from tests.api.conftest import make_device


def _request_from(host: str | None) -> Request:
    client = (host, 12345) if host is not None else None
    return Request(scope={"type": "http", "client": client, "headers": []})


def _credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_returns_none_for_loopback_caller_without_credentials(db_session: Session) -> None:
    found = get_requesting_device(_request_from("127.0.0.1"), None, AuthService(db_session))

    assert found is None


def test_returns_none_for_ipv6_loopback_caller(db_session: Session) -> None:
    found = get_requesting_device(_request_from("::1"), None, AuthService(db_session))

    assert found is None


def test_returns_device_for_non_loopback_caller_with_valid_credentials(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    DeviceSessionRepository(db_session).create(
        DeviceSession(
            device_id=device.id,
            token_hash=hash_token("valid-token"),
            expires_at=utc_now() + timedelta(minutes=30),
        )
    )

    found = get_requesting_device(
        _request_from("198.51.100.10"), _credentials("valid-token"), AuthService(db_session)
    )

    assert found is not None
    assert found.id == device.id


def test_raises_for_non_loopback_caller_without_credentials(db_session: Session) -> None:
    with pytest.raises(AuthenticationError):
        get_requesting_device(_request_from("198.51.100.10"), None, AuthService(db_session))


def test_raises_for_non_loopback_caller_with_unknown_token(db_session: Session) -> None:
    with pytest.raises(AuthenticationError):
        get_requesting_device(
            _request_from("198.51.100.10"), _credentials("unknown-token"), AuthService(db_session)
        )
