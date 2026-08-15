"""Pairing endpoints: exposes PairingService's handshake (10_Security.md §4-6) over HTTP.

Desktop-only: start, pending, approve, reject.
Android-only: request (POST), result.

Routes stay thin — no business logic and no route-level try/except. Every
PairingService exception is translated to an HTTP response by the
centralized handlers in app/api/exception_handlers.py (Milestone 6).
"""

from fastapi import APIRouter, status

from app.api.dependencies import PairingServiceDep
from app.api.responses import success
from app.schemas.common import ApiResponse
from app.schemas.device import DeviceResponse
from app.schemas.pairing import (
    PairingApproveRequest,
    PairingPendingRequestResponse,
    PairingRejectRequest,
    PairingRequestSubmitRequest,
    PairingResultResponse,
    PairingStartResponse,
)

router = APIRouter()


@router.post("/start", response_model=ApiResponse, status_code=status.HTTP_201_CREATED)
def start_pairing(service: PairingServiceDep) -> ApiResponse:
    """Begin a new pairing attempt and return the QR payload for Android to scan."""
    attempt = service.start_pairing()
    qr_payload = service.build_qr_payload(attempt)
    response = PairingStartResponse(qr=qr_payload, expires_at=attempt.expires_at)
    return success(response.model_dump(mode="json"), message="Pairing attempt started.")


@router.get("/pending/{token}", response_model=ApiResponse)
def get_pending_request(token: str, service: PairingServiceDep) -> ApiResponse:
    """Return the requesting device's info for the desktop user to review."""
    pending = service.get_pending_request(token)
    response = PairingPendingRequestResponse.model_validate(pending)
    return success(response.model_dump(mode="json"))


@router.post("/request", response_model=ApiResponse)
def submit_pairing_request(body: PairingRequestSubmitRequest, service: PairingServiceDep) -> ApiResponse:
    """Record an incoming pairing request from a scanning Android device.

    An already-paired device_identifier is accepted here, not rejected
    (P43) — see PairingService.submit_pairing_request's docstring.
    """
    attempt = service.submit_pairing_request(
        body.pairing_token, body.device_identifier, body.device_name, body.platform
    )
    return success({"status": attempt.status.value}, message="Pairing request submitted.")


@router.post("/approve", response_model=ApiResponse)
def approve_pairing(body: PairingApproveRequest, service: PairingServiceDep) -> ApiResponse:
    """Approve a pending pairing request.

    Registers a new device, or — if this device_identifier is already
    known — reconciles the existing one onto a fresh session (P43).
    """
    device = service.approve_pairing(body.pairing_token)
    return success(
        DeviceResponse.model_validate(device).model_dump(mode="json"),
        message="Device paired successfully.",
    )


@router.post("/reject", response_model=ApiResponse)
def reject_pairing(body: PairingRejectRequest, service: PairingServiceDep) -> ApiResponse:
    """Deny a pending pairing request."""
    service.reject_pairing(body.pairing_token)
    return success({"status": "rejected"}, message="Pairing request rejected.")


@router.get("/result/{token}", response_model=ApiResponse)
def get_pairing_result(token: str, service: PairingServiceDep) -> ApiResponse:
    """Collect the one-time result of a completed pairing attempt (credentials or rejection)."""
    result = service.collect_result(token)
    response = PairingResultResponse.model_validate(result)
    return success(response.model_dump(mode="json"))
