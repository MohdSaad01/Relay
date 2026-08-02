"""TransferManager — in-memory runtime store for pending transfer requests.

Mirrors app/services/pairing_manager.py's role (an ephemeral, lock-guarded
state container, not a Repository) but not its shape: 13_Database_Design.md
§7's `transfers.status` enum has no "pending" or "rejected" value, so a
proposed transfer that the desktop user hasn't yet acted on is deliberately
never written to the database — exactly like a pairing attempt that hasn't
been approved (13_Database_Design.md §9). Unlike pairing, which only ever
has one active attempt, transfers must support many concurrent pending
requests (multiple files, multiple devices — 11_File_Transfer.md §3/§10), so
entries are keyed by request_id rather than held in a single active slot.
"""

import enum
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.models.enums import TransferDirection
from app.utils.time import utc_now

# How long a just-decided (accepted/rejected) request is kept around after
# TransferManager.store_decided(), so the requesting device's poll observes
# the outcome instead of a 404. Not user-configurable — a pure implementation
# detail of how long a one-time poll result needs to remain visible.
_DECISION_RETENTION_SECONDS = 60


class TransferRequestStatus(str, enum.Enum):
    """Lifecycle state of a single pending transfer request. Never persisted."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


@dataclass
class PendingTransferRequest:
    """A single proposed transfer, awaiting the desktop user's decision.

    file_name/file_size/device_name here are request-time snapshots, shown
    to the desktop user before a decision is made — TransferService
    re-snapshots fresh values onto the `Transfer` row itself at accept time.
    """

    request_id: str
    device_id: int
    device_name: str
    direction: TransferDirection
    shared_file_id: int | None
    file_name: str
    file_size: int
    status: TransferRequestStatus
    created_at: datetime
    expires_at: datetime
    transfer_id: int | None = None


def generate_request_id() -> str:
    """Generate an opaque identifier for a new pending transfer request.

    Unlike pairing/session tokens, this value grants no access by itself —
    ownership is enforced by matching PendingTransferRequest.device_id
    against the caller's authenticated device — so a plain UUID4 is
    sufficient; there is no need for core.security's cryptographic secrets.
    """
    return uuid.uuid4().hex


class TransferManager:
    """Holds every pending transfer request, keyed by request_id.

    FastAPI routes in this codebase are sync `def` handlers, so Uvicorn runs
    them on a threadpool — every method below takes a plain threading.Lock
    for the duration of its state check-and-mutate, matching PairingManager.
    """

    def __init__(self) -> None:
        self._requests: dict[str, PendingTransferRequest] = {}
        self._lock = threading.Lock()

    def create(self, request: PendingTransferRequest) -> None:
        """Store a newly proposed transfer request."""
        with self._lock:
            self._requests[request.request_id] = request

    def get(self, request_id: str) -> PendingTransferRequest | None:
        """Return the request for `request_id` (any status), or None if missing or expired."""
        with self._lock:
            return self._get_locked(request_id)

    def list_pending(self, device_id: int | None = None) -> list[PendingTransferRequest]:
        """List still-PENDING requests, optionally scoped to one device."""
        with self._lock:
            self._evict_expired_locked()
            return [
                request
                for request in self._requests.values()
                if request.status is TransferRequestStatus.PENDING
                and (device_id is None or request.device_id == device_id)
            ]

    def claim_for_decision(self, request_id: str) -> PendingTransferRequest | None:
        """Atomically remove a PENDING request so exactly one caller can decide it.

        Mirrors PairingManager.claim_for_approval: removing it immediately
        (rather than flipping a status flag in place) guarantees two
        concurrent accept/reject calls can never both act on the same request.
        """
        with self._lock:
            request = self._get_locked(request_id)
            if request is None or request.status is not TransferRequestStatus.PENDING:
                return None
            del self._requests[request_id]
            return request

    def store_decided(self, request: PendingTransferRequest) -> None:
        """Put a claimed, now-terminal (ACCEPTED or REJECTED) request back into the
        store, with its expiry extended, so the requesting device can observe
        the outcome by polling for a short grace period.
        """
        request.expires_at = utc_now() + timedelta(seconds=_DECISION_RETENTION_SECONDS)
        with self._lock:
            self._requests[request.request_id] = request

    def withdraw(self, request_id: str, device_id: int) -> PendingTransferRequest | None:
        """Atomically remove a still-PENDING request, only if it belongs to `device_id`."""
        with self._lock:
            request = self._get_locked(request_id)
            if (
                request is None
                or request.status is not TransferRequestStatus.PENDING
                or request.device_id != device_id
            ):
                return None
            del self._requests[request_id]
            return request

    def cleanup_expired(self) -> int:
        """Remove all expired requests. Returns the number removed."""
        with self._lock:
            return self._evict_expired_locked()

    def _get_locked(self, request_id: str) -> PendingTransferRequest | None:
        """Look up `request_id`, evicting it first if expired. Caller must hold `_lock`."""
        self._evict_expired_locked()
        return self._requests.get(request_id)

    def _evict_expired_locked(self) -> int:
        """Remove all expired requests. Caller must hold `_lock`."""
        now = utc_now()
        expired = [rid for rid, request in self._requests.items() if request.expires_at <= now]
        for rid in expired:
            del self._requests[rid]
        return len(expired)


_transfer_manager = TransferManager()


def get_transfer_manager() -> TransferManager:
    """Return the process-wide TransferManager singleton."""
    return _transfer_manager
