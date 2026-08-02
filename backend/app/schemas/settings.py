"""Request/response schemas for the /settings endpoints."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SettingsResponse(BaseModel):
    """Serialized view of the singleton AppSettings row."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    device_display_name: str
    download_directory: str
    discovery_enabled: bool
    session_token_lifetime_minutes: int
    created_at: datetime
    updated_at: datetime


class SettingsUpdateRequest(BaseModel):
    """Partial update payload for PATCH /settings. Only provided fields are changed.

    Validates structure and types only. Business rules (non-empty strings,
    positive lifetimes) are enforced by AppSettingsService, not duplicated here.
    """

    device_display_name: str | None = None
    download_directory: str | None = None
    discovery_enabled: bool | None = None
    session_token_lifetime_minutes: int | None = None
