"""TransferStreamService — moves bytes for an already-accepted transfer
(docs/11_File_Transfer.md §8, Milestone 12: Streaming Engine).

Deliberately separate from TransferService (Milestone 11): TransferService
owns the transfer *lifecycle* (propose/accept/reject/cancel) and is
unchanged by this milestone. This service only ever operates on a Transfer
that is already `IN_PROGRESS`, and its only job is moving bytes and
recording the outcome — it never creates, accepts, rejects, or lists
transfers.

Reuses SharedFileService for filesystem validation (SEND) and
AppSettingsService for the destination directory (RECEIVE) rather than
duplicating that logic.

Cancellation-while-streaming is observed cooperatively: the loop below
periodically re-reads the transfer's status from the database. Because the
project's SessionLocal uses the SQLAlchemy default `expire_on_commit=True`,
each of this service's own commits (done at the same cadence, to persist
progress) expires the in-session Transfer object, so the next read is a
genuine SELECT rather than a cached identity-map hit — which is what lets
this session observe a `cancel_transfer` call committed by a different
request. The very first check of a stream may briefly miss a cancellation
that raced with transfer acceptance; this is an accepted limitation for a
single-user local application, not a guarantee this design makes.

Upload filename conflicts are resolved automatically with the conventional
"name (1).ext" pattern (`app/utils/filesystem.resolve_available_path`). When
a rename happens, `_finalize` writes the actual saved name back onto
`Transfer.file_name` so the final name is discoverable later via the
existing `GET /transfers/{id}` — deliberately, this is a narrow, scoped
exception to `13_Database_Design.md` §7's documented "Immutable: Yes" for
that column, limited to this one case (RECEIVE, completed, renamed). No
schema change is involved — it is a plain write to an existing column. A
corresponding update to that document's immutability note is recommended
but was not made automatically, per CLAUDE.md's documentation-ownership rule.
"""

import logging
import mimetypes
import os
import tempfile
from collections.abc import AsyncIterator, Iterator

from sqlalchemy.orm import Session
from starlette.requests import ClientDisconnect

from app.core.config import get_settings
from app.models.enums import TransferStatus
from app.models.transfer import Transfer
from app.repositories.transfer_repository import TransferRepository
from app.services.active_stream_registry import ActiveStreamRegistry
from app.services.app_settings_service import AppSettingsService
from app.services.exceptions import ValidationError
from app.services.shared_file_service import SharedFileService
from app.utils.filesystem import (
    is_regular_file,
    is_symlink,
    path_exists,
    resolve_available_path,
)
from app.utils.time import utc_now

logger = logging.getLogger(__name__)

# Progress (and cancellation) is checked at most this often during a stream,
# rather than on every chunk, to bound how many commits a large transfer
# produces. bytes_transferred is informational only, so this granularity is
# an accepted trade-off, not a correctness concern.
_PROGRESS_UPDATE_INTERVAL_BYTES = 8 * 1_048_576  # 8 MiB

# Prefix used for an in-progress upload's temp file (receive_upload below).
# Also matched by cleanup_orphaned_upload_temp_files at startup: any file
# under this prefix still present in the download directory can only be one
# an unclean shutdown interrupted before its finally-block ran, since a
# completed or cleanly-failed upload always renames or removes it.
_UPLOAD_TEMP_FILE_PREFIX = ".relay-upload-"


