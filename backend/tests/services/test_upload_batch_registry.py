"""Tests for UploadBatchRegistry (P13)."""

from pathlib import Path

from app.services.upload_batch_registry import UploadBatchRegistry


def test_resolve_returns_requested_name_when_no_conflict(tmp_path: Path) -> None:
    registry = UploadBatchRegistry()

    resolved = registry.resolve("batch-1", "Photos", str(tmp_path))

    assert resolved == "Photos"


def test_resolve_appends_suffix_on_conflict(tmp_path: Path) -> None:
    (tmp_path / "Photos").mkdir()
    registry = UploadBatchRegistry()

    resolved = registry.resolve("batch-1", "Photos", str(tmp_path))

    assert resolved == "Photos (1)"


def test_resolve_memoizes_per_batch_id(tmp_path: Path) -> None:
    (tmp_path / "Photos").mkdir()
    registry = UploadBatchRegistry()

    first = registry.resolve("batch-1", "Photos", str(tmp_path))
    # Even though "Photos (1)" isn't on disk yet, the second call for the
    # same batch must reuse the first call's result, not resolve again.
    second = registry.resolve("batch-1", "Photos", str(tmp_path))

    assert first == second == "Photos (1)"


def test_resolve_is_independent_per_batch_id(tmp_path: Path) -> None:
    (tmp_path / "Photos").mkdir()
    registry = UploadBatchRegistry()

    first_batch = registry.resolve("batch-1", "Photos", str(tmp_path))
    second_batch = registry.resolve("batch-2", "Photos", str(tmp_path))

    assert first_batch == "Photos (1)"
    assert second_batch == "Photos (1)"
