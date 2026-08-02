"""Device discovery status endpoint (09_Networking.md §4, Device Discovery milestone).

Read-only: reports whether DiscoveryService is actually broadcasting right
now, since broadcasting can silently fail to start (see
DiscoveryService.start) or sit idle while app_settings.discovery_enabled is
off. This route adds no new way to control discovery — enabling/disabling
it remains PATCH /settings, unchanged from before this milestone.
"""

from fastapi import APIRouter

from app.api.dependencies import DiscoveryServiceDep
from app.api.responses import success
from app.core.config import get_settings
from app.schemas.common import ApiResponse
from app.schemas.discovery import DiscoveryStatusResponse

router = APIRouter()


@router.get("/status", response_model=ApiResponse)
def get_discovery_status(service: DiscoveryServiceDep) -> ApiResponse:
    """Report whether the desktop is currently broadcasting discovery announcements."""
    settings = get_settings()
    response = DiscoveryStatusResponse(
        broadcasting=service.is_broadcasting,
        instance_id=service.instance_id,
        port=settings.DISCOVERY_PORT,
    )
    return success(response.model_dump())
