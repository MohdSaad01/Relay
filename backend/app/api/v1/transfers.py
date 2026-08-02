"""Transfer endpoints: propose, decide on, list, cancel, and stream the bytes
of file transfers (docs/11_File_Transfer.md §7-8, docs/13_Database_Design.md §7).

Three sub-resources:

* `/transfers/requests` — the pending, in-memory phase (TransferManager).
  Android-only (`CurrentDeviceDep`) for proposing (POST) and withdrawing
  (DELETE) a request; dual-audience (`RequestingDeviceDep`) for
  listing/inspecting — the desktop sees every pending request, a paired
  Android device sees only its own. The accept/reject decision is
  desktop-only, unauthenticated, matching the existing /devices, /settings,
  and /files-mutation precedent (the desktop's own UI always calls over
  loopback).
* `/transfers` — the persisted phase (TransferRepository), created only once
  a request is accepted. Dual-audience throughout, same split as above.
* `/transfers/{id}/download` and `/transfers/{id}/upload` — the Streaming
  Engine (Milestone 12, TransferStreamService). Android-only, like the
  request sub-resource: the desktop never calls these itself, it just reads
  or writes local disk, since the backend is embedded in the desktop app.

Routes stay thin — no business logic and no route-level try/except. Every
TransferService/TransferStreamService exception is translated to an HTTP
response by the centralized handlers in app/api/exception_handlers.py
(Milestone 6).
"""

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import StreamingResponse

from app.api.dependencies import (
    CurrentDeviceDep,
    RequestingDeviceDep,
    TransferServiceDep,
    TransferStreamServiceDep,
)
from app.api.responses import success
from app.models.enums import TransferDirection, TransferStatus
from app.schemas.common import ApiResponse
from app.schemas.transfer import (
    TransferRequestCreate,
    TransferRequestResponse,
    TransferResponse,
)
from app.services.exceptions import ConflictError

router = APIRouter()


# --- /transfers/requests (pending, in-memory) --------------------------------


@router.post("/requests", response_model=ApiResponse, status_code=status.HTTP_201_CREATED)
def request_transfer(
    body: TransferRequestCreate, device: CurrentDeviceDep, service: TransferServiceDep
) -> ApiResponse:
    """Propose a transfer: a download of a shared file, or a proposed upload."""
    request = service.request_transfer(
        device, body.direction, body.shared_file_id, body.file_name, body.file_size
    )
    response = TransferRequestResponse.model_validate(request)
    return success(response.model_dump(mode="json"), message="Transfer requested.")


@router.get("/requests", response_model=ApiResponse)
def list_transfer_requests(device: RequestingDeviceDep, service: TransferServiceDep) -> ApiResponse:
    """List pending transfer requests: every one for the desktop, only its own for Android."""
    requests = service.list_requests(device)
    data = [TransferRequestResponse.model_validate(r).model_dump(mode="json") for r in requests]
    return success(data)


@router.get("/requests/{request_id}", response_model=ApiResponse)
def get_transfer_request(
    request_id: str, device: RequestingDeviceDep, service: TransferServiceDep
) -> ApiResponse:
    """Return a single transfer request, pending or already decided."""
    request = service.get_request_or_raise(request_id, device)
    response = TransferRequestResponse.model_validate(request)
    return success(response.model_dump(mode="json"))


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_transfer_request(
    request_id: str, device: CurrentDeviceDep, service: TransferServiceDep
) -> Response:
    """Withdraw one's own pending transfer request before the desktop decides."""
    service.withdraw_request(request_id, device)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/requests/{request_id}/accept", response_model=ApiResponse, status_code=status.HTTP_201_CREATED
)
def accept_transfer_request(request_id: str, service: TransferServiceDep) -> ApiResponse:
    """Accept a pending transfer request, creating its Transfer record."""
    transfer = service.accept_request(request_id)
    response = TransferResponse.model_validate(transfer)
    return success(response.model_dump(mode="json"), message="Transfer request accepted.")


