"""AppSettingsService — business logic for the singleton application settings row."""

import socket
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.app_settings import AppSettings
from app.repositories.app_settings_repository import AppSettingsRepository
from app.services.exceptions import ValidationError


class AppSettingsService:
    """Business logic for retrieving and updating application settings."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.app_settings_repository = AppSettingsRepository(db)

    def get_settings(self) -> AppSettings:
        """Return the singleton settings row, creating it with defaults on first run."""
        settings = self.app_settings_repository.get()
        if settings is not None:
            return settings

        settings = AppSettings(
            device_display_name=socket.gethostname(),
            download_directory=str(Path.home() / "Downloads"),
        )
        self.app_settings_repository.create(settings)
        self.db.commit()
        return settings

    def update_settings(
        self,
        *,
        device_display_name: str | None = None,
        download_directory: str | None = None,
        discovery_enabled: bool | None = None,
        session_token_lifetime_minutes: int | None = None,
    ) -> AppSettings:
        """Apply a partial update to the settings row. Only provided fields are changed."""
        settings = self.get_settings()

        if device_display_name is not None:
            name = device_display_name.strip()
            if not name:
                raise ValidationError("Device display name cannot be empty.")
            settings.device_display_name = name

        if download_directory is not None:
            directory = download_directory.strip()
            if not directory:
                raise ValidationError("Download directory cannot be empty.")
            settings.download_directory = directory

        if discovery_enabled is not None:
            settings.discovery_enabled = discovery_enabled

        if session_token_lifetime_minutes is not None:
            if session_token_lifetime_minutes <= 0:
                raise ValidationError(
                    "Session token lifetime must be a positive number of minutes."
                )
            settings.session_token_lifetime_minutes = session_token_lifetime_minutes

        self.app_settings_repository.update(settings)
        self.db.commit()
        return settings
