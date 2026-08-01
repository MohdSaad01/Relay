"""DeviceSession model — a currently-valid session token for a paired device.

Named DeviceSession (table name stays `sessions`) to avoid colliding with
sqlalchemy.orm.Session, which is already used throughout the database layer.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.device import Device


class DeviceSession(Base):
    """A short-lived bearer token issued to a device after pairing."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    # No column-level default: the actual expiry is issued_at + the configured
    # session lifetime (app_settings.session_token_lifetime_minutes), which is
    # a runtime, settings-dependent computation left to the service layer.
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    device: Mapped["Device"] = relationship(back_populates="sessions")
