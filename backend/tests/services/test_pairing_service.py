"""Tests for PairingService."""

import pytest
from sqlalchemy.orm import Session

from app.models.enums import Platform
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.pairing_manager import PairingManager, PairingStatus
from app.services.pairing_service import PairingService


def _service(db_session: Session) -> PairingService:
    return PairingService(db_session, PairingManager())


def test_start_pairing_creates_pending_attempt(db_session: Session) -> None:
    service = _service(db_session)

    attempt = service.start_pairing()

    assert attempt.status is PairingStatus.PENDING
    assert attempt.token


def test_build_qr_payload_reflects_attempt_token(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()

    payload = service.build_qr_payload(attempt)

    assert payload.pairing_token == attempt.token
    assert payload.protocol_version >= 1
    assert payload.relay_version


def test_submit_pairing_request_transitions_attempt(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()

    updated = service.submit_pairing_request(
        attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID
    )

    assert updated.status is PairingStatus.AWAITING_APPROVAL


def test_submit_pairing_request_rejects_blank_name(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()

    with pytest.raises(ValidationError):
        service.submit_pairing_request(attempt.token, "device-uuid-1", "   ", Platform.ANDROID)


def test_submit_pairing_request_raises_for_unknown_token(db_session: Session) -> None:
    service = _service(db_session)

    with pytest.raises(NotFoundError):
        service.submit_pairing_request("missing", "device-uuid-1", "Test Phone", Platform.ANDROID)


def test_submit_pairing_request_raises_conflict_for_already_paired_device(
    db_session: Session,
) -> None:
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(
        first_attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID
    )
    service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    with pytest.raises(ConflictError):
        service.submit_pairing_request(
            second_attempt.token, "device-uuid-1", "Another Name", Platform.ANDROID
        )


def test_get_pending_request_returns_requesting_device(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()
    service.submit_pairing_request(attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID)

    pending = service.get_pending_request(attempt.token)

    assert pending.device_identifier == "device-uuid-1"


def test_get_pending_request_raises_when_not_submitted(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()

    with pytest.raises(NotFoundError):
        service.get_pending_request(attempt.token)


def test_approve_pairing_registers_device(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()
    service.submit_pairing_request(attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID)

    device = service.approve_pairing(attempt.token)

    assert device.device_identifier == "device-uuid-1"
    assert device.id is not None


def test_approve_pairing_raises_when_not_awaiting_approval(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()

    with pytest.raises(NotFoundError):
        service.approve_pairing(attempt.token)


def test_collect_result_returns_credentials_once(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()
    service.submit_pairing_request(attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID)
    device = service.approve_pairing(attempt.token)

    result = service.collect_result(attempt.token)

    assert result.device_id == device.id
    assert result.device_secret
    assert result.session_token

    with pytest.raises(NotFoundError):
        service.collect_result(attempt.token)


def test_reject_pairing_marks_attempt_rejected(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()
    service.submit_pairing_request(attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID)

    service.reject_pairing(attempt.token)

    with pytest.raises(ValidationError):
        service.collect_result(attempt.token)


def test_reject_pairing_raises_when_not_awaiting_approval(db_session: Session) -> None:
    service = _service(db_session)
    attempt = service.start_pairing()

    with pytest.raises(NotFoundError):
        service.reject_pairing(attempt.token)
