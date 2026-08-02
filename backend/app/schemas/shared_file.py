"""Request/response schemas for the /files endpoints."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SharedFileResponse(BaseModel):
    """Full view of a shared file, including its local filesystem path.

    Returned only to the trusted local desktop caller (see
    app/api/dependencies.py:get_requesting_device) — never to a paired
    Android device, which has no legitimate use for the desktop's local
    directory structure.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    file_name: str
    file_path: str
    file_size: int
    mime_type: str | None
    shared_at: datetime


class AvailableFileResponse(BaseModel):
    """Sanitized view of a shared file for a paired Android device. Omits file_path."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    file_name: str
    file_size: int
    mime_type: str | None
    shared_at: datetime


class ShareFileRequest(BaseModel):
    """Payload for POST /files.

    Validates structure and type only. Filesystem/business rules (must
    exist, must be absolute, must not be a symlink, must be a regular file)
    are enforced by SharedFileService, not duplicated here.
    """

    file_path: str
