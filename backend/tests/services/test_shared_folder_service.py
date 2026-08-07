"""Tests for SharedFolderService (P13: Folder Transfer Support)."""

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from app.services.exceptions import NotFoundError, ValidationError
from app.services.shared_folder_service import SharedFolderService


def _make_tree(root: Path) -> None:
    """University Notes/ example from the P13 spec:
    Semester 1/DBMS.pdf, Semester 1/OS.pdf, Semester 2/Java/Notes.docx,
    Semester 2/DSA/Trees.pdf
    """
    (root / "Semester 1").mkdir(parents=True)
    (root / "Semester 1" / "DBMS.pdf").write_bytes(b"dbms notes")
    (root / "Semester 1" / "OS.pdf").write_bytes(b"os notes")
    (root / "Semester 2" / "Java").mkdir(parents=True)
    (root / "Semester 2" / "Java" / "Notes.docx").write_bytes(b"java notes")
    (root / "Semester 2" / "DSA").mkdir(parents=True)
    (root / "Semester 2" / "DSA" / "Trees.pdf").write_bytes(b"trees")


def test_share_folder_creates_folder_and_child_files(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "University Notes"
    _make_tree(root)
    service = SharedFolderService(db_session)

    shared_folder, was_created = service.share_folder(str(root))

    assert was_created is True
    assert shared_folder.folder_name == "University Notes"
    assert shared_folder.file_count == 4
    assert shared_folder.total_size == sum(
        len(b) for b in (b"dbms notes", b"os notes", b"java notes", b"trees")
    )
    children = service.list_folder_files(shared_folder.id)
    assert {c.relative_path for c in children} == {
        "Semester 1/DBMS.pdf",
        "Semester 1/OS.pdf",
        "Semester 2/Java/Notes.docx",
        "Semester 2/DSA/Trees.pdf",
    }


def test_share_folder_supports_empty_folder(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "Empty"
    root.mkdir()
    service = SharedFolderService(db_session)

    shared_folder, was_created = service.share_folder(str(root))

    assert was_created is True
    assert shared_folder.file_count == 0
    assert shared_folder.total_size == 0
    assert service.list_folder_files(shared_folder.id) == []


def test_share_folder_includes_hidden_files(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "Dotfiles"
    root.mkdir()
    (root / ".hidden").write_bytes(b"secret")
    (root / "visible.txt").write_bytes(b"visible")
    service = SharedFolderService(db_session)

    shared_folder, _ = service.share_folder(str(root))

    children = service.list_folder_files(shared_folder.id)
    assert {c.relative_path for c in children} == {".hidden", "visible.txt"}


def test_share_folder_includes_zero_byte_files(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "ZeroByte"
    root.mkdir()
    (root / "empty.txt").write_bytes(b"")
    service = SharedFolderService(db_session)

    shared_folder, _ = service.share_folder(str(root))

    children = service.list_folder_files(shared_folder.id)
    assert len(children) == 1
    assert children[0].file_size == 0


def test_share_folder_rejects_relative_path(db_session: Session) -> None:
    service = SharedFolderService(db_session)

    with pytest.raises(ValidationError):
        service.share_folder("relative/notes")


def test_share_folder_rejects_missing_folder(db_session: Session, tmp_path: Path) -> None:
    service = SharedFolderService(db_session)

    with pytest.raises(ValidationError):
        service.share_folder(str(tmp_path / "missing"))


def test_share_folder_rejects_a_regular_file(db_session: Session, tmp_path: Path) -> None:
    service = SharedFolderService(db_session)
    file_path = tmp_path / "report.pdf"
    file_path.write_bytes(b"content")

    with pytest.raises(ValidationError):
        service.share_folder(str(file_path))


def test_share_folder_re_sharing_same_path_refreshes_instead_of_duplicating(
    db_session: Session, tmp_path: Path
) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    service = SharedFolderService(db_session)
    first, first_created = service.share_folder(str(root))

    (root / "b.txt").write_bytes(b"b")
    second, second_created = service.share_folder(str(root))

    assert first_created is True
    assert second_created is False
    assert second.id == first.id
    assert second.file_count == 2
    assert len(service.list_shared_folders()) == 1


def test_refresh_folder_adds_new_files(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    service = SharedFolderService(db_session)
    shared_folder, _ = service.share_folder(str(root))

    (root / "b.txt").write_bytes(b"bb")
    refreshed = service.refresh_folder(shared_folder.id)

    assert refreshed.file_count == 2
    assert refreshed.total_size == 3
    paths = {c.relative_path for c in service.list_folder_files(shared_folder.id)}
    assert paths == {"a.txt", "b.txt"}


def test_refresh_folder_removes_deleted_files(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    (root / "b.txt").write_bytes(b"b")
    service = SharedFolderService(db_session)
    shared_folder, _ = service.share_folder(str(root))

    (root / "b.txt").unlink()
    refreshed = service.refresh_folder(shared_folder.id)

    assert refreshed.file_count == 1
    paths = {c.relative_path for c in service.list_folder_files(shared_folder.id)}
    assert paths == {"a.txt"}


def test_refresh_folder_updates_changed_file_size(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    service = SharedFolderService(db_session)
    shared_folder, _ = service.share_folder(str(root))

    (root / "a.txt").write_bytes(b"much longer now")
    service.refresh_folder(shared_folder.id)

    children = service.list_folder_files(shared_folder.id)
    assert children[0].file_size == len(b"much longer now")


def test_refresh_folder_raises_when_missing(db_session: Session) -> None:
    service = SharedFolderService(db_session)

    with pytest.raises(NotFoundError):
        service.refresh_folder(999)


def test_get_shared_folder_or_raise_raises_when_missing(db_session: Session) -> None:
    service = SharedFolderService(db_session)

    with pytest.raises(NotFoundError):
        service.get_shared_folder_or_raise(999)


def test_unshare_folder_deletes_it_and_its_children(db_session: Session, tmp_path: Path) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    service = SharedFolderService(db_session)
    shared_folder, _ = service.share_folder(str(root))
    shared_folder_id = shared_folder.id

    service.unshare_folder(shared_folder_id)

    with pytest.raises(NotFoundError):
        service.get_shared_folder_or_raise(shared_folder_id)


def test_unshare_folder_raises_when_missing(db_session: Session) -> None:
    service = SharedFolderService(db_session)

    with pytest.raises(NotFoundError):
        service.unshare_folder(999)


def test_list_folder_files_raises_when_folder_missing(db_session: Session) -> None:
    service = SharedFolderService(db_session)

    with pytest.raises(NotFoundError):
        service.list_folder_files(999)


def test_shared_folder_children_excluded_from_shared_file_list(
    db_session: Session, tmp_path: Path
) -> None:
    """GET /files must never leak a folder's child files individually
    (11_File_Transfer.md: "must not display every contained file
    individually")."""
    from app.services.shared_file_service import SharedFileService

    root = tmp_path / "Notes"
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    folder_service = SharedFolderService(db_session)
    folder_service.share_folder(str(root))

    standalone_path = tmp_path / "standalone.txt"
    standalone_path.write_bytes(b"standalone")
    file_service = SharedFileService(db_session)
    file_service.share_file(str(standalone_path))

    top_level = file_service.list_shared_files()

    assert [f.file_name for f in top_level] == ["standalone.txt"]
