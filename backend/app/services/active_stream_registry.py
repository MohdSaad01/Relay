"""ActiveStreamRegistry — in-memory guard preventing two concurrent byte
streams from operating on the same transfer at once (e.g. a retried
download request from a flaky connection while the first attempt is still
active).

Purely a concurrency guard, not a state container like TransferManager/
PairingManager: it tracks nothing but "is a stream currently active for
this transfer_id" and is never consulted for anything else. Mirrors their
threading.Lock pattern (FastAPI runs sync `def` handlers on a threadpool,
so concurrent requests are a real possibility — see PairingManager for the
same reasoning).
"""

import threading

from app.services.exceptions import ConflictError


class ActiveStreamRegistry:
    """Tracks which transfer ids currently have an active byte stream."""

    def __init__(self) -> None:
        self._active_transfer_ids: set[int] = set()
        self._lock = threading.Lock()

    def acquire(self, transfer_id: int) -> None:
        """Mark `transfer_id` as actively streaming.

        Raises ConflictError if a stream is already active for this transfer.
        """
        with self._lock:
            if transfer_id in self._active_transfer_ids:
                raise ConflictError(f"Transfer {transfer_id} already has an active stream.")
            self._active_transfer_ids.add(transfer_id)

    def release(self, transfer_id: int) -> None:
        """Clear the active-stream marker for `transfer_id`. Safe to call even if not held."""
        with self._lock:
            self._active_transfer_ids.discard(transfer_id)


_active_stream_registry = ActiveStreamRegistry()


def get_active_stream_registry() -> ActiveStreamRegistry:
    """Return the process-wide ActiveStreamRegistry singleton."""
    return _active_stream_registry
