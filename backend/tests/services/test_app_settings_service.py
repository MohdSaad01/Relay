"""Tests for AppSettingsService."""

import pytest
from sqlalchemy.orm import Session

from app.services.app_settings_service import AppSettingsService
from app.services.exceptions import ValidationError


def test_get_settings_creates_default_row_on_first_run(db_session: Session) -> None:
    service = AppSettingsService(db_session)

    settings = service.get_settings()

    assert settings.id == 1
    assert settings.device_display_name
    assert settings.download_directory


def test_get_settings_returns_same_row_on_subsequent_calls(db_session: Session) -> None:
    service = AppSettingsService(db_session)
    first = service.get_settings()

    second = service.get_settings()

    assert second.id == first.id
    assert second.device_display_name == first.device_display_name


def test_update_settings_applies_partial_changes(db_session: Session) -> None:
    service = AppSettingsService(db_session)
    service.get_settings()

    updated = service.update_settings(
        discovery_enabled=False, session_token_lifetime_minutes=60
    )

    assert updated.discovery_enabled is False
    assert updated.session_token_lifetime_minutes == 60


def test_update_settings_leaves_unspecified_fields_untouched(
    db_session: Session,
) -> None:
    service = AppSettingsService(db_session)
    original = service.get_settings()
    original_directory = original.download_directory

    updated = service.update_settings(discovery_enabled=False)

    assert updated.download_directory == original_directory


def test_update_settings_persists_after_commit(db_session: Session) -> None:
    service = AppSettingsService(db_session)
    service.get_settings()

    service.update_settings(device_display_name="New Name")
    db_session.rollback()  # no-op if the service already committed

    refetched = service.get_settings()
    assert refetched.device_display_name == "New Name"


def test_update_settings_rejects_blank_display_name(db_session: Session) -> None:
    service = AppSettingsService(db_session)
    service.get_settings()

    with pytest.raises(ValidationError):
        service.update_settings(device_display_name="   ")


def test_update_settings_rejects_blank_download_directory(db_session: Session) -> None:
    service = AppSettingsService(db_session)
    service.get_settings()

    with pytest.raises(ValidationError):
        service.update_settings(download_directory="   ")


def test_update_settings_rejects_non_positive_session_lifetime(
    db_session: Session,
) -> None:
    service = AppSettingsService(db_session)
    service.get_settings()

    with pytest.raises(ValidationError):
        service.update_settings(session_token_lifetime_minutes=0)
