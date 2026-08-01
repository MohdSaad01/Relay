"""DeviceRepository — persistence for paired Android devices."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.device import Device
from app.repositories.base_repository import BaseRepository


class DeviceRepository(BaseRepository[Device]):
    """Database access for the `devices` table."""

    def __init__(self, db: Session) -> None:
        super().__init__(db, Device)

    def create(self, device: Device) -> Device:
        """Add a new device and flush so its generated id is available."""
        self.db.add(device)
        self.db.flush()
        return device

    def get_by_identifier(self, device_identifier: str) -> Device | None:
        """Look up a device by its stable external UUID, used during pairing."""
        statement = select(Device).where(Device.device_identifier == device_identifier)
        return self.db.execute(statement).scalar_one_or_none()

    def list_all(self) -> list[Device]:
        """List all paired devices, most recently seen first."""
        statement = select(Device).order_by(Device.last_seen_at.desc())
        return list(self.db.execute(statement).scalars().all())

    def update(self, device: Device) -> Device:
        """Flush pending changes made to an already-tracked device."""
        self.db.flush()
        return device

    def delete(self, device: Device) -> None:
        """Hard delete a device. Cascades to its sessions; transfers are set NULL."""
        self.db.delete(device)
        self.db.flush()
