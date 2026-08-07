"""Shared folder endpoints: register, list, inspect, refresh, unshare a
folder, and list its child files (P13, extending 13_Database_Design.md §6).

Mirrors app/api/v1/shared_files.py exactly. `GET /folders` and
`GET /folders/{id}/files` are the two dual-audience routes: the trusted
local desktop caller gets the full view including folder_path/file_path,
a paired Android device gets a sanitized view instead
(app/api/dependencies.py:get_requesting_device) — Android needs
`GET /folders/{id}/files` to get the child manifest it proposes individual
downloads against. Every other route here is desktop-only, unauthenticated,
matching the existing /files precedent.
"""

from fastapi import APIRouter, Response, status

from app.api.dependencies import RequestingDeviceDep, SharedFolderServiceDep
from app.api.responses import success
from app.schemas.common import ApiResponse
from app.schemas.shared_folder import (
    AvailableFolderFileResponse,
    AvailableFolderResponse,
    SharedFolderFileResponse,
    SharedFolderResponse,
    ShareFolderRequest,
)

router = APIRouter()


@router.post("", response_model=ApiResponse)
def share_folder(
    body: ShareFolderRequest, response: Response, service: SharedFolderServiceDep
) -> ApiResponse:
    """Add a folder to the shared list, or refresh it if already shared."""
    shared_folder, was_created = service.share_folder(body.folder_path)
    response.status_code = status.HTTP_201_CREATED if was_created else status.HTTP_200_OK
    message = "Folder shared successfully." if was_created else "Shared folder refreshed."
    return success(SharedFolderResponse.model_validate(shared_folder).model_dump(mode="json"), message=message)


@router.get("", response_model=ApiResponse)
def list_folders(requesting_device: RequestingDeviceDep, service: SharedFolderServiceDep) -> ApiResponse:
    """List shared folders: full view for the desktop, sanitized view for a paired Android device."""
    shared_folders = service.list_shared_folders()
    if requesting_device is None:
        data = [SharedFolderResponse.model_validate(f).model_dump(mode="json") for f in shared_folders]
    else:
        data = [AvailableFolderResponse.model_validate(f).model_dump(mode="json") for f in shared_folders]
    return success(data)


@router.get("/{shared_folder_id}", response_model=ApiResponse)
def get_folder(shared_folder_id: int, service: SharedFolderServiceDep) -> ApiResponse:
    """Return a single shared folder by id (desktop management view)."""
    shared_folder = service.get_shared_folder_or_raise(shared_folder_id)
    return success(SharedFolderResponse.model_validate(shared_folder).model_dump(mode="json"))


@router.get("/{shared_folder_id}/files", response_model=ApiResponse)
def list_folder_files(
    shared_folder_id: int, requesting_device: RequestingDeviceDep, service: SharedFolderServiceDep
) -> ApiResponse:
    """List a shared folder's child files. A paired Android device uses this
    to enumerate what to individually propose (POST /transfers/requests)
    when the user taps Download on the folder — the folder itself is never
    streamed as a single unit."""
    files = service.list_folder_files(shared_folder_id)
    if requesting_device is None:
        data = [SharedFolderFileResponse.model_validate(f).model_dump(mode="json") for f in files]
    else:
        data = [AvailableFolderFileResponse.model_validate(f).model_dump(mode="json") for f in files]
    return success(data)


@router.post("/{shared_folder_id}/refresh", response_model=ApiResponse)
def refresh_folder(shared_folder_id: int, service: SharedFolderServiceDep) -> ApiResponse:
    """Re-walk a shared folder from disk, reconciling its child files."""
    shared_folder = service.refresh_folder(shared_folder_id)
    return success(
        SharedFolderResponse.model_validate(shared_folder).model_dump(mode="json"),
        message="Shared folder refreshed.",
    )


@router.delete("/{shared_folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def unshare_folder(shared_folder_id: int, service: SharedFolderServiceDep) -> Response:
    """Remove a folder from the shared list."""
    service.unshare_folder(shared_folder_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
