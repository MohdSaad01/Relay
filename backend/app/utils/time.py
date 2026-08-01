"""Shared time helpers."""

from datetime import datetime, timezone


def utc_now() -> datetime:
    """Return the current time as a naive UTC datetime, for storage in DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
