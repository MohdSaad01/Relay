"""Health check endpoint."""

from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.common import ApiResponse

router = APIRouter()


@router.get("/health", response_model=ApiResponse)
def health_check() -> ApiResponse:
    """Report that the backend is running."""
    settings = get_settings()
    return ApiResponse(
        success=True,
        message="Relay backend is running.",
        data={"version": settings.APP_VERSION},
    )
