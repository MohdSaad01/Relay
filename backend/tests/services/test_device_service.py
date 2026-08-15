"""Tests for DeviceService."""

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from app.models.device_session import DeviceSession
from app.models.enums import Platform
from app.repositories.device_session_repository import DeviceSessionRepository
from app.services.device_service import DeviceService
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from app.utils.time import utc_now
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


def test_get_by_identifier_or_none_returns_none_when_absent(db_session: Session) -> None:
    service = DeviceService(db_session)

    assert service.get_by_identifier_or_none("unknown-device") is None


def test_get_by_identifier_or_none_returns_matching_device(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device(identifier="device-1"))

    found = service.get_by_identifier_or_none("device-1")

    assert found is not None
    assert found.id == device.id


def test_reconcile_device_rotates_secret_hash_only(db_session: Session) -> None:
    service = DeviceService(db_session)
    device = service.device_repository.create(make_device(identifier="device-1", name="Thomas"))
    db_session.commit()

    reconciled = service.reconcile_device(device, device_secret_hash="new-hash")
    db_session.commit()

    assert reconciled.id == device.id
    assert reconciled.device_name == "Thomas"
    assert reconciled.device_secret_hash == "new-hash"


# --- P43.1: name-collision detection and resolution ------------------------


def test_find_name_collision_or_none_returns_none_when_no_match(db_session: Session) -> None:
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1", name="Thomas"))

    assert service.find_name_collision_or_none("Sarah") is None


def test_find_name_collision_or_none_matches_case_insensitively_and_trims(db_session: Session) -> None:
    service = DeviceService(db_session)
    existing = service.device_repository.create(make_device(identifier="device-1", name="Thomas"))

    found = service.find_name_collision_or_none("  thomas  ")

    assert found is not None
    assert found.id == existing.id


def test_find_name_collision_or_none_does_not_match_a_suffixed_name(db_session: Session) -> None:
    """"Thomas (1)" is a distinct name from "Thomas" for suffix allocation purposes."""
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1", name="Thomas"))

    assert service.find_name_collision_or_none("Thomas (1)") is None


def test_generate_unique_name_returns_base_name_when_unused(db_session: Session) -> None:
    service = DeviceService(db_session)

    assert service.generate_unique_name("Thomas") == "Thomas"


def test_generate_unique_name_appends_one_when_base_taken(db_session: Session) -> None:
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1", name="Thomas"))

    assert service.generate_unique_name("Thomas") == "Thomas (1)"


def test_generate_unique_name_fills_the_smallest_gap(db_session: Session) -> None:
    """Thomas, Thomas (1), Thomas (3) exist -> the next name is Thomas (2), not Thomas (4)."""
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1", name="Thomas"))
    service.device_repository.create(make_device(identifier="device-2", name="Thomas (1)"))
    service.device_repository.create(make_device(identifier="device-3", name="Thomas (3)"))

    assert service.generate_unique_name("Thomas") == "Thomas (2)"


def test_generate_unique_name_continues_past_consecutive_suffixes(db_session: Session) -> None:
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1", name="Thomas"))
    service.device_repository.create(make_device(identifier="device-2", name="Thomas (1)"))
    service.device_repository.create(make_device(identifier="device-3", name="Thomas (2)"))

    assert service.generate_unique_name("Thomas") == "Thomas (3)"


def test_generate_unique_name_is_case_insensitive(db_session: Session) -> None:
    service = DeviceService(db_session)
    service.device_repository.create(make_device(identifier="device-1", name="thomas"))

    assert service.generate_unique_name("Thomas") == "Thomas (1)"


def test_replace_device_deletes_old_and_registers_new(db_session: Session) -> None:
    service = DeviceService(db_session)
    old_device = service.device_repository.create(make_device(identifier="old-id", name="Thomas"))
    db_session.commit()

    new_device = service.replace_device(
        old_device,
        device_identifier="new-id",
        device_name="Thomas",
        platform=Platform.ANDROID,
        device_secret_hash="new-hash",
    )
    db_session.commit()

    assert new_device.device_identifier == "new-id"
    # The old identifier no longer resolves to anything (its row is gone) —
    # id equality isn't asserted here: SQLite reuses a freed integer PK once
    # the table is empty (P17, documented in CLAUDE.md), which is expected
    # behavior, not a defect.
    assert service.get_by_identifier_or_none("old-id") is None
    assert [d.device_identifier for d in service.device_repository.list_all()] == ["new-id"]


def test_replace_device_invalidates_old_sessions(db_session: Session) -> None:
    """Deleting the old Device row must cascade-delete its sessions, via the
    same DB-level ON DELETE CASCADE remove_device/unpair already relies on —
    a replaced device's old credentials must stop authenticating immediately."""
    service = DeviceService(db_session)
    session_repo = DeviceSessionRepository(db_session)
    old_device = service.device_repository.create(make_device(identifier="old-id", name="Thomas"))
    db_session.commit()
    session_repo.create(
        DeviceSession(
            device_id=old_device.id,
            token_hash="old-token-hash",
            issued_at=utc_now(),
            expires_at=utc_now() + timedelta(minutes=30),
        )
    )
    db_session.commit()

    service.replace_device(
        old_device,
        device_identifier="new-id",
        device_name="Thomas",
        platform=Platform.ANDROID,
        device_secret_hash="new-hash",
    )
    db_session.commit()

    assert session_repo.get_by_token_hash("old-token-hash") is None
