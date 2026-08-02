"""DiscoveryService — broadcasts periodic UDP announcements so nearby Android
devices can find this desktop's Relay backend without manual configuration
(09_Networking.md §4, Device Discovery milestone).

Deliberately outside the trust boundary (10_Security.md §3/§4: "Unpaired
devices may discover Relay but cannot browse files or initiate transfers").
The broadcast is one-directional — the desktop never listens for a reply —
so there is no inbound firewall rule to grant beyond the one the API's own
TCP port already needs, and there is no listening socket here that could be
flooded. Entirely isolated from Pairing, Authentication, Transfers, and
Streaming: this module only reads AppSettingsService, and nothing else in
the codebase depends on it.

A broadcast failure (socket creation, a transient send error) is always
non-fatal to the rest of the backend — discovery is a pure UX convenience
layer, never a dependency of pairing (PairingService.build_qr_payload
already resolves desktop_ip/port independently) or any other feature.
"""

import logging
import socket
import threading
import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.database.session import SessionLocal
from app.schemas.discovery import DiscoveryAnnouncePayload
from app.services.app_settings_service import AppSettingsService
from app.utils.network import get_broadcast_address, get_local_ip_address

logger = logging.getLogger(__name__)

_JOIN_TIMEOUT_SECONDS = 2.0


class DiscoveryService:
    """Owns the lifecycle of the background UDP broadcast thread.

    Unlike the request-scoped services elsewhere in this codebase, this
    class is not built per-request — it is started once at process startup
    and stopped once at shutdown (app/main.py's `lifespan`), and its
    broadcast loop runs on a single dedicated daemon thread. Because that
    thread outlives any single request, it cannot borrow a request-scoped
    database Session the way other services do; instead it takes a session
    factory (defaulting to the real SessionLocal) and opens a fresh, short-
    lived session on every tick — the same pattern a periodic background
    job would use.
    """

    def __init__(self, session_factory: Callable[[], Session] = SessionLocal) -> None:
        self.instance_id = uuid.uuid4().hex
        self._session_factory = session_factory
        self._socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()

    @property
    def is_broadcasting(self) -> bool:
        """Whether the broadcast thread is currently running.

        Reflects actual runtime state, not the desired `discovery_enabled`
        setting — the two can disagree if socket creation failed at startup
        (see `start`), or if the flag is currently off but the thread is
        still alive and simply skipping ticks.
        """
        with self._lock:
            return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        """Start the background broadcast thread. Safe to call if already started.

        Socket creation failure is logged and swallowed rather than raised:
        the rest of the backend must keep working with discovery simply
        unavailable for this run (09_Networking.md §9/§10).
        """
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return

            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            except OSError:
                logger.warning(
                    "Could not create the discovery broadcast socket; "
                    "device discovery is disabled for this run.",
                    exc_info=True,
                )
                return

            self._socket = sock
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._run, args=(sock,), name="discovery-broadcaster", daemon=True
            )
            self._thread.start()
            logger.info("Device discovery broadcaster started (instance_id=%s).", self.instance_id)

    def stop(self) -> None:
        """Stop the background broadcast thread. Safe to call if not started."""
        with self._lock:
            if self._thread is None:
                return

            self._stop_event.set()
            self._thread.join(timeout=_JOIN_TIMEOUT_SECONDS)
            self._thread = None

            if self._socket is not None:
                self._socket.close()
                self._socket = None

            logger.info("Device discovery broadcaster stopped.")

    def _run(self, sock: socket.socket) -> None:
        """Broadcast loop body, run on the dedicated daemon thread.

        A single bad tick (e.g. a transient network-down error) must not
        kill the loop — it is caught, logged, and the next tick tries again
        on its own, so the broad `except Exception` here is deliberate.
        """
        settings = get_settings()
        while not self._stop_event.is_set():
            try:
                self._broadcast_once(sock, settings)
            except Exception:
                logger.exception("Discovery broadcast tick failed; will retry next interval.")
            self._stop_event.wait(settings.DISCOVERY_BROADCAST_INTERVAL_SECONDS)

    def _broadcast_once(self, sock: socket.socket, settings: Settings) -> None:
        """Send a single announcement, unless discovery is currently disabled."""
        db = self._session_factory()
        try:
            app_settings = AppSettingsService(db).get_settings()
        finally:
            db.close()

        if not app_settings.discovery_enabled:
            return

        payload = DiscoveryAnnouncePayload(
            protocol_version=settings.DISCOVERY_PROTOCOL_VERSION,
            relay_version=settings.APP_VERSION,
            instance_id=self.instance_id,
            device_display_name=app_settings.device_display_name,
            desktop_ip=get_local_ip_address(),
            port=settings.PORT,
        )
        message = payload.model_dump_json().encode("utf-8")
        sock.sendto(message, (get_broadcast_address(), settings.DISCOVERY_PORT))


_discovery_service = DiscoveryService()


def get_discovery_service() -> DiscoveryService:
    """Return the process-wide DiscoveryService singleton."""
    return _discovery_service
