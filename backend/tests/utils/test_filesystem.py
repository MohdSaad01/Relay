"""Tests for app/utils/filesystem.py."""

from pathlib import Path

import pytest

from app.utils.filesystem import (
    is_absolute_path,
    is_regular_file,
    is_symlink,
    path_exists,
    read_file_metadata,
)


def test_is_absolute_path_true_for_absolute(tmp_path: Path) -> None:
    assert is_absolute_path(str(tmp_path / "report.pdf")) is True


def test_is_absolute_path_false_for_relative() -> None:
    assert is_absolute_path("relative/report.pdf") is False


def test_path_exists_true_for_existing_file(tmp_path: Path) -> None:
    file_path = tmp_path / "report.pdf"
    file_path.write_bytes(b"content")

    assert path_exists(str(file_path)) is True


def test_path_exists_false_for_missing_file(tmp_path: Path) -> None:
    assert path_exists(str(tmp_path / "missing.pdf")) is False


def test_is_regular_file_true_for_file(tmp_path: Path) -> None:
    file_path = tmp_path / "report.pdf"
    file_path.write_bytes(b"content")

    assert is_regular_file(str(file_path)) is True


def test_is_regular_file_false_for_directory(tmp_path: Path) -> None:
    assert is_regular_file(str(tmp_path)) is False


def test_is_symlink_false_for_regular_file(tmp_path: Path) -> None:
    file_path = tmp_path / "report.pdf"
    file_path.write_bytes(b"content")

    assert is_symlink(str(file_path)) is False


def test_is_symlink_true_for_symlink(tmp_path: Path) -> None:
    target = tmp_path / "report.pdf"
    target.write_bytes(b"content")
    link = tmp_path / "link.pdf"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("Creating symlinks requires elevated privileges on this system.")

    assert is_symlink(str(link)) is True


def test_read_file_metadata_returns_name_size_and_mime_type(tmp_path: Path) -> None:
    file_path = tmp_path / "report.pdf"
    file_path.write_bytes(b"content")

    metadata = read_file_metadata(str(file_path))

    assert metadata.file_name == "report.pdf"
    assert metadata.file_size == len(b"content")
    assert metadata.mime_type == "application/pdf"


def test_read_file_metadata_mime_type_none_for_unknown_extension(tmp_path: Path) -> None:
    file_path = tmp_path / "data.unknownext"
    file_path.write_bytes(b"content")

    metadata = read_file_metadata(str(file_path))

    assert metadata.mime_type is None
