"""Tests for DeviceSessionRepository."""

from datetime import timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.device_session import DeviceSession
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.utils.time import utc_now
from tests.repositories.conftest import make_device


def _make_session(device_id: int, token_hash: str = "hashed-token") -> DeviceSession:
    return DeviceSession(
        device_id=device_id, token_hash=token_hash, expires_at=utc_now()
    )


def test_create_assigns_id(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    repo = DeviceSessionRepository(db_session)

    session = repo.create(_make_session(device.id))

    assert session.id is not None


def test_get_by_token_hash_returns_matching_session(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    repo = DeviceSessionRepository(db_session)
    repo.create(_make_session(device.id, token_hash="find-me"))

    found = repo.get_by_token_hash("find-me")

    assert found is not None
    assert found.device_id == device.id


def test_duplicate_token_hash_raises_integrity_error(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    repo = DeviceSessionRepository(db_session)
    repo.create(_make_session(device.id, token_hash="duplicate-token"))

    with pytest.raises(IntegrityError):
        repo.create(_make_session(device.id, token_hash="duplicate-token"))


def test_list_by_device_returns_only_that_devices_sessions(db_session: Session) -> None:
    device_repo = DeviceRepository(db_session)
    device_a = device_repo.create(make_device(identifier="device-a"))
    device_b = device_repo.create(make_device(identifier="device-b"))
    repo = DeviceSessionRepository(db_session)
    repo.create(_make_session(device_a.id, token_hash="token-a"))
    repo.create(_make_session(device_b.id, token_hash="token-b"))

    sessions = repo.list_by_device(device_a.id)

    assert [s.token_hash for s in sessions] == ["token-a"]


def test_update_persists_mutated_field(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    repo = DeviceSessionRepository(db_session)
    session = repo.create(_make_session(device.id))
    new_expiry = utc_now() + timedelta(days=1)

    session.expires_at = new_expiry
    repo.update(session)

    refetched = repo.get_by_id(session.id)
    assert refetched is not None
    assert refetched.expires_at == new_expiry


def test_delete_removes_session(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    repo = DeviceSessionRepository(db_session)
    session = repo.create(_make_session(device.id))
    session_id = session.id

    repo.delete(session)

    assert repo.get_by_id(session_id) is None


def test_delete_expired_removes_only_expired_sessions(db_session: Session) -> None:
    device = DeviceRepository(db_session).create(make_device())
    repo = DeviceSessionRepository(db_session)
    now = utc_now()
    expired = repo.create(
        DeviceSession(
            device_id=device.id,
            token_hash="expired",
            expires_at=now - timedelta(days=1),
        )
    )
    still_valid = repo.create(
        DeviceSession(
            device_id=device.id, token_hash="valid", expires_at=now + timedelta(days=1)
        )
    )

    deleted_count = repo.delete_expired(now)

    assert deleted_count == 1
    assert repo.get_by_id(expired.id) is None
    assert repo.get_by_id(still_valid.id) is not None
