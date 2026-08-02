"""DeviceService — business logic for managing already-paired devices.

Registration (pairing), authentication, and last-seen tracking belong to
future milestones (Pairing, Authentication) and are intentionally not
implemented here.
"""

from sqlalchemy.orm import Session

from app.models.device import Device
from app.repositories.device_repository import DeviceRepository
from app.services.exceptions import NotFoundError, ValidationError


class DeviceService:
    """Business logic for listing, inspecting, renaming, and removing paired devices."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.device_repository = DeviceRepository(db)

    def list_devices(self) -> list[Device]:
        """Return every paired device, most recently seen first."""
        return self.device_repository.list_all()

    def get_device_or_raise(self, device_id: int) -> Device:
        """Fetch a device by id, or raise NotFoundError if it does not exist."""
        device = self.device_repository.get_by_id(device_id)
        if device is None:
            raise NotFoundError(f"Device {device_id} was not found.")
        return device

    def rename_device(self, device_id: int, new_name: str) -> Device:
        """Rename a paired device. device_name is the only mutable field after pairing."""
        name = new_name.strip()
        if not name:
            raise ValidationError("Device name cannot be empty.")

        device = self.get_device_or_raise(device_id)
        device.device_name = name
        self.device_repository.update(device)
        self.db.commit()
        return device

    def remove_device(self, device_id: int) -> None:
        """Unpair a device. Hard delete; sessions cascade, transfer history is preserved."""
        device = self.get_device_or_raise(device_id)
        self.device_repository.delete(device)
        self.db.commit()