class TransferStreamService:
    """Business logic for streaming the bytes of an already-accepted transfer."""

    def __init__(self, db: Session, active_stream_registry: ActiveStreamRegistry) -> None:
        self.db = db
        self.active_stream_registry = active_stream_registry
        self.transfer_repository = TransferRepository(db)
        self.shared_file_service = SharedFileService(db)
        self.app_settings_service = AppSettingsService(db)

    # --- Download (SEND: desktop -> Android) ----------------------------------

    def resolve_download_source(self, transfer: Transfer) -> str:
        """Resolve and re-validate the on-disk path for a SEND transfer's file,
        immediately before streaming begins.

        Raises NotFoundError (via SharedFileService) if the shared file no
        longer exists in the database, ValidationError if the underlying
        file has disappeared, changed type, or changed size since the
        transfer was accepted.
        """
        if transfer.shared_file_id is None:
            raise ValidationError("The shared file is no longer available.")
        shared_file = self.shared_file_service.get_shared_file_or_raise(transfer.shared_file_id)

        path = shared_file.file_path
        if not path_exists(path) or is_symlink(path) or not is_regular_file(path):
            raise ValidationError("The source file is no longer available.")
        if os.path.getsize(path) != transfer.file_size:
            raise ValidationError("The source file has changed since the transfer was accepted.")
        return path

    @staticmethod
    def guess_media_type(file_name: str) -> str:
        """Best-effort content type for a download response, guessed from the
        file name. Falls back to a generic binary type when unknown."""
        media_type, _ = mimetypes.guess_type(file_name)
        return media_type or "application/octet-stream"

    def stream_download(self, transfer: Transfer, file_path: str) -> Iterator[bytes]:
        """Acquire the active-stream guard, then return a generator that
        yields the file's bytes in fixed-size chunks, updating progress and
        the transfer's terminal status as it goes.

        The guard is acquired here, eagerly, rather than inside the
        generator body: the route passes our return value straight into
        StreamingResponse, which sends its 200 status and headers before
        ever pulling the first chunk from the iterator. Raising
        ConflictError from inside the generator would therefore happen
        *after* the client already received a 200 — too late for the
        centralized exception handlers to turn it into a clean 409. Raising
        it here, in a plain method call the route makes before constructing
        the response, lets it propagate the normal way.
        """
        transfer_id = transfer.id
        self.active_stream_registry.acquire(transfer_id)
        return self._generate_download(transfer_id, file_path)

    def _generate_download(self, transfer_id: int, file_path: str) -> Iterator[bytes]:
        """The actual chunked read loop. Assumes the caller already acquired
        the active-stream guard; always releases it exactly once, on exit."""
        chunk_size = get_settings().STREAM_CHUNK_SIZE_BYTES
        bytes_sent = 0
        bytes_since_update = 0
        try:
            if not self._touch_progress(transfer_id, bytes_sent):
                return
            with open(file_path, "rb") as file:
                while True:
                    chunk = file.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
                    bytes_sent += len(chunk)
                    bytes_since_update += len(chunk)
                    if bytes_since_update >= _PROGRESS_UPDATE_INTERVAL_BYTES:
                        bytes_since_update = 0
                        if not self._touch_progress(transfer_id, bytes_sent):
                            logger.info(
                                "Download stopped mid-stream (no longer in progress): transfer_id=%s",
                                transfer_id,
                            )
                            return
            self._finalize(transfer_id, TransferStatus.COMPLETED, bytes_sent)
            logger.info("Download completed: transfer_id=%s bytes=%s", transfer_id, bytes_sent)
        except GeneratorExit:
            logger.warning(
                "Download connection closed early: transfer_id=%s bytes_sent=%s", transfer_id, bytes_sent
            )
            self._finalize(
                transfer_id, TransferStatus.FAILED, bytes_sent, failure_reason="Connection lost during transfer."
            )
            raise
        except OSError as exc:
            logger.error("Download failed: transfer_id=%s error=%s", transfer_id, exc)
            self._finalize(
                transfer_id, TransferStatus.FAILED, bytes_sent, failure_reason="Unable to read the source file."
            )
        finally:
            self.active_stream_registry.release(transfer_id)

    # --- Upload (RECEIVE: Android -> desktop) ---------------------------------

    async def receive_upload(self, transfer: Transfer, body: AsyncIterator[bytes]) -> Transfer:
        """Consume the request body, writing it to a temp file in the download
        directory, then atomically renaming it into place. On a filename
        conflict, the conventional "name (1).ext" pattern is used and the
        transfer's `file_name` is updated to the actual saved name (see
        module docstring and `_finalize`).

        A short, oversized, or interrupted stream is recorded as a failed
        transfer rather than raised past this method, since by the time
        that's known the caller may already have committed to a response.

        `STREAM_CHUNK_SIZE_BYTES` does not apply here: unlike the download
        loop, which controls its own read size, this loop's chunk boundaries
        are dictated by the ASGI server delivering the request body — each
        chunk is written to disk as received rather than re-buffered to a
        fixed size, since doing so would add complexity without reducing
        the number of writes in practice.
        """
        transfer_id = transfer.id
        settings = self.app_settings_service.get_settings()
        download_directory = settings.download_directory

        self.active_stream_registry.acquire(transfer_id)
        bytes_received = 0
        bytes_since_update = 0
        temp_path: str | None = None
        try:
            os.makedirs(download_directory, exist_ok=True)
            if not self._touch_progress(transfer_id, bytes_received):
                return self._current(transfer_id)

            fd, temp_path = tempfile.mkstemp(dir=download_directory, prefix=_UPLOAD_TEMP_FILE_PREFIX)
            with os.fdopen(fd, "wb") as temp_file:
                async for chunk in body:
                    if not chunk:
                        continue
                    bytes_received += len(chunk)
                    if bytes_received > transfer.file_size:
                        raise ValidationError("Uploaded data exceeds the declared file size.")
                    temp_file.write(chunk)
                    bytes_since_update += len(chunk)
                    if bytes_since_update >= _PROGRESS_UPDATE_INTERVAL_BYTES:
                        bytes_since_update = 0
                        if not self._touch_progress(transfer_id, bytes_received):
                            return self._current(transfer_id)

            if bytes_received != transfer.file_size:
                raise ValidationError("Upload ended before the declared file size was reached.")

            final_path = resolve_available_path(download_directory, transfer.file_name)
            os.replace(temp_path, final_path)
            saved_name = os.path.basename(final_path)
            temp_path = None
            logger.info(
                "Upload completed: transfer_id=%s bytes=%s saved_as=%s",
                transfer_id,
                bytes_received,
                saved_name,
            )
            return self._finalize(transfer_id, TransferStatus.COMPLETED, bytes_received, file_name=saved_name)
        except ValidationError as exc:
            logger.warning("Upload rejected: transfer_id=%s reason=%s", transfer_id, exc)
            return self._finalize(transfer_id, TransferStatus.FAILED, bytes_received, failure_reason=str(exc))
        except ClientDisconnect:
            logger.warning(
                "Upload connection lost: transfer_id=%s bytes_received=%s", transfer_id, bytes_received
            )
            return self._finalize(
                transfer_id,
                TransferStatus.FAILED,
                bytes_received,
                failure_reason="Connection lost during transfer.",
            )
        except OSError as exc:
            logger.error("Upload failed: transfer_id=%s error=%s", transfer_id, exc)
            return self._finalize(
                transfer_id,
                TransferStatus.FAILED,
                bytes_received,
                failure_reason="Unable to save the uploaded file.",
            )
        finally:
            self._discard_temp_file(temp_path)
            self.active_stream_registry.release(transfer_id)

    def cleanup_orphaned_upload_temp_files(self) -> int:
        """Remove any leftover upload temp file from an unclean shutdown.

        Intended to be called once at backend startup, alongside
        TransferService.reconcile_interrupted_transfers (same docs/09_Networking.md
        §9 "backend restarts" requirement). A hard crash or kill -9 skips
        receive_upload's `finally` block entirely, so `_discard_temp_file`
        never runs for whatever chunk was mid-write — unlike every clean
        failure path (oversized/undersized upload, disconnect, OSError),
        which already deletes its own temp file. Any `_UPLOAD_TEMP_FILE_PREFIX`
        file still present at startup is, by construction, orphaned: a
        completed upload always renames it away via os.replace. Best-effort
        and never raises, matching `_discard_temp_file`'s own policy — a
        missing or unreadable download directory is not an error here.
        """
        download_directory = self.app_settings_service.get_settings().download_directory
        removed = 0
        try:
            entries = os.listdir(download_directory)
        except OSError:
            return 0
        for entry in entries:
            if not entry.startswith(_UPLOAD_TEMP_FILE_PREFIX):
                continue
            try:
                os.remove(os.path.join(download_directory, entry))
                removed += 1
            except OSError as exc:
                logger.warning("Unable to remove orphaned upload temp file: name=%s error=%s", entry, exc)
        if removed:
            logger.warning("Removed %s orphaned upload temp file(s) left by an unclean shutdown.", removed)
        return removed

    # --- Shared helpers ---------------------------------------------------------

    def _current(self, transfer_id: int) -> Transfer:
        """Fetch a transfer that is known to still exist. Transfers are never
        deleted (TransferRepository has no delete method), so a miss here
        indicates an invariant violation, not a normal not-found case."""
        transfer = self.transfer_repository.get_by_id(transfer_id)
        if transfer is None:
            raise RuntimeError(f"Transfer {transfer_id} disappeared during streaming.")
        return transfer

    def _touch_progress(self, transfer_id: int, bytes_transferred: int) -> bool:
        """Persist progress and report whether the transfer is still in progress.

        Called periodically (not per-chunk) during a stream. This is also
        the point an external cancellation becomes visible — see the module
        docstring for why the commit below is what makes that work.
        """
        transfer = self._current(transfer_id)
        if transfer.status is not TransferStatus.IN_PROGRESS:
            return False
        transfer.bytes_transferred = bytes_transferred
        self.transfer_repository.update(transfer)
        self.db.commit()
        return True

    def _finalize(
        self,
        transfer_id: int,
        status: TransferStatus,
        bytes_transferred: int,
        *,
        failure_reason: str | None = None,
        file_name: str | None = None,
    ) -> Transfer:
        """Move a transfer to a terminal state, unless it has already reached
        one (e.g. an explicit cancel that raced with completion) — in which
        case the existing terminal state is left untouched."""
        transfer = self._current(transfer_id)
        if transfer.status is TransferStatus.IN_PROGRESS:
            transfer.status = status
            transfer.bytes_transferred = bytes_transferred
            transfer.completed_at = utc_now()
            if failure_reason is not None:
                transfer.failure_reason = failure_reason
            if file_name is not None:
                transfer.file_name = file_name
            self.transfer_repository.update(transfer)
            self.db.commit()
        return transfer

    def _discard_temp_file(self, temp_path: str | None) -> None:
        """Best-effort removal of a leftover temp file. Never raises — cleanup
        failures are logged, not propagated, so they don't mask the real error."""
        if temp_path is None:
            return
        try:
            os.remove(temp_path)
        except OSError as exc:
            logger.warning("Unable to remove temporary upload file: path=%s error=%s", temp_path, exc)
