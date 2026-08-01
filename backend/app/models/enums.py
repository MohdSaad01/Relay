"""Enum types shared across database models."""

import enum

from sqlalchemy import Enum as SqlEnum


class Platform(str, enum.Enum):
    """Client platform for a paired device."""

    ANDROID = "android"


class TransferDirection(str, enum.Enum):
    """Direction of a file transfer, framed from the desktop's perspective."""

    SEND = "send"
    RECEIVE = "receive"


class TransferStatus(str, enum.Enum):
    """Lifecycle state of a transfer."""

    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def as_db_enum(enum_cls: type[enum.Enum]) -> SqlEnum:
    """Build a SQLAlchemy Enum column type that stores member values, not member names.

    SQLAlchemy's Enum type persists a Python enum's `.name` by default, but the
    approved schema specifies lowercase stored values (e.g. "in_progress"), so
    every enum column must be built through this helper instead of `SqlEnum(...)` directly.
    """
    return SqlEnum(enum_cls, values_callable=lambda member_cls: [member.value for member in member_cls])
