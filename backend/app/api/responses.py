"""Helper for constructing successful API response envelopes.

Avoids repeating `ApiResponse(success=True, ...)` throughout route handlers.
"""

from typing import Any

from app.schemas.common import ApiResponse


def success(data: Any = None, message: str = "Operation completed successfully.") -> ApiResponse:
    """Build a successful ApiResponse envelope."""
    return ApiResponse(success=True, message=message, data=data if data is not None else {})
