"""Tests for SharedFileService."""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.services.exceptions import NotFoundError, ValidationError
from app.services.shared_file_service import SharedFileService


def _make_file(tmp_path: Path, name: str = "report.pdf", content: bytes = b"content") -> str:
    file_path = tmp_path / name
    file_path.write_bytes(content)
    return str(file_path)


def test_share_file_creates_shared_file(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)
    path = _make_file(tmp_path)

    shared_file, was_created = service.share_file(path)

    assert was_created is True
    assert shared_file.file_path == path
    assert shared_file.file_name == "report.pdf"
    assert shared_file.file_size == len(b"content")
    assert shared_file.mime_type == "application/pdf"


def test_share_file_rejects_relative_path(db_session: Session) -> None:
    service = SharedFileService(db_session)

    with pytest.raises(ValidationError):
        service.share_file("relative/report.pdf")


def test_share_file_rejects_missing_file(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)

    with pytest.raises(ValidationError):
        service.share_file(str(tmp_path / "missing.pdf"))


def test_share_file_rejects_directory(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)

    with pytest.raises(ValidationError):
        service.share_file(str(tmp_path))


def test_share_file_rejects_symlink(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)
    target = tmp_path / "report.pdf"
    target.write_bytes(b"content")
    link = tmp_path / "link.pdf"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("Creating symlinks requires elevated privileges on this system.")

    with pytest.raises(ValidationError):
        service.share_file(str(link))


def test_share_file_re_sharing_same_path_refreshes_instead_of_duplicating(
    db_session: Session, tmp_path: Path
) -> None:
    service = SharedFileService(db_session)
    path = _make_file(tmp_path)
    first, first_created = service.share_file(path)

    Path(path).write_bytes(b"much longer content now")
    second, second_created = service.share_file(path)

    assert first_created is True
    assert second_created is False
    assert second.id == first.id
    assert second.file_size == len(b"much longer content now")
    assert len(service.list_shared_files()) == 1


def test_list_shared_files_returns_newest_first(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)
    service.share_file(_make_file(tmp_path, "first.pdf"))
    service.share_file(_make_file(tmp_path, "second.pdf"))

    files = service.list_shared_files()

    assert [f.file_name for f in files] == ["second.pdf", "first.pdf"]


def test_get_shared_file_or_raise_returns_matching_file(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)
    shared_file, _ = service.share_file(_make_file(tmp_path))

    found = service.get_shared_file_or_raise(shared_file.id)

    assert found.id == shared_file.id


def test_get_shared_file_or_raise_raises_when_missing(db_session: Session) -> None:
    service = SharedFileService(db_session)

    with pytest.raises(NotFoundError):
        service.get_shared_file_or_raise(999)


def test_refresh_metadata_updates_size_and_mime_type(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)
    path = _make_file(tmp_path)
    shared_file, _ = service.share_file(path)

    Path(path).write_bytes(b"much longer content now")
    refreshed = service.refresh_metadata(shared_file.id)

    assert refreshed.file_size == len(b"much longer content now")


def test_refresh_metadata_does_not_change_shared_at(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)
    path = _make_file(tmp_path)
    shared_file, _ = service.share_file(path)
    original_shared_at = shared_file.shared_at

    refreshed = service.refresh_metadata(shared_file.id)

    assert refreshed.shared_at == original_shared_at


def test_refresh_metadata_raises_and_leaves_row_when_file_missing(
    db_session: Session, tmp_path: Path
) -> None:
    service = SharedFileService(db_session)
    path = _make_file(tmp_path)
    shared_file, _ = service.share_file(path)
    original_size = shared_file.file_size
    Path(path).unlink()

    with pytest.raises(ValidationError):
        service.refresh_metadata(shared_file.id)

    untouched = service.get_shared_file_or_raise(shared_file.id)
    assert untouched.file_size == original_size


def test_refresh_metadata_raises_when_shared_file_id_missing(db_session: Session) -> None:
    service = SharedFileService(db_session)

    with pytest.raises(NotFoundError):
        service.refresh_metadata(999)


def test_unshare_file_deletes_it(db_session: Session, tmp_path: Path) -> None:
    service = SharedFileService(db_session)
    shared_file, _ = service.share_file(_make_file(tmp_path))
    shared_file_id = shared_file.id

    service.unshare_file(shared_file_id)

    with pytest.raises(NotFoundError):
        service.get_shared_file_or_raise(shared_file_id)


def test_unshare_file_raises_when_missing(db_session: Session) -> None:
    service = SharedFileService(db_session)

    with pytest.raises(NotFoundError):
        service.unshare_file(999)
