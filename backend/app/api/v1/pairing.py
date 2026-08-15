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
    NameConflictResponse,
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
    """Return the requesting device's info for the desktop user to review,
    plus a live P43.1 name-collision check (see PairingService.get_pending_request)."""
    review = service.get_pending_request(token)
    response = PairingPendingRequestResponse(
        device_identifier=review.requesting_device.device_identifier,
        device_name=review.requesting_device.device_name,
        platform=review.requesting_device.platform,
        name_conflict=(
            NameConflictResponse(
                existing_device_id=review.name_conflict.existing_device_id,
                existing_device_name=review.name_conflict.existing_device_name,
            )
            if review.name_conflict is not None
            else None
        ),
    )
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

    Registers a new device; reconciles the existing one onto a fresh session
    if this device_identifier is already known (P43); or, for a genuinely new
    identifier whose name collides with an already-paired device, applies
    `name_conflict_action` ("replace"/"make_new", P43.1) — raising a 409
    NameConflictError instead if no decision was supplied yet.
    """
    device = service.approve_pairing(body.pairing_token, body.name_conflict_action)
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
