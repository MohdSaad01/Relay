"""PairingService — orchestrates the pairing handshake described in
10_Security.md §4-6: a desktop-generated QR starts the attempt, Android
submits its device info, the desktop user explicitly approves or rejects it,
and Android collects the resulting credentials exactly once.

Persistence is delegated to existing services and repositories rather than
duplicated here: DeviceService owns Device creation, DeviceSessionRepository
owns session rows, AppSettingsService supplies the configured session
lifetime. Ephemeral handshake state (tokens, timers, pending requests) lives
entirely in PairingManager and is never written to the database
(13_Database_Design.md §9).
"""

import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import generate_token, hash_token
from app.models.device import Device
from app.models.device_session import DeviceSession
from app.models.enums import Platform
from app.repositories.device_session_repository import DeviceSessionRepository
from app.schemas.pairing import PairingQrPayload
from app.services.app_settings_service import AppSettingsService
from app.services.device_service import DeviceService
from app.services.exceptions import NameConflictError, NotFoundError, ValidationError
from app.services.pairing_manager import (
    ApprovedResult,
    PairingAttempt,
    PairingManager,
    PairingStatus,
    RequestingDeviceInfo,
)
from app.utils.network import get_local_ip_address
from app.utils.time import utc_now

logger = logging.getLogger(__name__)

NameConflictAction = Literal["replace", "make_new"]


@dataclass
class NameConflictInfo:
    """A live P43.1 name collision found against the current device list:
    `requesting_device.device_name` already belongs to a different,
    already-paired device (a different device_identifier — see
    PendingPairingReview)."""

    existing_device_id: int
    existing_device_name: str


@dataclass
class PendingPairingReview:
    """Everything the Desktop needs to review a pairing request awaiting
    approval: the requesting device's own info, plus a live P43.1 name
    collision check. `name_conflict` is only ever set when
    `device_identifier` does *not* already match a paired device — a
    matching identifier is always a P43 reconciliation, never a P43.1
    collision, even if the name also happens to match (identifier takes
    precedence, docs/15_QA_NOTEBOOK.md's P43.1 entry)."""

    requesting_device: RequestingDeviceInfo
    name_conflict: NameConflictInfo | None


