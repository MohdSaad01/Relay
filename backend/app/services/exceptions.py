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
