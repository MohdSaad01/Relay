"""DeviceService — business logic for managing paired devices.

Registration is exposed here for PairingService to call once a pairing
attempt is approved, keeping Device-creation logic in one place rather than
duplicating it in the pairing workflow. Authentication and last-seen
tracking belong to a future milestone and are intentionally not implemented
here.
"""

from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.enums import Platform
from app.repositories.device_repository import DeviceRepository
from app.services.exceptions import ConflictError, NotFoundError, ValidationError


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

    def is_device_registered(self, device_identifier: str) -> bool:
        """Check whether a device with this identifier has already completed pairing."""
        return self.device_repository.get_by_identifier(device_identifier) is not None

    def get_by_identifier_or_none(self, device_identifier: str) -> Device | None:
        """Look up an already-paired device by its stable identifier, for re-pairing (P43)."""
        return self.device_repository.get_by_identifier(device_identifier)

    def register_device(
        self,
        *,
        device_identifier: str,
        device_name: str,
        platform: Platform,
        device_secret_hash: str,
    ) -> Device:
        """Create a new paired Device. Raises ConflictError if already paired.

        Does not commit — this is normally combined with creating the
        device's first session in the same pairing transaction, so the
        caller (PairingService) controls the transaction boundary.
        """
        if self.is_device_registered(device_identifier):
            raise ConflictError(f"Device {device_identifier} is already paired.")

        device = Device(
            device_identifier=device_identifier,
            device_name=device_name,
            platform=platform,
            device_secret_hash=device_secret_hash,
        )
        return self.device_repository.create(device)

    def reconcile_device(self, device: Device, *, device_secret_hash: str) -> Device:
        """Re-pair an already-known device (matching device_identifier, P43).

        Rotates only device_secret_hash — device_name (may have been
        customized since the original pairing, e.g. via rename_device) and
        every other field are left untouched, so a re-pair from the same
        install (a session expiring, or the desktop user removing the
        device and the same phone re-pairing) never silently reverts a
        user's rename. The caller (PairingService.approve_pairing) is
        responsible for invalidating this device's existing sessions in the
        same transaction — this method only updates the Device row itself.

        Does not commit, matching register_device's convention.
        """
        device.device_secret_hash = device_secret_hash
        return self.device_repository.update(device)

    @staticmethod
    def _normalize_name(name: str) -> str:
        """Normalize a device name for P43.1 collision comparison: trim
        whitespace, compare case-insensitively. The value actually stored and
        displayed always preserves the user's original casing — only this
        comparison is normalized."""
        return name.strip().casefold()

    def find_name_collision_or_none(self, device_name: str) -> Device | None:
        """Return the currently paired device whose name collides with
        `device_name` under P43.1's normalization rule, or None.

        Checked against the live device list at call time — callers must
        re-invoke this immediately before committing a decision rather than
        reusing a result computed earlier (PairingService.approve_pairing
        does this; see docs/15_QA_NOTEBOOK.md's P43.1 entry for the race this
        guards against).
        """
        normalized = self._normalize_name(device_name)
        for device in self.device_repository.list_all():
            if self._normalize_name(device.device_name) == normalized:
                return device
        return None

    def generate_unique_name(self, base_name: str) -> str:
        """Compute the smallest-available `"{base_name} (N)"` suffix not
        currently used by any paired device (P43.1's "Make it a new device"
        decision), checked against the live device list. The backend is the
        sole authority for this name — a Desktop-side preview must never be
        trusted as the final value (a stale/racing UI could otherwise create
        a duplicate)."""
        existing = {self._normalize_name(d.device_name) for d in self.device_repository.list_all()}
        if self._normalize_name(base_name) not in existing:
            return base_name
        suffix = 1
        while self._normalize_name(f"{base_name} ({suffix})") in existing:
            suffix += 1
        return f"{base_name} ({suffix})"

    def replace_device(
        self,
        old_device: Device,
        *,
        device_identifier: str,
        device_name: str,
        platform: Platform,
        device_secret_hash: str,
    ) -> Device:
        """Replace an existing Device row with a newly pairing one of a
        different identifier but a colliding name (P43.1's "Replace the
        current device" decision).

        Deletes `old_device` — cascading its sessions via the same DB-level
        ON DELETE CASCADE remove_device/unpair already relies on, so its old
        credentials stop authenticating immediately — then registers the new
        device in its place. Does not commit, matching register_device's
        convention: the caller (PairingService.approve_pairing) controls the
        transaction boundary so the delete and the create land in one atomic
        commit, never leaving zero or two devices for this name if something
        fails in between.
        """
        self.device_repository.delete(old_device)
        return self.register_device(
            device_identifier=device_identifier,
            device_name=device_name,
            platform=platform,
            device_secret_hash=device_secret_hash,
        )
