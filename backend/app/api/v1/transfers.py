"""Transfer endpoints: propose, decide on, list, and cancel file transfers
(docs/11_File_Transfer.md §7, docs/13_Database_Design.md §7).

Two sub-resources:

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

Routes stay thin — no business logic and no route-level try/except. Every
TransferService exception is translated to an HTTP response by the
centralized handlers in app/api/exception_handlers.py (Milestone 6).
"""

from fastapi import APIRouter, Response, status

from app.api.dependencies import (
    CurrentDeviceDep,
    RequestingDeviceDep,
    TransferServiceDep,
)
from app.api.responses import success
from app.schemas.common import ApiResponse
from app.schemas.transfer import (
    TransferRequestCreate,
    TransferRequestResponse,
    TransferResponse,
)

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
