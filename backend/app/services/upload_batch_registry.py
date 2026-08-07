"""UploadBatchRegistry — in-memory cache of the conflict-free top-level
folder name resolved for an in-progress Android folder upload (P13).

An Android folder upload has no durable shared_folders row (uploads are
transient — see 13_Database_Design.md §6's existing single-file asymmetry),
so there is nothing in the database to hold "what did we end up naming
'Photos' on disk, after resolving a collision with an already-existing
folder." That has to be decided once, the first time any child of a given
upload_batch_id is accepted, and then reused for every subsequent child in
the same batch — otherwise different files from the same folder pick could
land under different disambiguated folder names.

Same lock-guarded singleton shape as ActiveStreamRegistry/TransferManager.
Entries are not proactively swept: TransferManager and PairingManager's own
cleanup_expired() methods exist but are not wired to any scheduler either
(nothing outside their tests calls them), so unswept, process-lifetime
growth here matches existing precedent for this class of in-memory state
rather than introducing new cleanup wiring this codebase doesn't otherwise
have.
"""

import os
import threading

from app.utils.filesystem import resolve_available_path


class UploadBatchRegistry:
    """Resolves and memoizes one conflict-free top-level folder name per
    upload_batch_id, for the lifetime of the process."""

    def __init__(self) -> None:
        self._resolved_names: dict[str, str] = {}
        self._lock = threading.Lock()

    def resolve(self, batch_id: str, requested_folder_name: str, download_directory: str) -> str:
        """Return the conflict-free folder name for `batch_id`, resolving it
        against `download_directory` the first time this batch is seen and
        reusing that same result for every later call with the same
        `batch_id` — even if `requested_folder_name` differs on a later
        call (it shouldn't, but the first resolution always wins)."""
        with self._lock:
            resolved = self._resolved_names.get(batch_id)
            if resolved is not None:
                return resolved
            resolved_path = resolve_available_path(download_directory, requested_folder_name)
            resolved = os.path.basename(resolved_path)
            self._resolved_names[batch_id] = resolved
            return resolved


_upload_batch_registry = UploadBatchRegistry()


def get_upload_batch_registry() -> UploadBatchRegistry:
    """Return the process-wide UploadBatchRegistry singleton."""
    return _upload_batch_registry
