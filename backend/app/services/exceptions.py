"""Domain-level exceptions raised by the Service Layer.

Deliberately independent of FastAPI and HTTP status codes: the API layer
(added in a later milestone) is responsible for catching these and
translating them into the response envelope defined in 05_API_Design.md.
"""


class ServiceError(Exception):
    """Base class for all Service Layer exceptions."""


class NotFoundError(ServiceError):
    """Raised when a requested entity does not exist."""


class ValidationError(ServiceError):
    """Raised when input fails a business rule the service is responsible for enforcing."""


class ConflictError(ServiceError):
    """Raised when an operation would violate a uniqueness or state constraint."""


class NameConflictError(ConflictError):
    """Raised by PairingService.approve_pairing (P43.1) when the incoming device's
    name collides with an already-paired device (a different device_identifier —
    see docs/15_QA_NOTEBOOK.md's P43.1 entry for why identifier always takes
    precedence) and no name_conflict_action ("replace"/"make_new") was supplied
    to resolve it. Carries the colliding device's id/name so the API layer can
    hand the Desktop UI enough information to render the collision dialog
    without a second round trip."""

    def __init__(self, existing_device_id: int, existing_device_name: str) -> None:
        self.existing_device_id = existing_device_id
        self.existing_device_name = existing_device_name
        super().__init__(
            f"A device named '{existing_device_name}' is already paired. "
            "Choose whether to replace it or pair as a new device."
        )


class AuthenticationError(ServiceError):
    """Raised when a request's bearer session token is missing, unknown, or expired."""
