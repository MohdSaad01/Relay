"""Tests for SharedFileRepository."""

from datetime import timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.repositories.shared_file_repository import SharedFileRepository
from app.utils.time import utc_now
from tests.repositories.conftest import make_shared_file


def test_create_assigns_id(db_session: Session) -> None:
    repo = SharedFileRepository(db_session)

    shared_file = repo.create(make_shared_file())

    assert shared_file.id is not None


def test_get_by_path_returns_matching_file(db_session: Session) -> None:
    repo = SharedFileRepository(db_session)
    repo.create(make_shared_file(file_path="/tmp/find-me.pdf"))

    found = repo.get_by_path("/tmp/find-me.pdf")

    assert found is not None
    assert found.file_path == "/tmp/find-me.pdf"


def test_duplicate_path_raises_integrity_error(db_session: Session) -> None:
    repo = SharedFileRepository(db_session)
    repo.create(make_shared_file(file_path="/tmp/duplicate.pdf"))

    with pytest.raises(IntegrityError):
        repo.create(
            make_shared_file(file_name="other.pdf", file_path="/tmp/duplicate.pdf")
        )


def test_list_all_orders_newest_first(db_session: Session) -> None:
    repo = SharedFileRepository(db_session)
    now = utc_now()
    first = make_shared_file(file_path="/tmp/first.pdf")
    first.shared_at = now
    second = make_shared_file(file_path="/tmp/second.pdf")
    second.shared_at = now + timedelta(seconds=1)
    repo.create(first)
    repo.create(second)

    files = repo.list_all()

    assert [f.file_path for f in files] == ["/tmp/second.pdf", "/tmp/first.pdf"]


def test_list_all_respects_limit_and_offset(db_session: Session) -> None:
    repo = SharedFileRepository(db_session)
    for i in range(5):
        repo.create(
            make_shared_file(file_name=f"file-{i}.pdf", file_path=f"/tmp/file-{i}.pdf")
        )

    page = repo.list_all(limit=2, offset=1)

    assert len(page) == 2


def test_update_persists_mutated_field(db_session: Session) -> None:
    repo = SharedFileRepository(db_session)
    shared_file = repo.create(make_shared_file())

    shared_file.file_size = 9999
    repo.update(shared_file)

    refetched = repo.get_by_id(shared_file.id)
    assert refetched is not None
    assert refetched.file_size == 9999


def test_delete_removes_shared_file(db_session: Session) -> None:
    repo = SharedFileRepository(db_session)
    shared_file = repo.create(make_shared_file())
    shared_file_id = shared_file.id

    repo.delete(shared_file)

    assert repo.get_by_id(shared_file_id) is None
