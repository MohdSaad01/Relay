"""SharedFile model — metadata for a file explicitly shared from the desktop.

Also used for a shared folder's child files (P13): shared_folder_id and
relative_path are NULL for an ordinary standalone share, and both set when
this row was discovered while walking a shared folder
(SharedFolderService.share_folder). A folder's child rows are never listed
by GET /files (SharedFileRepository.list_all filters them out) — they only
ever surface via GET /folders/{id}/files.
"""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.utils.time import utc_now

if TYPE_CHECKING:
    from app.models.shared_folder import SharedFolder
    from app.models.transfer import Transfer


class SharedFile(Base):
    """A file the desktop user has added to the shared list."""

    __tablename__ = "shared_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    shared_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, nullable=False, index=True
    )
    # P13: set together, only for a shared folder's child file. ON DELETE
    # CASCADE (unlike transfers.shared_file_id's SET NULL below) — a child
    # row has no meaning once its parent folder share is removed, whereas
    # transfer history is deliberately preserved after a share is removed.
    shared_folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("shared_folders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    relative_path: Mapped[str | None] = mapped_column(String, nullable=True)

    transfers: Mapped[list["Transfer"]] = relationship(
        back_populates="shared_file",
        passive_deletes=True,
    )
    shared_folder: Mapped["SharedFolder | None"] = relationship(back_populates="files")
