"""Tests for PairingService."""

import pytest
from sqlalchemy.orm import Session

from app.core.security import hash_token
from app.models.enums import Platform
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.services.exceptions import NotFoundError, ValidationError
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


def test_submit_pairing_request_allows_already_paired_device_to_re_pair(
    db_session: Session,
) -> None:
    """P43: a known device_identifier re-pairing is not rejected at submit time —
    it's a legitimate re-pair, reconciled at approve_pairing (see tests below)."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(
        first_attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID
    )
    service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    updated = service.submit_pairing_request(
        second_attempt.token, "device-uuid-1", "Another Name", Platform.ANDROID
    )

    assert updated.status is PairingStatus.AWAITING_APPROVAL


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


# --- P43: re-pairing reconciliation ---------------------------------------


def test_approve_pairing_reconciles_known_identifier_instead_of_duplicating(
    db_session: Session,
) -> None:
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(
        first_attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID
    )
    first_device = service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(
        second_attempt.token, "device-uuid-1", "Test Phone (re-pair default name)", Platform.ANDROID
    )
    second_device = service.approve_pairing(second_attempt.token)

    assert second_device.id == first_device.id
    assert DeviceRepository(db_session).list_all() == [second_device]


def test_approve_pairing_reconciliation_preserves_existing_device_name(
    db_session: Session,
) -> None:
    """A rename made after first pairing must survive a later re-pair (P43) —
    the fresh pairing attempt's device_name (Android's raw default) must
    not silently overwrite a customized name."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(
        first_attempt.token, "device-uuid-1", "RMX3997", Platform.ANDROID
    )
    device = service.approve_pairing(first_attempt.token)
    device.device_name = "Thomas"
    db_session.commit()

    second_attempt = service.start_pairing()
    service.submit_pairing_request(
        second_attempt.token, "device-uuid-1", "RMX3997", Platform.ANDROID
    )
    reconciled = service.approve_pairing(second_attempt.token)

    assert reconciled.device_name == "Thomas"


def test_approve_pairing_reconciliation_invalidates_old_session(db_session: Session) -> None:
    service = _service(db_session)
    session_repo = DeviceSessionRepository(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(
        first_attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID
    )
    service.approve_pairing(first_attempt.token)
    first_result = service.collect_result(first_attempt.token)
    assert session_repo.get_by_token_hash(hash_token(first_result.session_token)) is not None

    second_attempt = service.start_pairing()
    service.submit_pairing_request(
        second_attempt.token, "device-uuid-1", "Test Phone", Platform.ANDROID
    )
    service.approve_pairing(second_attempt.token)
    second_result = service.collect_result(second_attempt.token)

    # The old session token no longer authenticates at all — its row is gone.
    assert session_repo.get_by_token_hash(hash_token(first_result.session_token)) is None
    # The new one does.
    assert session_repo.get_by_token_hash(hash_token(second_result.session_token)) is not None
    assert first_result.session_token != second_result.session_token


def test_approve_pairing_creates_new_device_for_unknown_identifier(db_session: Session) -> None:
    """Two genuinely different identifiers (e.g. two physical phones, or one
    phone reinstalled — P43) legitimately produce two separate devices."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(
        first_attempt.token, "device-uuid-1", "Phone A", Platform.ANDROID
    )
    first_device = service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(
        second_attempt.token, "device-uuid-2", "Phone B", Platform.ANDROID
    )
    second_device = service.approve_pairing(second_attempt.token)

    assert first_device.id != second_device.id
    assert len(DeviceRepository(db_session).list_all()) == 2
