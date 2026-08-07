"""SharedFolder model — metadata for a folder explicitly shared from the
desktop (P13). Mirrors SharedFile in shape and philosophy: total_size and
file_count are point-in-time snapshots taken by walking the folder at share
time, not live-computed on every request — refreshed the same way a shared
file's size is, via the existing "refresh" flow (SharedFolderService).
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.shared_file import SharedFile


class SharedFolder(Base):
    """A folder the desktop user has added to the shared list, sharing as one item."""

    __tablename__ = "shared_folders"

    id: Mapped[int] = mapped_column(primary_key=True)
    folder_name: Mapped[str] = mapped_column(String, nullable=False)
    folder_path: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    total_size: Mapped[int] = mapped_column(Integer, nullable=False)
    file_count: Mapped[int] = mapped_column(Integer, nullable=False)
    shared_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, nullable=False, index=True
    )

    files: Mapped[list["SharedFile"]] = relationship(
        back_populates="shared_folder",
        passive_deletes=True,
    )
