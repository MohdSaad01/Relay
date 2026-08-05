"""AuthService — validates the bearer session tokens issued at pairing time
(PairingService.approve_pairing, M7/M8) against each protected request, per
10_Security.md §7-9.

Deliberately does not call db.commit(). This service runs ahead of the
route's own service call, inside the same request-scoped Session (M9 design
decision). Folding the last_used_at/last_seen_at bookkeeping into whatever
commit the route's own service performs keeps authentication itself from
being responsible for a transaction boundary on every protected request. On
a purely read-only route the bookkeeping update can therefore be rolled back
on session close instead of persisting — acceptable, since these two fields
are informational only and never participate in a security decision.

For that same reason, the bookkeeping below only mutates the already-tracked
`session`/`device` ORM objects — it deliberately does not route through
DeviceSessionRepository.update/DeviceRepository.update, both of which flush
immediately. SQLAlchemy picks up attribute changes on tracked objects at the
next flush/commit on its own; forcing one here would send the UPDATE (and
take SQLite's one write lock) on every single authenticated request,
including pure GETs that never commit — exactly the mechanism
docs/15_QA_NOTEBOOK.md's Milestone P8 traced as the source of concurrent
"database is locked" errors under polling. The one exception is the expired-
session branch below, which still calls repository.delete + commit
directly: that failure path ends the request right there, with no later
commit to ride along with.
"""

from sqlalchemy.orm import Session

from app.core.security import hash_token
from app.models.device import Device
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.services.exceptions import AuthenticationError
from app.utils.time import utc_now

_INVALID_TOKEN_MESSAGE = "Invalid or expired session token."


class AuthService:
    """Business logic for validating a bearer session token and resolving its device."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.device_session_repository = DeviceSessionRepository(db)
        self.device_repository = DeviceRepository(db)

    def authenticate(self, token: str | None) -> Device:
        """Validate a bearer session token and return the device it belongs to.

        Raises AuthenticationError with the same generic message for every
        failure — missing token, unknown token, or expired token — so the
        response never reveals which case occurred (10_Security.md §11).
        """
        if not token:
            raise AuthenticationError(_INVALID_TOKEN_MESSAGE)

        session = self.device_session_repository.get_by_token_hash(hash_token(token))
        if session is None:
            raise AuthenticationError(_INVALID_TOKEN_MESSAGE)

        now = utc_now()
        if session.expires_at <= now:
            self.device_session_repository.delete(session)
            # Unlike the last_used_at/last_seen_at bookkeeping below, this
            # delete has nothing else to ride along with: authentication
            # fails here, so no route-level service ever runs to commit it.
            # Without an explicit commit, get_db() closes the session on the
            # way out and the delete is silently rolled back, so the expired
            # row would never actually be removed (13_Database_Design.md §5:
            # expired sessions must be "deleted outright").
            self.db.commit()
            raise AuthenticationError(_INVALID_TOKEN_MESSAGE)

        device = session.device
        session.last_used_at = now
        device.last_seen_at = now

        return device
