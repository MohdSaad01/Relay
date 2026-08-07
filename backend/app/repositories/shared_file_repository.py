"""SharedFileRepository — persistence for metadata of files shared from the desktop."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.shared_file import SharedFile
from app.repositories.base_repository import BaseRepository


class SharedFileRepository(BaseRepository[SharedFile]):
    """Database access for the `shared_files` table."""

    def __init__(self, db: Session) -> None:
        super().__init__(db, SharedFile)

    def create(self, shared_file: SharedFile) -> SharedFile:
        """Add a new shared file and flush so its generated id is available."""
        self.db.add(shared_file)
        self.db.flush()
        return shared_file

    def get_by_path(self, file_path: str) -> SharedFile | None:
        """Look up a shared file by its unique filesystem path."""
        statement = select(SharedFile).where(SharedFile.file_path == file_path)
        return self.db.execute(statement).scalar_one_or_none()

    def list_all(self, *, limit: int = 100, offset: int = 0) -> list[SharedFile]:
        """List top-level standalone shared files, most recently shared first.

        Excludes a shared folder's child rows (shared_folder_id IS NOT NULL,
        P13) — those only ever surface via GET /folders/{id}/files, never in
        this flat list, per 11_File_Transfer.md's "must not display every
        contained file individually."
        """
        statement = (
            select(SharedFile)
            .where(SharedFile.shared_folder_id.is_(None))
            .order_by(SharedFile.shared_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.execute(statement).scalars().all())

    def update(self, shared_file: SharedFile) -> SharedFile:
        """Flush pending changes made to an already-tracked shared file."""
        self.db.flush()
        return shared_file

    def delete(self, shared_file: SharedFile) -> None:
        """Un-share a file. Related transfers have their shared_file_id set NULL."""
        self.db.delete(shared_file)
        self.db.flush()
