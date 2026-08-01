"""SharedFile model — metadata for a file explicitly shared from the desktop."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base
from app.utils.time import utc_now

if TYPE_CHECKING:
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

    transfers: Mapped[list["Transfer"]] = relationship(
        back_populates="shared_file",
        passive_deletes=True,
    )
