"""Declarative base and shared mixins for SQLAlchemy models."""

from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.utils.time import utc_now


class Base(DeclarativeBase):
    """Shared declarative base for all Relay database models."""


class TimestampMixin:
    """Adds created_at/updated_at columns, tracked in UTC by the application."""

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )
