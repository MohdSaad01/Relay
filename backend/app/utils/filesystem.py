"""Filesystem helpers for inspecting a file the desktop user has selected to share.

Pure, read-only, and framework/business-rule agnostic (04_Project_Structure.md
§14: "avoid placing business logic here"). Callers in the Service Layer
translate the exceptions raised here into app/services/exceptions.py errors.
"""

import mimetypes
import os
from collections.abc import Callable, Iterator
from dataclasses import dataclass


@dataclass(frozen=True)
class FileMetadata:
    """Point-in-time metadata read from disk for a shared file."""

    file_name: str
    file_size: int
    mime_type: str | None


@dataclass(frozen=True)
class FolderEntryMetadata:
    """Point-in-time metadata for one regular file discovered while walking a
    shared folder (P13). `relative_path` is always POSIX-style (forward
    slashes), relative to the folder root being walked — the wire/DB format
    documented in docs/13_Database_Design.md §6, regardless of host OS.
    """

    absolute_path: str
    relative_path: str
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
    """Whether the path is a regular file. False for directories (a folder is
    shared via SharedFolderService/is_directory instead — see P13) and for
    paths that do not exist."""
    return os.path.isfile(file_path)


def is_directory(file_path: str) -> bool:
    """Whether the path is a directory. False for regular files, symlinks
    (checked separately via is_symlink), and paths that do not exist."""
    return os.path.isdir(file_path)


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


def walk_directory(
    root_path: str,
    *,
    on_stat_error: Callable[[str, OSError], None] | None = None,
) -> Iterator[FolderEntryMetadata]:
    """Recursively discover every regular file under `root_path` (P13 folder
    sharing), yielding one FolderEntryMetadata per file.

    Stays pure and read-only, like the rest of this module, by not deciding
    on its own whether a file that can't be stat-ed (permission error, a
    path too long for the host OS, ...) should abort the whole walk or just
    be skipped — that policy decision is left to the caller via
    `on_stat_error`, mirroring os.walk's own `onerror` parameter. With no
    callback given (the default), the OSError simply propagates and stops
    the walk. SharedFolderService passes a callback that logs and continues,
    so one bad file never fails an entire folder share.

    Symlinks are never followed (os.walk's own default, made explicit here):
    a symlinked file is skipped entirely and a symlinked directory is never
    descended into, mirroring is_symlink's rejection of a symlinked single
    file — this prevents both walk loops and escaping the shared root.
    Hidden files (dotfiles) are not treated specially — Windows has no
    filename-based "hidden" convention, so P13 shares them like any other
    file, and "everything must be restored exactly" (docs/11_File_Transfer.md
    §6) argues against silently dropping them.
    """
    for current_dir, _dirnames, filenames in os.walk(root_path, followlinks=False):
        for name in filenames:
            absolute_path = os.path.join(current_dir, name)
            if is_symlink(absolute_path):
                continue
            try:
                stat_result = os.stat(absolute_path)
            except OSError as exc:
                if on_stat_error is None:
                    raise
                on_stat_error(absolute_path, exc)
                continue
            relative_path = os.path.relpath(absolute_path, root_path).replace(os.sep, "/")
            mime_type, _ = mimetypes.guess_type(absolute_path)
            yield FolderEntryMetadata(
                absolute_path=absolute_path,
                relative_path=relative_path,
                file_name=name,
                file_size=stat_result.st_size,
                mime_type=mime_type,
            )


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
