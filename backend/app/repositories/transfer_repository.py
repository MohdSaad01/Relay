"""TransferRepository — persistence for individual file transfers (progress and history)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import TransferStatus
from app.models.transfer import Transfer
from app.repositories.base_repository import BaseRepository


class TransferRepository(BaseRepository[Transfer]):
    """Database access for the `transfers` table.

    No delete method: per the schema design, transfer rows are never removed
    by normal operation — they are the transfer history.
    """

    def __init__(self, db: Session) -> None:
        super().__init__(db, Transfer)

    def create(self, transfer: Transfer) -> Transfer:
        """Add a new transfer and flush so its generated id is available."""
        self.db.add(transfer)
        self.db.flush()
        return transfer

    def list_by_status(
        self, status: TransferStatus, *, limit: int = 100, offset: int = 0
    ) -> list[Transfer]:
        """List transfers in a given status (e.g. in-progress transfers), newest first."""
        statement = (
            select(Transfer)
            .where(Transfer.status == status)
            .order_by(Transfer.started_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.execute(statement).scalars().all())

    def list_history(self, *, limit: int = 100, offset: int = 0) -> list[Transfer]:
        """List all transfers, newest first. The primary transfer-history query."""
        statement = (
            select(Transfer)
            .order_by(Transfer.started_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.execute(statement).scalars().all())

    def list_by_device(
        self, device_id: int, *, limit: int = 100, offset: int = 0
    ) -> list[Transfer]:
        """List transfers associated with a specific device, newest first."""
        statement = (
            select(Transfer)
            .where(Transfer.device_id == device_id)
            .order_by(Transfer.started_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.execute(statement).scalars().all())

    def update(self, transfer: Transfer) -> Transfer:
        """Flush pending changes (e.g. progress, status) made to an already-tracked transfer."""
        self.db.flush()
        return transfer
