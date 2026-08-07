"""Request/response schemas for the /folders endpoints (P13)."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SharedFolderResponse(BaseModel):
    """Full view of a shared folder, including its local filesystem path.

    Returned only to the trusted local desktop caller, matching
    SharedFileResponse's own scoping — never to a paired Android device.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_name: str
    folder_path: str
    total_size: int
    file_count: int
    shared_at: datetime


class AvailableFolderResponse(BaseModel):
    """Sanitized view of a shared folder for a paired Android device. Omits folder_path."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    folder_name: str
    total_size: int
    file_count: int
    shared_at: datetime


class ShareFolderRequest(BaseModel):
    """Payload for POST /folders.

    Validates structure and type only. Filesystem/business rules (must
    exist, must be absolute, must not be a symlink, must be a directory)
    are enforced by SharedFolderService, not duplicated here.
    """

    folder_path: str


class SharedFolderFileResponse(BaseModel):
    """One child file of a shared folder, as returned to the desktop by
    GET /folders/{id}/files. Includes file_path for parity with
    SharedFileResponse, since the desktop is also a trusted caller here."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    relative_path: str
    file_size: int
    mime_type: str | None


class AvailableFolderFileResponse(BaseModel):
    """One child file of a shared folder, as returned to a paired Android
    device by GET /folders/{id}/files — enough to drive a per-file
    POST /transfers/requests download proposal. Omits file_path."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    relative_path: str
    file_size: int
    mime_type: str | None
