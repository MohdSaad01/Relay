"""AppSettings model — singleton row of user-editable runtime preferences."""

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, TimestampMixin


class AppSettings(Base, TimestampMixin):
    """User-editable runtime preferences, distinct from static deployment config.

    Exactly one row (id=1) should ever exist. Enforcing that singleton is an
    application-level responsibility for a later milestone, not a database
    constraint.
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    # device_display_name and download_directory have no column-level default:
    # their real defaults (OS hostname, OS Downloads folder) are resolved at
    # first run by application code, not by the database.
    device_display_name: Mapped[str] = mapped_column(String, nullable=False)
    download_directory: Mapped[str] = mapped_column(String, nullable=False)
    discovery_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    session_token_lifetime_minutes: Mapped[int] = mapped_column(
        Integer, default=1440, nullable=False
    )