@router.post("/requests/{request_id}/reject", response_model=ApiResponse)
def reject_transfer_request(request_id: str, service: TransferServiceDep) -> ApiResponse:
    """Reject a pending transfer request. No Transfer record is created."""
    service.reject_request(request_id)
    return success({"status": "rejected"}, message="Transfer request rejected.")


# --- /transfers (persisted) ---------------------------------------------------


@router.get("", response_model=ApiResponse)
def list_transfers(device: RequestingDeviceDep, service: TransferServiceDep) -> ApiResponse:
    """List transfers: full history for the desktop, only its own for Android."""
    transfers = service.list_transfers(device)
    data = [TransferResponse.model_validate(t).model_dump(mode="json") for t in transfers]
    return success(data)


@router.get("/{transfer_id}", response_model=ApiResponse)
def get_transfer(transfer_id: int, device: RequestingDeviceDep, service: TransferServiceDep) -> ApiResponse:
    """Return a single transfer by id."""
    transfer = service.get_transfer_or_raise(transfer_id, device)
    response = TransferResponse.model_validate(transfer)
    return success(response.model_dump(mode="json"))


@router.post("/{transfer_id}/cancel", response_model=ApiResponse)
def cancel_transfer(
    transfer_id: int, device: RequestingDeviceDep, service: TransferServiceDep
) -> ApiResponse:
    """Cancel an in-progress transfer."""
    transfer = service.cancel_transfer(transfer_id, device)
    response = TransferResponse.model_validate(transfer)
    return success(response.model_dump(mode="json"), message="Transfer cancelled.")


# --- /transfers/{id}/download, /transfers/{id}/upload (Streaming Engine) -------


@router.get("/{transfer_id}/download")
def download_transfer(
    transfer_id: int,
    device: CurrentDeviceDep,
    service: TransferServiceDep,
    stream_service: TransferStreamServiceDep,
) -> StreamingResponse:
    """Stream an in-progress SEND transfer's bytes to the paired Android device
    that requested it. Not wrapped in the standard ApiResponse envelope — the
    body is the raw file (05_API_Design.md §5)."""
    transfer = service.get_transfer_or_raise(transfer_id, device)
    if transfer.direction is not TransferDirection.SEND:
        raise ConflictError(f"Transfer {transfer_id} is not a download.")
    if transfer.status is not TransferStatus.IN_PROGRESS:
        raise ConflictError(f"Transfer {transfer_id} is not in progress.")

    file_path = stream_service.resolve_download_source(transfer)
    quoted_file_name = transfer.file_name.replace('"', "'")
    headers = {
        "Content-Length": str(transfer.file_size),
        "Content-Disposition": f'attachment; filename="{quoted_file_name}"',
    }
    return StreamingResponse(
        stream_service.stream_download(transfer, file_path),
        media_type=stream_service.guess_media_type(transfer.file_name),
        headers=headers,
    )


@router.post("/{transfer_id}/upload", response_model=ApiResponse)
async def upload_transfer(
    transfer_id: int,
    request: Request,
    device: CurrentDeviceDep,
    service: TransferServiceDep,
    stream_service: TransferStreamServiceDep,
) -> ApiResponse:
    """Receive an in-progress RECEIVE transfer's bytes from the paired Android
    device that owns it. The request body is the raw file, not JSON
    (05_API_Design.md §5) — only the response uses the standard envelope."""
    transfer = service.get_transfer_or_raise(transfer_id, device)
    if transfer.direction is not TransferDirection.RECEIVE:
        raise ConflictError(f"Transfer {transfer_id} is not an upload.")
    if transfer.status is not TransferStatus.IN_PROGRESS:
        raise ConflictError(f"Transfer {transfer_id} is not in progress.")

    updated = await stream_service.receive_upload(transfer, request.stream())
    response = TransferResponse.model_validate(updated)
    return success(response.model_dump(mode="json"), message="Transfer completed.")
