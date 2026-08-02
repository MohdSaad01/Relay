"""Settings endpoints: view and update the singleton application settings row."""

from fastapi import APIRouter

from app.api.dependencies import AppSettingsServiceDep
from app.api.responses import success
from app.schemas.common import ApiResponse
from app.schemas.settings import SettingsResponse, SettingsUpdateRequest

router = APIRouter()


@router.get("", response_model=ApiResponse)
def get_settings(service: AppSettingsServiceDep) -> ApiResponse:
    """Return the current application settings."""
    settings = service.get_settings()
    return success(SettingsResponse.model_validate(settings).model_dump(mode="json"))


@router.patch("", response_model=ApiResponse)
def update_settings(body: SettingsUpdateRequest, service: AppSettingsServiceDep) -> ApiResponse:
    """Apply a partial update to the application settings."""
    settings = service.update_settings(
        device_display_name=body.device_display_name,
        download_directory=body.download_directory,
        discovery_enabled=body.discovery_enabled,
        session_token_lifetime_minutes=body.session_token_lifetime_minutes,
    )
    return success(
        SettingsResponse.model_validate(settings).model_dump(mode="json"),
        message="Settings updated successfully.",
    )
