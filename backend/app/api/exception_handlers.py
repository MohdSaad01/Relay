"""Centralized mapping from Service Layer exceptions to HTTP responses.

Keeps route handlers free of repeated try/except blocks (05_API_Design.md
§17: "keep controllers thin"). Registered on the FastAPI app in main.py.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.schemas.common import ApiResponse
from app.services.exceptions import ConflictError, NotFoundError, ValidationError

logger = logging.getLogger(__name__)


def _error_response(status_code: int, message: str) -> JSONResponse:
    """Build an error response using the standard ApiResponse envelope."""
    body = ApiResponse(success=False, message=message, data=None)
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


async def handle_not_found_error(request: Request, exc: NotFoundError) -> JSONResponse:
    """Map NotFoundError to 404."""
    return _error_response(404, str(exc))


async def handle_validation_error(request: Request, exc: ValidationError) -> JSONResponse:
    """Map ValidationError to 400 and log it at INFO — expected, user-caused input rejection."""
    logger.info("Validation error on %s %s: %s", request.method, request.url.path, exc)
    return _error_response(400, str(exc))


async def handle_conflict_error(request: Request, exc: ConflictError) -> JSONResponse:
    """Map ConflictError to 409 and log it at WARNING — a state conflict worth noting."""
    logger.warning("Conflict error on %s %s: %s", request.method, request.url.path, exc)
    return _error_response(409, str(exc))


async def handle_request_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Normalize FastAPI's built-in request validation errors into the same envelope."""
    return _error_response(422, "Request validation failed.")


async def handle_unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    """Map any unexpected exception to 500 and log it at ERROR with the full traceback."""
    logger.error(
        "Unhandled exception on %s %s", request.method, request.url.path, exc_info=exc
    )
    return _error_response(500, "An unexpected error occurred.")


def register_exception_handlers(app: FastAPI) -> None:
    """Attach all exception handlers to the FastAPI app instance."""
    app.add_exception_handler(NotFoundError, handle_not_found_error)
    app.add_exception_handler(ValidationError, handle_validation_error)
    app.add_exception_handler(ConflictError, handle_conflict_error)
    app.add_exception_handler(RequestValidationError, handle_request_validation_error)
    app.add_exception_handler(Exception, handle_unhandled_exception)
