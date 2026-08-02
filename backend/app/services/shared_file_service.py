"""SharedFileService — business logic for the desktop's shared file list
(13_Database_Design.md §6, 11_File_Transfer.md §5-6).

Only ever stats a path for name/size/mime type — never opens or reads file
contents. Streaming/transfer is a future milestone.
"""

import logging

from sqlalchemy.orm import Session

from app.models.shared_file import SharedFile
from app.repositories.shared_file_repository import SharedFileRepository
from app.services.exceptions import NotFoundError, ValidationError
from app.utils.filesystem import (
    FileMetadata,
    is_absolute_path,
    is_regular_file,
    is_symlink,
    path_exists,
    read_file_metadata,
)
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


class SharedFileService:
    """Business logic for sharing, listing, refreshing, and unsharing files."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.shared_file_repository = SharedFileRepository(db)

    def list_shared_files(self, *, limit: int = 100, offset: int = 0) -> list[SharedFile]:
        """Return shared files, most recently shared first."""
        return self.shared_file_repository.list_all(limit=limit, offset=offset)

    def get_shared_file_or_raise(self, shared_file_id: int) -> SharedFile:
        """Fetch a shared file by id, or raise NotFoundError if it does not exist."""
        shared_file = self.shared_file_repository.get_by_id(shared_file_id)
        if shared_file is None:
            raise NotFoundError(f"Shared file {shared_file_id} was not found.")
        return shared_file

    def share_file(self, file_path: str) -> tuple[SharedFile, bool]:
        """Add a file to the shared list, or refresh its metadata if the path is
        already shared.

        Returns (shared_file, was_created). was_created is False when an
        existing share at this path was refreshed instead of a new row
        being created — shared_files.file_path is unique
        (13_Database_Design.md §6), so re-sharing an already-shared path
        updates the existing row rather than duplicating it.
        """
        path = self._validate_shareable_path(file_path)
        metadata = self._read_metadata_or_raise(path)

        existing = self.shared_file_repository.get_by_path(path)
        if existing is not None:
            self._apply_metadata(existing, metadata)
            self.db.commit()
            logger.info("Shared file metadata refreshed via re-share: path=%s", path)
            return existing, False

        shared_file = SharedFile(
            file_name=metadata.file_name,
            file_path=path,
            file_size=metadata.file_size,
            mime_type=metadata.mime_type,
            shared_at=utc_now(),
        )
        self.shared_file_repository.create(shared_file)
        self.db.commit()
        logger.info("File shared: path=%s", path)
        return shared_file, True

    def refresh_metadata(self, shared_file_id: int) -> SharedFile:
        """Re-read a shared file's metadata from disk.

        Raises ValidationError if the file is missing, is no longer a
        regular file, or has become a symlink. The row is left untouched in
        every failure case — a missing source file is never auto-unshared;
        the user decides explicitly whether to remove it.
        """
        shared_file = self.get_shared_file_or_raise(shared_file_id)
        self._validate_shareable_path(shared_file.file_path)
        metadata = self._read_metadata_or_raise(shared_file.file_path)

        self._apply_metadata(shared_file, metadata)
        self.db.commit()
        logger.info(
            "Shared file metadata refreshed: id=%s path=%s", shared_file.id, shared_file.file_path
        )
        return shared_file

    def unshare_file(self, shared_file_id: int) -> None:
        """Remove a file from the shared list.

        Related transfers keep their history — shared_file_id is set NULL,
        not cascaded (13_Database_Design.md §7).
        """
        shared_file = self.get_shared_file_or_raise(shared_file_id)
        self.shared_file_repository.delete(shared_file)
        self.db.commit()
        logger.info("File unshared: id=%s path=%s", shared_file_id, shared_file.file_path)

    def _validate_shareable_path(self, file_path: str) -> str:
        """Validate structural and filesystem preconditions for a path to be shared
        or refreshed. Does not touch existing rows or the database."""
        path = file_path.strip()
        if not path:
            raise ValidationError("File path cannot be empty.")
        if not is_absolute_path(path):
            raise ValidationError("File path must be absolute.")
        if not path_exists(path):
            raise ValidationError(f"File does not exist: {path}")
        if is_symlink(path):
            raise ValidationError("Symbolic links are not supported for sharing.")
        if not is_regular_file(path):
            raise ValidationError("Only regular files can be shared; folders are not supported.")
        return path

    def _read_metadata_or_raise(self, file_path: str) -> FileMetadata:
        try:
            return read_file_metadata(file_path)
        except OSError as exc:
            logger.warning("Unable to read metadata for shared file: path=%s error=%s", file_path, exc)
            raise ValidationError("Unable to read file metadata.") from exc

    def _apply_metadata(self, shared_file: SharedFile, metadata: FileMetadata) -> None:
        """Refresh the mutable, disk-derived fields of an already-tracked shared file.

        file_name and file_path are immutable in practice: file_name is
        derived from file_path, and file_path is the row's unique key, so
        neither can drift for a given row without becoming a different
        share entirely. shared_at is also left untouched — it records when
        the user first shared the file, not when it was last refreshed.
        """
        shared_file.file_size = metadata.file_size
        shared_file.mime_type = metadata.mime_type
        self.shared_file_repository.update(shared_file)
