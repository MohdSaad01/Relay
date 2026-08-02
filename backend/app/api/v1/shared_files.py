"""Shared file endpoints: register, list, inspect, refresh, and unshare files
from the desktop's shared list (13_Database_Design.md §6).

`GET /files` is the one dual-audience route in this router. The trusted
local desktop caller (Electron, always loopback — 13_Database_Design.md §9)
gets the full management view including file_path; a paired Android device
must present a valid DeviceSession bearer token and gets a sanitized view
instead (app/api/dependencies.py:get_requesting_device). The desktop itself
can never hold a DeviceSession — `devices.platform` is Android-only
(app/models/enums.py) — which is why this couldn't simply be
`CurrentDeviceDep` on its own.

Every other route here (add/detail/refresh/unshare) is desktop-only,
unauthenticated, matching the existing /devices and /settings precedent —
Android has no ability to select files or mutate the shared list in this
milestone.
"""

from fastapi import APIRouter, Response, status

from app.api.dependencies import RequestingDeviceDep, SharedFileServiceDep
from app.api.responses import success
from app.schemas.common import ApiResponse
from app.schemas.shared_file import (
    AvailableFileResponse,
    SharedFileResponse,
    ShareFileRequest,
)

router = APIRouter()


@router.post("", response_model=ApiResponse)
def share_file(body: ShareFileRequest, response: Response, service: SharedFileServiceDep) -> ApiResponse:
    """Add a file to the shared list, or refresh its metadata if already shared."""
    shared_file, was_created = service.share_file(body.file_path)
    response.status_code = status.HTTP_201_CREATED if was_created else status.HTTP_200_OK
    message = "File shared successfully." if was_created else "Shared file metadata refreshed."
    return success(SharedFileResponse.model_validate(shared_file).model_dump(mode="json"), message=message)


@router.get("", response_model=ApiResponse)
def list_files(requesting_device: RequestingDeviceDep, service: SharedFileServiceDep) -> ApiResponse:
    """List shared files: full view for the desktop, sanitized view for a paired Android device."""
    shared_files = service.list_shared_files()
    if requesting_device is None:
        data = [SharedFileResponse.model_validate(f).model_dump(mode="json") for f in shared_files]
    else:
        data = [AvailableFileResponse.model_validate(f).model_dump(mode="json") for f in shared_files]
    return success(data)


@router.get("/{shared_file_id}", response_model=ApiResponse)
def get_file(shared_file_id: int, service: SharedFileServiceDep) -> ApiResponse:
    """Return a single shared file by id (desktop management view)."""
    shared_file = service.get_shared_file_or_raise(shared_file_id)
    return success(SharedFileResponse.model_validate(shared_file).model_dump(mode="json"))


@router.post("/{shared_file_id}/refresh", response_model=ApiResponse)
def refresh_file(shared_file_id: int, service: SharedFileServiceDep) -> ApiResponse:
    """Re-read a shared file's metadata from disk."""
    shared_file = service.refresh_metadata(shared_file_id)
    return success(
        SharedFileResponse.model_validate(shared_file).model_dump(mode="json"),
        message="Shared file metadata refreshed.",
    )


@router.delete("/{shared_file_id}", status_code=status.HTTP_204_NO_CONTENT)
def unshare_file(shared_file_id: int, service: SharedFileServiceDep) -> Response:
    """Remove a file from the shared list."""
    service.unshare_file(shared_file_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
