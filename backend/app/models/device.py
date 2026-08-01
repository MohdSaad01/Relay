"""Device model — a paired Android device trusted to call protected endpoints."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, TimestampMixin
from app.models.enums import Platform, as_db_enum
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.device_session import DeviceSession
    from app.models.transfer import Transfer


class Device(Base, TimestampMixin):
    """An Android device that has completed pairing with this desktop."""

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_identifier: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    device_name: Mapped[str] = mapped_column(String, nullable=False)
    platform: Mapped[Platform] = mapped_column(as_db_enum(Platform), nullable=False)
    device_secret_hash: Mapped[str] = mapped_column(String, nullable=False)
    paired_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    sessions: Mapped[list["DeviceSession"]] = relationship(
        back_populates="device",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    transfers: Mapped[list["Transfer"]] = relationship(
        back_populates="device",
        passive_deletes=True,
    )
