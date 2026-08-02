"""Filesystem helpers for inspecting a file the desktop user has selected to share.

Pure, read-only, and framework/business-rule agnostic (04_Project_Structure.md
§14: "avoid placing business logic here"). Callers in the Service Layer
translate the exceptions raised here into app/services/exceptions.py errors.
"""

import mimetypes
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class FileMetadata:
    """Point-in-time metadata read from disk for a shared file."""

    file_name: str
    file_size: int
    mime_type: str | None


def is_absolute_path(file_path: str) -> bool:
    """Whether the path is absolute, rather than relative to some unknown working directory."""
    return os.path.isabs(file_path)


def path_exists(file_path: str) -> bool:
    """Whether a filesystem entry currently exists at this path."""
    return os.path.exists(file_path)


def is_regular_file(file_path: str) -> bool:
    """Whether the path is a regular file. False for directories (folder sharing is out of
    scope, 11_File_Transfer.md §6) and for paths that do not exist."""
    return os.path.isfile(file_path)


def is_symlink(file_path: str) -> bool:
    """Whether the path is a symbolic link. Version 1 does not follow or share these."""
    return os.path.islink(file_path)


def read_file_metadata(file_path: str) -> FileMetadata:
    """Stat a file and return its shareable metadata.

    Assumes the caller has already confirmed the path exists and is a
    regular file. Raises OSError (e.g. PermissionError) if the file cannot
    be stat-ed.
    """
    stat_result = os.stat(file_path)
    file_name = os.path.basename(file_path)
    mime_type, _ = mimetypes.guess_type(file_path)
    return FileMetadata(file_name=file_name, file_size=stat_result.st_size, mime_type=mime_type)


def resolve_available_path(directory: str, file_name: str) -> str:
    """Return an absolute path for `file_name` inside `directory` that does not
    currently exist, resolving a conflict (if any) with the conventional
    "name (1).ext", "name (2).ext", ... pattern.

    Pure filesystem check: the caller is responsible for creating the file
    promptly afterward, since a file could in principle appear at the
    returned path between this check and that write (an accepted, narrow
    race for a local single-user application -- see TransferStreamService).
    """
    candidate = os.path.join(directory, file_name)
    if not os.path.exists(candidate):
        return candidate

    base, ext = os.path.splitext(file_name)
    counter = 1
    while True:
        candidate = os.path.join(directory, f"{base} ({counter}){ext}")
        if not os.path.exists(candidate):
            return candidate
        counter += 1
