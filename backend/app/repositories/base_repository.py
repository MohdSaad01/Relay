"""Generic base repository shared by all model-specific repositories."""

from typing import Generic, TypeVar

from sqlalchemy.orm import Session

from app.database.base import Base

ModelType = TypeVar("ModelType", bound=Base)


class BaseRepository(Generic[ModelType]):
    """Holds the session and model type; provides only genuinely shared behavior.

    Transaction boundaries (commit/rollback) belong to the Service Layer, not
    here — repositories only add, query, delete, and flush.
    """

    def __init__(self, db: Session, model: type[ModelType]) -> None:
        self.db = db
        self.model = model

    def get_by_id(self, entity_id: int) -> ModelType | None:
        """Fetch a single row by primary key, or None if it does not exist."""
        return self.db.get(self.model, entity_id)
