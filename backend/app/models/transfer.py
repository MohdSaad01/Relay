"""Transfer model — one row per file transfer, covering both progress and history."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.models.enums import TransferDirection, TransferStatus, as_db_enum
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.shared_file import SharedFile


class Transfer(Base):
    """A single file transfer, in progress or completed. Doubles as transfer history."""

    __tablename__ = "transfers"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_id: Mapped[int | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    shared_file_id: Mapped[int | None] = mapped_column(
        ForeignKey("shared_files.id", ondelete="SET NULL"), nullable=True
    )
    direction: Mapped[TransferDirection] = mapped_column(
        as_db_enum(TransferDirection), nullable=False
    )
    # file_name, file_size, and device_name are point-in-time snapshots taken
    # at transfer start, not live joins — this is what keeps transfer history
    # readable after the referenced device or shared file is deleted.
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    device_name: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[TransferStatus] = mapped_column(
        as_db_enum(TransferStatus), default=TransferStatus.IN_PROGRESS, nullable=False, index=True
    )
    bytes_transferred: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, nullable=False, index=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    device: Mapped["Device | None"] = relationship(back_populates="transfers")
    shared_file: Mapped["SharedFile | None"] = relationship(back_populates="transfers")
