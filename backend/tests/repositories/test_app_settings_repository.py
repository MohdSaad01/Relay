"""Tests for AppSettingsRepository."""

from sqlalchemy.orm import Session

from app.models.app_settings import AppSettings
from app.repositories.app_settings_repository import AppSettingsRepository


def _make_settings() -> AppSettings:
    return AppSettings(device_display_name="Saad-PC", download_directory="C:/Downloads")


def test_get_returns_none_before_creation(db_session: Session) -> None:
    repo = AppSettingsRepository(db_session)

    assert repo.get() is None


def test_create_then_get_returns_singleton_row(db_session: Session) -> None:
    repo = AppSettingsRepository(db_session)
    repo.create(_make_settings())

    settings = repo.get()

    assert settings is not None
    assert settings.id == 1
    assert settings.device_display_name == "Saad-PC"


def test_update_persists_mutated_field(db_session: Session) -> None:
    repo = AppSettingsRepository(db_session)
    settings = repo.create(_make_settings())

    settings.discovery_enabled = False
    repo.update(settings)

    refetched = repo.get()
    assert refetched is not None
    assert refetched.discovery_enabled is False


def test_repository_exposes_no_delete_method() -> None:
    assert not hasattr(AppSettingsRepository, "delete")