class PairingService:
    """Business logic for the pairing handshake."""

    def __init__(self, db: Session, pairing_manager: PairingManager) -> None:
        self.db = db
        self.pairing_manager = pairing_manager
        self.device_service = DeviceService(db)
        self.device_session_repository = DeviceSessionRepository(db)
        self.app_settings_service = AppSettingsService(db)

    def start_pairing(self) -> PairingAttempt:
        """Begin a new pairing attempt, replacing any still-pending one."""
        settings = get_settings()
        now = utc_now()
        attempt = PairingAttempt(
            token=generate_token(),
            status=PairingStatus.PENDING,
            created_at=now,
            expires_at=now + timedelta(seconds=settings.PAIRING_TOKEN_TTL_SECONDS),
        )
        self.pairing_manager.start(attempt)
        logger.info("Pairing attempt started.")
        return attempt

    def build_qr_payload(self, attempt: PairingAttempt) -> PairingQrPayload:
        """Project a pairing attempt into the QR-ready payload (10_Security.md §5)."""
        settings = get_settings()
        return PairingQrPayload(
            desktop_ip=get_local_ip_address(),
            port=settings.PORT,
            pairing_token=attempt.token,
            protocol_version=settings.PAIRING_PROTOCOL_VERSION,
            relay_version=settings.APP_VERSION,
        )

    def submit_pairing_request(
        self, token: str, device_identifier: str, device_name: str, platform: Platform
    ) -> PairingAttempt:
        """Record an incoming pairing request from a scanning Android device.

        An already-registered device_identifier is not rejected here (it
        was, prior to P43) — it is a legitimate re-pair of a device this
        desktop already trusts (e.g. its session expired, or the desktop
        user removed it and the same phone is reconnecting), and still
        requires the same explicit desktop-user approval as a brand new
        device. approve_pairing decides whether to reconcile the existing
        Device row or create a new one; see docs/15_QA_NOTEBOOK.md's P43
        entry for the full reasoning.
        """
        name = device_name.strip()
        if not name:
            raise ValidationError("Device name cannot be empty.")

        requesting_device = RequestingDeviceInfo(
            device_identifier=device_identifier, device_name=name, platform=platform
        )
        attempt = self.pairing_manager.submit_request(token, requesting_device)
        if attempt is None:
            raise NotFoundError("Pairing request not found, expired, or already submitted.")

        logger.info(
            "Device requested pairing: identifier=%s name=%s platform=%s",
            device_identifier,
            name,
            platform.value,
        )
        return attempt

    def get_pending_request(self, token: str) -> PendingPairingReview:
        """Return the requesting device's info for the desktop user to review,
        plus a live P43.1 name-collision check against the CURRENT device list.

        device_identifier is checked first: a match is always a P43
        reconciliation, never a P43.1 name collision, even if the name also
        happens to match (identifier takes precedence).
        """
        attempt = self.pairing_manager.get(token)
        if attempt is None or attempt.requesting_device is None:
            raise NotFoundError("No pending pairing request found for this token.")

        requesting_device = attempt.requesting_device
        name_conflict = None
        if self.device_service.get_by_identifier_or_none(requesting_device.device_identifier) is None:
            colliding_device = self.device_service.find_name_collision_or_none(
                requesting_device.device_name
            )
            if colliding_device is not None:
                name_conflict = NameConflictInfo(
                    existing_device_id=colliding_device.id,
                    existing_device_name=colliding_device.device_name,
                )
        return PendingPairingReview(requesting_device=requesting_device, name_conflict=name_conflict)

    def approve_pairing(
        self, token: str, name_conflict_action: NameConflictAction | None = None
    ) -> Device:
        """Approve a pending pairing request: register (or re-pair, or
        collision-resolve) the device and mint its session.

        Three cases, checked in this order (docs/15_QA_NOTEBOOK.md's P43.1
        entry has the full reasoning — identifier always takes precedence
        over name):

        1. device_identifier already belongs to a known Device (P43 — a
           re-pair from the same Android install: its session expired, or
           the desktop user removed it and the same phone reconnected). The
           existing row is reconciled in place (DeviceService.reconcile_device
           — rotates device_secret_hash, preserves device_name/id/paired_at)
           rather than creating a duplicate. name_conflict_action is ignored
           entirely in this case.
        2. A genuinely new identifier whose device_name collides (P43.1's
           normalization rule) with an already-paired device — e.g. the same
           phone, reinstalled, paired under its old name while the desktop
           still has the pre-reinstall row. name_conflict_action must be
           "replace" (DeviceService.replace_device) or "make_new"
           (DeviceService.generate_unique_name + register_device). If it is
           None, the device row is NOT created — the attempt is restored to
           AWAITING_APPROVAL and NameConflictError is raised so the Desktop
           can ask the user and retry with a decision.
        3. A genuinely new identifier with no name collision — registers a
           new Device, unchanged from before P43/P43.1.

        The collision check in case 2 is re-run here (not reused from an
        earlier get_pending_request call) so it reflects live state at the
        moment of commit, not whatever the Desktop UI last polled.
        """
        attempt = self.pairing_manager.claim_for_approval(token)
        if attempt is None or attempt.requesting_device is None:
            raise NotFoundError("No pairing request awaiting approval for this token.")

        requesting_device = attempt.requesting_device
        device_secret = generate_token()
        existing_device = self.device_service.get_by_identifier_or_none(
            requesting_device.device_identifier
        )
        if existing_device is not None:
            for old_session in self.device_session_repository.list_by_device(existing_device.id):
                self.device_session_repository.delete(old_session)
            device = self.device_service.reconcile_device(
                existing_device, device_secret_hash=hash_token(device_secret)
            )
        else:
            colliding_device = self.device_service.find_name_collision_or_none(
                requesting_device.device_name
            )
            if colliding_device is None:
                device = self.device_service.register_device(
                    device_identifier=requesting_device.device_identifier,
                    device_name=requesting_device.device_name,
                    platform=requesting_device.platform,
                    device_secret_hash=hash_token(device_secret),
                )
            elif name_conflict_action == "replace":
                device = self.device_service.replace_device(
                    colliding_device,
                    device_identifier=requesting_device.device_identifier,
                    device_name=requesting_device.device_name,
                    platform=requesting_device.platform,
                    device_secret_hash=hash_token(device_secret),
                )
            elif name_conflict_action == "make_new":
                unique_name = self.device_service.generate_unique_name(requesting_device.device_name)
                device = self.device_service.register_device(
                    device_identifier=requesting_device.device_identifier,
                    device_name=unique_name,
                    platform=requesting_device.platform,
                    device_secret_hash=hash_token(device_secret),
                )
            else:
                self.pairing_manager.restore_awaiting_approval(attempt)
                raise NameConflictError(colliding_device.id, colliding_device.device_name)

        session_token = generate_token()
        app_settings = self.app_settings_service.get_settings()
        now = utc_now()
        expires_at = now + timedelta(minutes=app_settings.session_token_lifetime_minutes)
        session = DeviceSession(
            device_id=device.id,
            token_hash=hash_token(session_token),
            issued_at=now,
            expires_at=expires_at,
        )
        self.device_session_repository.create(session)
        self.db.commit()

        attempt.status = PairingStatus.APPROVED
        attempt.result = ApprovedResult(
            device_id=device.id,
            device_identifier=device.device_identifier,
            device_name=device.device_name,
            device_secret=device_secret,
            session_token=session_token,
            session_expires_at=expires_at,
        )
        self.pairing_manager.store_approved(attempt)

        logger.info(
            "Pairing approved: identifier=%s name=%s device_id=%s",
            device.device_identifier,
            device.device_name,
            device.id,
        )
        return device

    def reject_pairing(self, token: str) -> None:
        """Deny a pending pairing request."""
        attempt = self.pairing_manager.reject(token)
        if attempt is None:
            raise NotFoundError("No pairing request awaiting approval for this token.")

        device_identifier = (
            attempt.requesting_device.device_identifier if attempt.requesting_device else "unknown"
        )
        logger.info("Pairing rejected: identifier=%s", device_identifier)

    def collect_result(self, token: str) -> ApprovedResult:
        """Retrieve the one-time outcome of a completed pairing attempt.

        Removes the attempt from memory on read, so credentials are only
        ever handed out once. Raises ValidationError if the request was
        rejected, NotFoundError if there is no completed attempt for this
        token (unknown, expired, or still awaiting approval).
        """
        attempt = self.pairing_manager.collect_result(token)
        if attempt is None:
            raise NotFoundError("No completed pairing result found for this token.")
        if attempt.status is PairingStatus.REJECTED:
            raise ValidationError("The pairing request was rejected by the desktop user.")
        if attempt.result is None:
            raise NotFoundError("No completed pairing result found for this token.")
        return attempt.result
