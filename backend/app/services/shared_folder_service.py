"""SharedFolderService — business logic for sharing, listing, refreshing,
and unsharing whole folders (P13, docs/13_Database_Design.md §6 extended).

Structured exactly like SharedFileService: a folder is validated, walked
once at share time, and its child files are snapshotted into ordinary
SharedFile rows (shared_folder_id/relative_path set) — no new streaming or
transfer concept is introduced. Refreshing a folder re-walks it and
reconciles the child rows (update matched, insert new, delete vanished)
rather than the single-file service's simpler "re-stat one path," since a
folder's contents can change shape between shares, not just size.
"""

import logging
import os

from sqlalchemy.orm import Session

from app.models.shared_file import SharedFile
from app.models.shared_folder import SharedFolder
from app.repositories.shared_file_repository import SharedFileRepository
from app.repositories.shared_folder_repository import SharedFolderRepository
from app.services.exceptions import NotFoundError, ValidationError
from app.utils.filesystem import (
    FolderEntryMetadata,
    is_absolute_path,
    is_directory,
    is_symlink,
    path_exists,
    walk_directory,
)
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


class SharedFolderService:
    """Business logic for sharing, listing, refreshing, and unsharing whole folders."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.shared_folder_repository = SharedFolderRepository(db)
        self.shared_file_repository = SharedFileRepository(db)

    def list_shared_folders(self, *, limit: int = 100, offset: int = 0) -> list[SharedFolder]:
        """Return shared folders, most recently shared first."""
        return self.shared_folder_repository.list_all(limit=limit, offset=offset)

    def get_shared_folder_or_raise(self, shared_folder_id: int) -> SharedFolder:
        """Fetch a shared folder by id, or raise NotFoundError if it does not exist."""
        shared_folder = self.shared_folder_repository.get_by_id(shared_folder_id)
        if shared_folder is None:
            raise NotFoundError(f"Shared folder {shared_folder_id} was not found.")
        return shared_folder

    def list_folder_files(self, shared_folder_id: int) -> list[SharedFile]:
        """List every child file of a shared folder (used to drive per-file
        download proposals — the folder itself is never streamed as a unit)."""
        self.get_shared_folder_or_raise(shared_folder_id)
        return self.shared_folder_repository.list_files(shared_folder_id)

    def share_folder(self, folder_path: str) -> tuple[SharedFolder, bool]:
        """Add a folder to the shared list, or refresh it if the path is
        already shared. Returns (shared_folder, was_created), matching
        SharedFileService.share_file's contract — shared_folders.folder_path
        is unique, so re-sharing an already-shared folder refreshes it
        in place instead of duplicating it.
        """
        path = self._validate_shareable_folder_path(folder_path)
        entries = list(self._walk_and_collect(path))

        existing = self.shared_folder_repository.get_by_path(path)
        if existing is not None:
            self._apply_walk_result(existing, entries)
            self.db.commit()
            logger.info("Shared folder refreshed via re-share: path=%s files=%s", path, len(entries))
            return existing, False

        shared_folder = SharedFolder(
            folder_name=_folder_display_name(path),
            folder_path=path,
            total_size=0,
            file_count=0,
            shared_at=utc_now(),
        )
        self.shared_folder_repository.create(shared_folder)
        self._apply_walk_result(shared_folder, entries)
        self.db.commit()
        logger.info("Folder shared: path=%s files=%s", path, len(entries))
        return shared_folder, True

    def refresh_folder(self, shared_folder_id: int) -> SharedFolder:
        """Re-walk a shared folder from disk, reconciling its child files:
        update ones still present, add new ones, remove ones no longer
        found. The folder row itself is left untouched on failure — a
        missing/inaccessible folder is never auto-unshared, matching
        SharedFileService.refresh_metadata's same policy for a single file.
        """
        shared_folder = self.get_shared_folder_or_raise(shared_folder_id)
        self._validate_shareable_folder_path(shared_folder.folder_path)
        entries = list(self._walk_and_collect(shared_folder.folder_path))

        self._apply_walk_result(shared_folder, entries)
        self.db.commit()
        logger.info(
            "Shared folder refreshed: id=%s path=%s files=%s",
            shared_folder.id,
            shared_folder.folder_path,
            len(entries),
        )
        return shared_folder

    def unshare_folder(self, shared_folder_id: int) -> None:
        """Remove a folder from the shared list. Child SharedFile rows are
        cascade-deleted at the database level; related transfers keep their
        history (shared_folder_id/shared_file_id are SET NULL, not cascaded)."""
        shared_folder = self.get_shared_folder_or_raise(shared_folder_id)
        self.shared_folder_repository.delete(shared_folder)
        self.db.commit()
        logger.info("Folder unshared: id=%s path=%s", shared_folder_id, shared_folder.folder_path)

    def _validate_shareable_folder_path(self, folder_path: str) -> str:
        """Validate structural and filesystem preconditions for a path to be
        shared or refreshed as a folder. Does not touch existing rows."""
        path = folder_path.strip()
        if not path:
            raise ValidationError("Folder path cannot be empty.")
        if not is_absolute_path(path):
            raise ValidationError("Folder path must be absolute.")
        if not path_exists(path):
            raise ValidationError(f"Folder does not exist: {path}")
        if is_symlink(path):
            raise ValidationError("Symbolic links are not supported for sharing.")
        if not is_directory(path):
            raise ValidationError("Only folders can be shared with this endpoint; use /files for a single file.")
        return path

    def _walk_and_collect(self, folder_path: str) -> list[FolderEntryMetadata]:
        """Walk a validated folder, logging and skipping any individual file
        that can't be stat-ed (permission error, a path too long for the
        host OS, ...) rather than failing the entire share — see
        docs/15_QA_NOTEBOOK.md's existing Windows long-path entry for the
        same underlying OS constraint."""

        def _on_stat_error(path: str, exc: OSError) -> None:
            logger.warning("Skipping unreadable file during folder walk: path=%s error=%s", path, exc)

        return list(walk_directory(folder_path, on_stat_error=_on_stat_error))

    def _apply_walk_result(self, shared_folder: SharedFolder, entries: list[FolderEntryMetadata]) -> None:
        """Reconcile a shared folder's child SharedFile rows against a fresh
        walk, and update the folder's own total_size/file_count snapshot.
        Used identically for both a brand-new share (no existing children)
        and a refresh (children already exist) — a new share is simply the
        degenerate case of reconciling against an empty child set.
        """
        existing_by_relative_path = {
            child.relative_path: child for child in self.shared_folder_repository.list_files(shared_folder.id)
        }
        seen_relative_paths: set[str] = set()

        for entry in entries:
            seen_relative_paths.add(entry.relative_path)
            child = existing_by_relative_path.get(entry.relative_path)
            if child is not None:
                child.file_size = entry.file_size
                child.mime_type = entry.mime_type
                self.shared_file_repository.update(child)
            else:
                new_child = SharedFile(
                    file_name=entry.file_name,
                    file_path=entry.absolute_path,
                    file_size=entry.file_size,
                    mime_type=entry.mime_type,
                    shared_at=utc_now(),
                    shared_folder_id=shared_folder.id,
                    relative_path=entry.relative_path,
                )
                self.shared_file_repository.create(new_child)

        for relative_path, child in existing_by_relative_path.items():
            if relative_path not in seen_relative_paths:
                self.shared_file_repository.delete(child)

        shared_folder.total_size = sum(entry.file_size for entry in entries)
        shared_folder.file_count = len(entries)
        self.shared_folder_repository.update(shared_folder)


def _folder_display_name(folder_path: str) -> str:
    """The folder's own display name — the last path component, with any
    trailing separator stripped first (os.path.basename("C:/A/B/") would
    otherwise return an empty string)."""
    return os.path.basename(os.path.normpath(folder_path))
