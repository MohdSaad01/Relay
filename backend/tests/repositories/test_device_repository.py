"""Tests for DeviceRepository."""

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.repositories.device_repository import DeviceRepository
from tests.repositories.conftest import make_device


def test_create_assigns_id(db_session: Session) -> None:
    repo = DeviceRepository(db_session)

    device = repo.create(make_device())

    assert device.id is not None


def test_get_by_identifier_returns_matching_device(db_session: Session) -> None:
    repo = DeviceRepository(db_session)
    repo.create(make_device(identifier="device-uuid-1"))

    found = repo.get_by_identifier("device-uuid-1")

    assert found is not None
    assert found.device_identifier == "device-uuid-1"


def test_get_by_identifier_returns_none_when_missing(db_session: Session) -> None:
    repo = DeviceRepository(db_session)

    assert repo.get_by_identifier("does-not-exist") is None


def test_duplicate_identifier_raises_integrity_error(db_session: Session) -> None:
    repo = DeviceRepository(db_session)
    repo.create(make_device(identifier="duplicate-id"))

    with pytest.raises(IntegrityError):
        repo.create(make_device(identifier="duplicate-id", name="Other Phone"))


def test_list_all_returns_every_device(db_session: Session) -> None:
    repo = DeviceRepository(db_session)
    repo.create(make_device(identifier="device-1"))
    repo.create(make_device(identifier="device-2"))

    devices = repo.list_all()

    assert {d.device_identifier for d in devices} == {"device-1", "device-2"}


def test_update_persists_mutated_field(db_session: Session) -> None:
    repo = DeviceRepository(db_session)
    device = repo.create(make_device())

    device.device_name = "Renamed Phone"
    repo.update(device)

    refetched = repo.get_by_id(device.id)
    assert refetched is not None
    assert refetched.device_name == "Renamed Phone"


def test_delete_removes_device(db_session: Session) -> None:
    repo = DeviceRepository(db_session)
    device = repo.create(make_device())
    device_id = device.id

    repo.delete(device)

    assert repo.get_by_id(device_id) is None
