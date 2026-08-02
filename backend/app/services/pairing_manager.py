"""PairingManager — in-memory runtime store for pending pairing attempts.

Pairing tokens are deliberately never persisted (13_Database_Design.md §9):
they are single-use, expire within minutes, and the backend is embedded in
the desktop application's own process, so there is no restart-survival
scenario worth supporting. This module holds no database or service
dependencies — it is a pure state container, the in-memory analogue of a
Repository.
"""

import enum
import threading
from dataclasses import dataclass
from datetime import datetime

from app.models.enums import Platform
from app.utils.time import utc_now


class PairingStatus(str, enum.Enum):
    """Lifecycle state of a single pairing attempt. Never persisted."""

    PENDING = "pending"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass
class RequestingDeviceInfo:
    """Device details submitted by Android after it scans the QR code."""

    device_identifier: str
    device_name: str
    platform: Platform


@dataclass
class ApprovedResult:
    """One-time credentials produced when a pairing attempt is approved.

    Held in memory only until Android collects it; never written to disk.
    """

    device_id: int
    device_identifier: str
    device_secret: str
    session_token: str
    session_expires_at: datetime


@dataclass
class PairingAttempt:
    """A single pairing handshake in progress or awaiting collection."""

    token: str
    status: PairingStatus
    created_at: datetime
    expires_at: datetime
    requesting_device: RequestingDeviceInfo | None = None
    result: ApprovedResult | None = None


class PairingManager:
    """Holds the single active pairing attempt, if any.

    A single instance is shared for the lifetime of the backend process (see
    get_pairing_manager below) since pairing attempts are runtime-only state,
    unlike the request-scoped database Session used elsewhere. FastAPI routes
    in this codebase are sync `def` handlers, so Uvicorn runs them on a
    threadpool — every method below takes a plain threading.Lock for the
    duration of its state check-and-mutate, since a race between two
    concurrent requests (e.g. a double-clicked "Approve" button) must not be
    able to register the same device twice.
    """

    def __init__(self) -> None:
        self._attempts: dict[str, PairingAttempt] = {}
        self._lock = threading.Lock()

    def start(self, attempt: PairingAttempt) -> None:
        """Store a new pairing attempt, discarding any previous one.

        Only one pairing attempt is active at a time in Version 1.
        """
        with self._lock:
            self._attempts.clear()
            self._attempts[attempt.token] = attempt

    def get(self, token: str) -> PairingAttempt | None:
        """Return the attempt for `token`, or None if missing or expired."""
        with self._lock:
            return self._get_locked(token)

    def submit_request(
        self, token: str, requesting_device: RequestingDeviceInfo
    ) -> PairingAttempt | None:
        """Attach a requesting device and move PENDING -> AWAITING_APPROVAL.

        Returns None (leaving any existing attempt untouched) if the token is
        unknown, expired, or not currently PENDING.
        """
        with self._lock:
            attempt = self._get_locked(token)
            if attempt is None or attempt.status is not PairingStatus.PENDING:
                return None
            attempt.requesting_device = requesting_device
            attempt.status = PairingStatus.AWAITING_APPROVAL
            return attempt

    def claim_for_approval(self, token: str) -> PairingAttempt | None:
        """Atomically remove an AWAITING_APPROVAL attempt so exactly one caller can approve it.

        The caller is expected to register the device and mint its first
        session, then call store_approved() to make the result collectible.
        Removing the attempt immediately (rather than only flipping a status
        flag) is what guarantees two concurrent approvals can never both
        register the same device.
        """
        with self._lock:
            attempt = self._get_locked(token)
            if attempt is None or attempt.status is not PairingStatus.AWAITING_APPROVAL:
                return None
            del self._attempts[token]
            return attempt

    def store_approved(self, attempt: PairingAttempt) -> None:
        """Put a finalized, APPROVED attempt back into the store for Android to collect."""
        with self._lock:
            self._attempts[attempt.token] = attempt

    def reject(self, token: str) -> PairingAttempt | None:
        """Move AWAITING_APPROVAL -> REJECTED. No database work is involved, so this
        can safely finalize in a single step rather than needing a claim/store split.
        """
        with self._lock:
            attempt = self._get_locked(token)
            if attempt is None or attempt.status is not PairingStatus.AWAITING_APPROVAL:
                return None
            attempt.status = PairingStatus.REJECTED
            return attempt

    def collect_result(self, token: str) -> PairingAttempt | None:
        """Atomically remove and return a terminal (APPROVED or REJECTED) attempt.

        This is the single-use read: once collected, the attempt is gone, so
        credentials can never be handed out twice.
        """
        with self._lock:
            attempt = self._get_locked(token)
            if attempt is None or attempt.status not in (
                PairingStatus.APPROVED,
                PairingStatus.REJECTED,
            ):
                return None
            del self._attempts[token]
            return attempt

    def cleanup_expired(self) -> int:
        """Remove all expired attempts. Returns the number removed."""
        with self._lock:
            return self._evict_expired_locked()

    def _get_locked(self, token: str) -> PairingAttempt | None:
        """Look up `token`, evicting it first if expired. Caller must hold `_lock`."""
        self._evict_expired_locked()
        return self._attempts.get(token)

    def _evict_expired_locked(self) -> int:
        """Remove all expired attempts. Caller must hold `_lock`."""
        now = utc_now()
        expired = [token for token, attempt in self._attempts.items() if attempt.expires_at <= now]
        for token in expired:
            del self._attempts[token]
        return len(expired)


_pairing_manager = PairingManager()


def get_pairing_manager() -> PairingManager:
    """Return the process-wide PairingManager singleton."""
    return _pairing_manager
