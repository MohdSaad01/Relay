"""DeviceSessionRepository — persistence for device session (bearer token) rows."""

from datetime import datetime

from sqlalchemy import delete as sql_delete
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device_session import DeviceSession
from app.repositories.base_repository import BaseRepository


class DeviceSessionRepository(BaseRepository[DeviceSession]):
    """Database access for the `sessions` table."""

    def __init__(self, db: Session) -> None:
        super().__init__(db, DeviceSession)

    def create(self, session: DeviceSession) -> DeviceSession:
        """Add a new session and flush so its generated id is available."""
        self.db.add(session)
        self.db.flush()
        return session

    def get_by_token_hash(self, token_hash: str) -> DeviceSession | None:
        """Look up a session by its token hash, checked on every authenticated request."""
        statement = select(DeviceSession).where(DeviceSession.token_hash == token_hash)
        return self.db.execute(statement).scalar_one_or_none()

    def list_by_device(self, device_id: int) -> list[DeviceSession]:
        """List all sessions currently issued to a given device."""
        statement = select(DeviceSession).where(DeviceSession.device_id == device_id)
        return list(self.db.execute(statement).scalars().all())

    def update(self, session: DeviceSession) -> DeviceSession:
        """Flush pending changes (e.g. renewal) made to an already-tracked session."""
        self.db.flush()
        return session

    def delete(self, session: DeviceSession) -> None:
        """Explicitly invalidate a single session."""
        self.db.delete(session)
        self.db.flush()

    def delete_expired(self, now: datetime) -> int:
        """Bulk-delete all sessions that expired at or before `now`. Returns the count deleted."""
        statement = sql_delete(DeviceSession).where(DeviceSession.expires_at <= now)
        result = self.db.execute(statement)
        self.db.flush()
        return result.rowcount
