"""Database schema initialization."""

from app.database.base import Base
from app.database.session import engine
from app.models import (  # noqa: F401 (import registers models on Base.metadata)
    AppSettings,
    Device,
    DeviceSession,
    SharedFile,
    SharedFolder,
    Transfer,
)


def init_db() -> None:
    """Create all database tables that do not already exist."""
    Base.metadata.create_all(bind=engine)
