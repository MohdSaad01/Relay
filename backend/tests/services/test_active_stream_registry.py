"""Tests for ActiveStreamRegistry."""

import pytest

from app.services.active_stream_registry import ActiveStreamRegistry
from app.services.exceptions import ConflictError


def test_acquire_then_release_allows_reacquiring() -> None:
    registry = ActiveStreamRegistry()

    registry.acquire(1)
    registry.release(1)
    registry.acquire(1)  # does not raise


def test_acquire_twice_without_release_raises_conflict() -> None:
    registry = ActiveStreamRegistry()
    registry.acquire(1)

    with pytest.raises(ConflictError):
        registry.acquire(1)


def test_acquire_is_independent_per_transfer_id() -> None:
    registry = ActiveStreamRegistry()

    registry.acquire(1)
    registry.acquire(2)  # does not raise


def test_release_without_acquire_is_a_no_op() -> None:
    registry = ActiveStreamRegistry()

    registry.release(999)  # does not raise
