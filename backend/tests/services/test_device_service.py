"""Tests for DeviceService."""

import pytest
from sqlalchemy.orm import Session

from app.models.enums import Platform
from app.services.device_service import DeviceService
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from tests.services.conftest import make_device


def test_list_devices_returns_every_device(db_session: Session) -> None:
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1"))
    service.device_repository.create(make_device(identifier="device-2"))

    devices = service.list_devices()

    assert {d.device_identifier for d in devices} == {"device-1", "device-2"}


def test_get_device_or_raise_returns_matching_device(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device())

    found = service.get_device_or_raise(device.id)

    assert found.id == device.id


def test_get_device_or_raise_raises_when_missing(db_session: Session) -> None:
    service = DeviceService(db_session)

    with pytest.raises(NotFoundError):
        service.get_device_or_raise(999)


def test_rename_device_updates_name(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device())

    renamed = service.rename_device(device.id, "New Name")

    assert renamed.device_name == "New Name"


def test_rename_device_trims_whitespace(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device())

    renamed = service.rename_device(device.id, "  Padded Name  ")

    assert renamed.device_name == "Padded Name"


def test_rename_device_rejects_blank_name(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device())

    with pytest.raises(ValidationError):
        service.rename_device(device.id, "   ")


def test_rename_device_raises_when_missing(db_session: Session) -> None:
    service = DeviceService(db_session)

    with pytest.raises(NotFoundError):
        service.rename_device(999, "New Name")


def test_rename_device_persists_after_commit(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device())

    service.rename_device(device.id, "New Name")
    db_session.rollback()  # no-op if the service already committed

    refetched = service.get_device_or_raise(device.id)
    assert refetched.device_name == "New Name"


def test_remove_device_deletes_it(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device())
    device_id = device.id

    service.remove_device(device_id)

    assert service.device_repository.get_by_id(device_id) is None


def test_remove_device_raises_when_missing(db_session: Session) -> None:
    service = DeviceService(db_session)

    with pytest.raises(NotFoundError):
        service.remove_device(999)


def test_is_device_registered_returns_false_when_absent(db_session: Session) -> None:
    service = DeviceService(db_session)

    assert service.is_device_registered("unknown-device") is False


def test_is_device_registered_returns_true_once_paired(db_session: Session) -> None:
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1"))

    assert service.is_device_registered("device-1") is True


def test_register_device_creates_device(db_session: Session) -> None:
    service = DeviceService(db_session)

    device = service.register_device(
        device_identifier="device-1",
        device_name="Test Phone",
        platform=Platform.ANDROID,
        device_secret_hash="hashed-secret",
    )
    db_session.commit()

    assert device.id is not None
    assert service.get_device_or_raise(device.id).device_identifier == "device-1"


def test_register_device_raises_conflict_when_already_paired(db_session: Session) -> None:
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1"))

    with pytest.raises(ConflictError):
        service.register_device(
            device_identifier="device-1",
            device_name="Test Phone",
            platform=Platform.ANDROID,
            device_secret_hash="hashed-secret",
        )
