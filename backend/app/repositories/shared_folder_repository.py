"""SharedFolderRepository — persistence for metadata of folders shared from
the desktop (P13), and for listing a shared folder's child SharedFile rows.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.shared_file import SharedFile
from app.models.shared_folder import SharedFolder
from app.repositories.base_repository import BaseRepository


class SharedFolderRepository(BaseRepository[SharedFolder]):
    """Database access for the `shared_folders` table."""

    def __init__(self, db: Session) -> None:
        super().__init__(db, SharedFolder)

    def create(self, shared_folder: SharedFolder) -> SharedFolder:
        """Add a new shared folder and flush so its generated id is available."""
        self.db.add(shared_folder)
        self.db.flush()
        return shared_folder

    def get_by_path(self, folder_path: str) -> SharedFolder | None:
        """Look up a shared folder by its unique filesystem path."""
        statement = select(SharedFolder).where(SharedFolder.folder_path == folder_path)
        return self.db.execute(statement).scalar_one_or_none()

    def list_all(self, *, limit: int = 100, offset: int = 0) -> list[SharedFolder]:
        """List shared folders, most recently shared first."""
        statement = (
            select(SharedFolder)
            .order_by(SharedFolder.shared_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.execute(statement).scalars().all())

    def list_files(self, shared_folder_id: int) -> list[SharedFile]:
        """List every child SharedFile row belonging to a shared folder, by relative path."""
        statement = (
            select(SharedFile)
            .where(SharedFile.shared_folder_id == shared_folder_id)
            .order_by(SharedFile.relative_path)
        )
        return list(self.db.execute(statement).scalars().all())

    def update(self, shared_folder: SharedFolder) -> SharedFolder:
        """Flush pending changes made to an already-tracked shared folder."""
        self.db.flush()
        return shared_folder

    def delete(self, shared_folder: SharedFolder) -> None:
        """Un-share a folder. Child SharedFile rows are cascade-deleted at the
        database level (shared_files.shared_folder_id, ON DELETE CASCADE);
        related transfers keep their history — transfers.shared_folder_id and
        transfers.shared_file_id are both SET NULL, not cascaded."""
        self.db.delete(shared_folder)
        self.db.flush()
