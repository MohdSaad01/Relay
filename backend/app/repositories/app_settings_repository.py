"""AppSettingsRepository — persistence for the singleton runtime preferences row."""

from sqlalchemy.orm import Session

from app.models.app_settings import AppSettings
from app.repositories.base_repository import BaseRepository

SETTINGS_ROW_ID = 1


class AppSettingsRepository(BaseRepository[AppSettings]):
    """Database access for the `app_settings` table. Exactly one row (id=1) ever exists."""

    def __init__(self, db: Session) -> None:
        super().__init__(db, AppSettings)

    def get(self) -> AppSettings | None:
        """Fetch the singleton settings row, or None if it has not been created yet."""
        return self.get_by_id(SETTINGS_ROW_ID)

    def create(self, settings: AppSettings) -> AppSettings:
        """Add the singleton settings row (first-run creation) and flush."""
        self.db.add(settings)
        self.db.flush()
        return settings

    def update(self, settings: AppSettings) -> AppSettings:
        """Flush pending changes made to the already-tracked settings row."""
        self.db.flush()
        return settings
