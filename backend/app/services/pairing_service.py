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
from datetime import timedelta

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
from app.services.exceptions import NotFoundError, ValidationError
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

    def get_pending_request(self, token: str) -> RequestingDeviceInfo:
        """Return the requesting device's info for the desktop user to review."""
        attempt = self.pairing_manager.get(token)
        if attempt is None or attempt.requesting_device is None:
            raise NotFoundError("No pending pairing request found for this token.")
        return attempt.requesting_device

    def approve_pairing(self, token: str) -> Device:
        """Approve a pending pairing request: register (or re-pair) the device and mint its session.

        If device_identifier already belongs to a known Device (P43 — a
        re-pair from the same Android install, not a fresh one: its
        session expired, or the desktop user removed it and the same phone
        reconnected), the existing row is reconciled in place
        (DeviceService.reconcile_device — rotates device_secret_hash,
        preserves device_name/id/paired_at) rather than creating a
        duplicate. Every session previously issued to that device is
        invalidated first, so old credentials stop authenticating the
        moment the new pairing is approved. Otherwise this registers a
        genuinely new Device, unchanged from before P43.
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
            device = self.device_service.register_device(
                device_identifier=requesting_device.device_identifier,
                device_name=requesting_device.device_name,
                platform=requesting_device.platform,
                device_secret_hash=hash_token(device_secret),
            )

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
