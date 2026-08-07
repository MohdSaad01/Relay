"""Tests for TransferStreamService (Milestone 12: Streaming Engine)."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.enums import TransferDirection, TransferStatus
from app.models.transfer import Transfer
from app.repositories.device_repository import DeviceRepository
from app.services import transfer_stream_service
from app.services.active_stream_registry import ActiveStreamRegistry
from app.services.app_settings_service import AppSettingsService
from app.services.exceptions import ConflictError, ValidationError
from app.services.shared_file_service import SharedFileService
from app.services.transfer_manager import TransferManager
from app.services.transfer_service import TransferService
from app.services.transfer_stream_service import TransferStreamService
from app.services.upload_batch_registry import UploadBatchRegistry
from tests.repositories.conftest import make_device


def _register_device(db_session: Session, identifier: str = "device-uuid-1") -> Device:
    return DeviceRepository(db_session).create(make_device(identifier=identifier))


def _set_download_directory(db_session: Session, directory: Path) -> None:
    AppSettingsService(db_session).update_settings(download_directory=str(directory))


def _make_file(tmp_path: Path, name: str = "report.pdf", content: bytes = b"file-content") -> str:
    file_path = tmp_path / name
    file_path.write_bytes(content)
    return str(file_path)


def _accept_download(db_session: Session, device: Device, file_path: str) -> Transfer:
    """Named `_accept_download` for parity with `_accept_upload` below, even
    though a download is now auto-accepted by request_transfer itself."""
    shared_file, _ = SharedFileService(db_session).share_file(file_path)
    transfer_service = TransferService(db_session, TransferManager(), UploadBatchRegistry())
    request = transfer_service.request_transfer(device, TransferDirection.SEND, shared_file.id, None, None)
    return transfer_service.get_transfer_or_raise(request.transfer_id, None)


def _accept_upload(
    db_session: Session, device: Device, file_name: str = "photo.jpg", file_size: int = 12
) -> Transfer:
    """Named `_accept_upload` for parity with `_accept_download` above, even
    though an upload is now auto-accepted by request_transfer itself."""
    transfer_service = TransferService(db_session, TransferManager(), UploadBatchRegistry())
    request = transfer_service.request_transfer(
        device, TransferDirection.RECEIVE, None, file_name, file_size
    )
    return transfer_service.get_transfer_or_raise(request.transfer_id, None)


def _stream_service(db_session: Session) -> TransferStreamService:
    return TransferStreamService(db_session, ActiveStreamRegistry())


async def _body(chunks: list[bytes]) -> AsyncIterator[bytes]:
    for chunk in chunks:
        yield chunk


def _run_upload(service: TransferStreamService, transfer: Transfer, chunks: list[bytes]) -> Transfer:
    return asyncio.run(service.receive_upload(transfer, _body(chunks)))


# --- resolve_download_source ----------------------------------------------------


def test_resolve_download_source_returns_path(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    transfer = _accept_download(db_session, device, _make_file(tmp_path))
    service = _stream_service(db_session)

    path = service.resolve_download_source(transfer)

    assert path == str(tmp_path / "report.pdf")


def test_resolve_download_source_raises_when_shared_file_unshared(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    shared_file_service = SharedFileService(db_session)
    file_path = _make_file(tmp_path)
    transfer = _accept_download(db_session, device, file_path)
    shared_file_service.unshare_file(transfer.shared_file_id)
    # ON DELETE SET NULL is a DB-level cascade; the transfer's shared_file_id
    # only reflects it in-memory once this session's commit (above) expires
    # and refreshes the object, which is what actually happens here.

    with pytest.raises(ValidationError):
        _stream_service(db_session).resolve_download_source(transfer)


def test_resolve_download_source_raises_when_file_missing(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    file_path = _make_file(tmp_path)
    transfer = _accept_download(db_session, device, file_path)
    Path(file_path).unlink()

    with pytest.raises(ValidationError):
        _stream_service(db_session).resolve_download_source(transfer)


def test_resolve_download_source_raises_when_size_changed(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    file_path = _make_file(tmp_path)
    transfer = _accept_download(db_session, device, file_path)
    Path(file_path).write_bytes(b"a much longer replacement file body")

    with pytest.raises(ValidationError):
        _stream_service(db_session).resolve_download_source(transfer)


# --- stream_download --------------------------------------------------------------


def test_stream_download_yields_full_content_and_marks_completed(
    db_session: Session, tmp_path: Path
) -> None:
    device = _register_device(db_session)
    content = b"file-content"
    transfer = _accept_download(db_session, device, _make_file(tmp_path, content=content))
    service = _stream_service(db_session)
    path = service.resolve_download_source(transfer)

    streamed = b"".join(service.stream_download(transfer, path))

    assert streamed == content
    updated = service.transfer_repository.get_by_id(transfer.id)
    assert updated.status is TransferStatus.COMPLETED
    assert updated.bytes_transferred == len(content)
    assert updated.completed_at is not None


def test_stream_download_yields_nothing_when_already_cancelled(
    db_session: Session, tmp_path: Path
) -> None:
    device = _register_device(db_session)
    transfer = _accept_download(db_session, device, _make_file(tmp_path))
    service = _stream_service(db_session)
    path = service.resolve_download_source(transfer)
    transfer.status = TransferStatus.CANCELLED
    db_session.commit()

    streamed = b"".join(service.stream_download(transfer, path))

    assert streamed == b""
    updated = service.transfer_repository.get_by_id(transfer.id)
    assert updated.status is TransferStatus.CANCELLED  # not overwritten


def test_stream_download_client_disconnect_marks_failed(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    transfer = _accept_download(db_session, device, _make_file(tmp_path, content=b"a" * 100))
    service = _stream_service(db_session)
    path = service.resolve_download_source(transfer)

    generator = service.stream_download(transfer, path)
    next(generator)  # start the stream, consume one chunk
    generator.close()  # simulate the client disconnecting mid-stream

    updated = service.transfer_repository.get_by_id(transfer.id)
    assert updated.status is TransferStatus.FAILED
    assert updated.failure_reason == "Connection lost during transfer."


def test_stream_download_missing_source_file_marks_failed(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    file_path = _make_file(tmp_path)
    transfer = _accept_download(db_session, device, file_path)
    service = _stream_service(db_session)
    resolved_path = service.resolve_download_source(transfer)
    Path(file_path).unlink()  # disappears after validation, before the stream opens it

    streamed = b"".join(service.stream_download(transfer, resolved_path))

    assert streamed == b""
    updated = service.transfer_repository.get_by_id(transfer.id)
    assert updated.status is TransferStatus.FAILED
    assert updated.failure_reason == "Unable to read the source file."


def test_stream_download_rejects_second_concurrent_stream(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    transfer = _accept_download(db_session, device, _make_file(tmp_path, content=b"a" * 100))
    registry = ActiveStreamRegistry()
    service = TransferStreamService(db_session, registry)
    path = service.resolve_download_source(transfer)

    first = service.stream_download(transfer, path)  # acquires the registry slot immediately

    # The conflict must surface from the call itself, not from the first
    # next() on the returned generator: the route hands this return value
    # straight to StreamingResponse, which sends its 200 status/headers
    # before ever pulling a chunk from the iterator. A conflict raised only
    # on first iteration would arrive too late to become a clean 409.
    with pytest.raises(ConflictError):
        service.stream_download(transfer, path)

    first.close()


# --- receive_upload ---------------------------------------------------------------


def test_receive_upload_writes_file_and_marks_completed(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    transfer = _accept_upload(db_session, device, file_name="photo.jpg", file_size=12)
    service = _stream_service(db_session)

    updated = _run_upload(service, transfer, [b"file-", b"content"])

    assert updated.status is TransferStatus.COMPLETED
    assert updated.bytes_transferred == 12
    assert updated.file_name == "photo.jpg"
    assert (tmp_path / "photo.jpg").read_bytes() == b"file-content"


def test_receive_upload_renames_on_conflict_and_updates_file_name(
    db_session: Session, tmp_path: Path
) -> None:
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    (tmp_path / "photo.jpg").write_bytes(b"existing file")
    transfer = _accept_upload(db_session, device, file_name="photo.jpg", file_size=12)
    service = _stream_service(db_session)

    updated = _run_upload(service, transfer, [b"file-content"])

    assert updated.status is TransferStatus.COMPLETED
    assert updated.file_name == "photo (1).jpg"
    assert (tmp_path / "photo (1).jpg").read_bytes() == b"file-content"
    assert (tmp_path / "photo.jpg").read_bytes() == b"existing file"  # untouched


def test_receive_upload_folder_child_writes_to_nested_path(db_session: Session, tmp_path: Path) -> None:
    """P13: a folder-upload child's folder_relative_path drives nested
    directory creation, not the flat download_directory root."""
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    transfer_service = TransferService(db_session, TransferManager(), UploadBatchRegistry())
    request = transfer_service.request_transfer(
        device,
        TransferDirection.RECEIVE,
        None,
        None,
        len(b"notes-content"),
        "Semester 1/DBMS.pdf",
        "batch-1",
        "University Notes",
    )
    transfer = transfer_service.get_transfer_or_raise(request.transfer_id, None)
    service = _stream_service(db_session)

    updated = _run_upload(service, transfer, [b"notes-content"])

    assert updated.status is TransferStatus.COMPLETED
    saved = tmp_path / "University Notes" / "Semester 1" / "DBMS.pdf"
    assert saved.read_bytes() == b"notes-content"


def test_receive_upload_too_many_bytes_marks_failed_and_discards_temp_file(
    db_session: Session, tmp_path: Path
) -> None:
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    transfer = _accept_upload(db_session, device, file_name="photo.jpg", file_size=4)
    service = _stream_service(db_session)

    updated = _run_upload(service, transfer, [b"way more than declared"])

    assert updated.status is TransferStatus.FAILED
    assert not (tmp_path / "photo.jpg").exists()
    assert list(tmp_path.iterdir()) == []  # no leftover temp file


def test_receive_upload_too_few_bytes_marks_failed(db_session: Session, tmp_path: Path) -> None:
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    transfer = _accept_upload(db_session, device, file_name="photo.jpg", file_size=100)
    service = _stream_service(db_session)

    updated = _run_upload(service, transfer, [b"short"])

    assert updated.status is TransferStatus.FAILED
    assert not (tmp_path / "photo.jpg").exists()


def test_receive_upload_already_cancelled_does_not_write_file(
    db_session: Session, tmp_path: Path
) -> None:
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    transfer = _accept_upload(db_session, device, file_name="photo.jpg", file_size=12)
    transfer.status = TransferStatus.CANCELLED
    db_session.commit()
    service = _stream_service(db_session)

    updated = _run_upload(service, transfer, [b"file-content"])

    assert updated.status is TransferStatus.CANCELLED  # not overwritten
    assert list(tmp_path.iterdir()) == []


# --- Periodic progress/cancellation checkpoint (default thresholds are in the
# megabytes, so these tests lower them to actually exercise that code path) --


def test_stream_download_checkpoints_progress_across_multiple_chunks(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transfer_stream_service, "_PROGRESS_UPDATE_INTERVAL_BYTES", 10)
    monkeypatch.setattr(
        transfer_stream_service, "get_settings", lambda: type("Settings", (), {"STREAM_CHUNK_SIZE_BYTES": 5})()
    )
    device = _register_device(db_session)
    content = b"x" * 37  # not a multiple of the chunk size, so the tail chunk is exercised too
    transfer = _accept_download(db_session, device, _make_file(tmp_path, content=content))
    service = _stream_service(db_session)
    path = service.resolve_download_source(transfer)

    streamed = b"".join(service.stream_download(transfer, path))

    assert streamed == content
    updated = service.transfer_repository.get_by_id(transfer.id)
    assert updated.status is TransferStatus.COMPLETED
    assert updated.bytes_transferred == len(content)


def test_stream_download_stops_when_cancelled_at_a_checkpoint(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transfer_stream_service, "_PROGRESS_UPDATE_INTERVAL_BYTES", 5)
    monkeypatch.setattr(
        transfer_stream_service, "get_settings", lambda: type("Settings", (), {"STREAM_CHUNK_SIZE_BYTES": 5})()
    )
    device = _register_device(db_session)
    content = b"x" * 30
    transfer = _accept_download(db_session, device, _make_file(tmp_path, content=content))
    service = _stream_service(db_session)
    path = service.resolve_download_source(transfer)

    generator = service.stream_download(transfer, path)
    first_chunk = next(generator)  # 5 bytes; the checkpoint after it hasn't run yet
    assert first_chunk == content[:5]

    transfer.status = TransferStatus.CANCELLED
    db_session.commit()
    remaining = list(generator)  # resumes, hits the checkpoint, observes CANCELLED, stops

    assert remaining == []
    updated = service.transfer_repository.get_by_id(transfer.id)
    assert updated.status is TransferStatus.CANCELLED  # not overwritten
    assert updated.bytes_transferred == 0  # the checkpoint bailed before persisting it


def test_receive_upload_checkpoints_progress_across_multiple_chunks(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transfer_stream_service, "_PROGRESS_UPDATE_INTERVAL_BYTES", 5)
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    transfer = _accept_upload(db_session, device, file_name="photo.jpg", file_size=20)
    service = _stream_service(db_session)

    chunks = [bytes([ord("a") + i]) * 4 for i in range(5)]  # 5 chunks of 4 bytes = 20 bytes
    updated = _run_upload(service, transfer, chunks)

    assert updated.status is TransferStatus.COMPLETED
    assert updated.bytes_transferred == 20
    assert (tmp_path / "photo.jpg").read_bytes() == b"".join(chunks)


def test_receive_upload_stops_when_cancelled_at_a_checkpoint(
    db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(transfer_stream_service, "_PROGRESS_UPDATE_INTERVAL_BYTES", 5)
    device = _register_device(db_session)
    _set_download_directory(db_session, tmp_path)
    transfer = _accept_upload(db_session, device, file_name="photo.jpg", file_size=20)
    service = _stream_service(db_session)

    async def _body_with_cancel() -> AsyncIterator[bytes]:
        yield b"aaaa"  # 4 bytes: below the interval, no checkpoint yet
        transfer.status = TransferStatus.CANCELLED
        db_session.commit()
        yield b"bbbb"  # 8 bytes total: crosses the interval, checkpoint observes CANCELLED
        yield b"cccc"  # must never be reached

    updated = asyncio.run(service.receive_upload(transfer, _body_with_cancel()))

    assert updated.status is TransferStatus.CANCELLED  # not overwritten
    assert list(tmp_path.iterdir()) == []  # temp file discarded, nothing saved as photo.jpg


# --- cleanup_orphaned_upload_temp_files (T7: process-recovery / temp-file leak) ---


def test_cleanup_orphaned_upload_temp_files_removes_leftover_temp_file(
    db_session: Session, tmp_path: Path
) -> None:
    """Reproduces the T7 finding: a hard crash mid-upload skips receive_upload's
    `finally` block entirely, so `_discard_temp_file` never runs -- unlike
    every clean failure path (already covered by the tests above), which
    does clean up. The temp file is left behind forever unless something
    sweeps it at the next startup."""
    _set_download_directory(db_session, tmp_path)
    orphan = tmp_path / f"{transfer_stream_service._UPLOAD_TEMP_FILE_PREFIX}abc123"
    orphan.write_bytes(b"partial upload data")
    (tmp_path / "unrelated.txt").write_bytes(b"keep me")
    service = _stream_service(db_session)

    removed = service.cleanup_orphaned_upload_temp_files()

    assert removed == 1
    remaining = {p.name for p in tmp_path.iterdir()}
    assert remaining == {"unrelated.txt"}


def test_cleanup_orphaned_upload_temp_files_returns_zero_when_none_present(
    db_session: Session, tmp_path: Path
) -> None:
    _set_download_directory(db_session, tmp_path)
    service = _stream_service(db_session)

    assert service.cleanup_orphaned_upload_temp_files() == 0


def test_cleanup_orphaned_upload_temp_files_tolerates_missing_directory(db_session: Session, tmp_path: Path) -> None:
    _set_download_directory(db_session, tmp_path / "does-not-exist-yet")
    service = _stream_service(db_session)

    assert service.cleanup_orphaned_upload_temp_files() == 0
