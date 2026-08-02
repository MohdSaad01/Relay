"""Request/response schemas for the /devices endpoints."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import Platform


class DeviceResponse(BaseModel):
    """Serialized view of a paired Device. Excludes device_secret_hash."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    device_identifier: str
    device_name: str
    platform: Platform
    paired_at: datetime
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DeviceUpdateRequest(BaseModel):
    """Payload for PATCH /devices/{id}. device_name is the only mutable field.

    Validates structure and type only. The non-empty business rule is
    enforced by DeviceService.rename_device, not duplicated here.
    """

    device_name: str
