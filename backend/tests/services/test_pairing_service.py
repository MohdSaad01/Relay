"""Tests for PairingService."""

import pytest
from sqlalchemy.orm import Session

from app.core.security import hash_token
from app.models.enums import Platform
from app.repositories.device_repository import DeviceRepository
from app.repositories.device_session_repository import DeviceSessionRepository
from app.services.exceptions import NameConflictError, NotFoundError, ValidationError
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

    assert pending.requesting_device.device_identifier == "device-uuid-1"
    assert pending.name_conflict is None


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


# --- P43.1: device name collision & re-pairing resolution -------------------


def test_approve_pairing_reconciles_when_identifier_matches_even_if_name_differs(
    db_session: Session,
) -> None:
    """Case D (P43.1 §23): same device_identifier, different device_name —
    identifier takes precedence, this is still a P43 reconciliation, never a
    name-collision dialog, and the customized name is preserved."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    device = service.approve_pairing(first_attempt.token)
    device.device_name = "Thomas"
    db_session.commit()

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-1", "Sarah", Platform.ANDROID)
    reconciled = service.approve_pairing(second_attempt.token)

    assert reconciled.id == device.id
    assert reconciled.device_name == "Thomas"
    assert len(DeviceRepository(db_session).list_all()) == 1


def test_get_pending_request_reports_no_conflict_when_identifier_already_matches(
    db_session: Session,
) -> None:
    """Case A: same identifier, same name — a P43 re-pair, never flagged as a
    P43.1 name collision even though the name also matches."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    pending = service.get_pending_request(second_attempt.token)

    assert pending.name_conflict is None


def test_get_pending_request_reports_conflict_for_new_identifier_same_name(
    db_session: Session,
) -> None:
    """Case B: a genuinely new identifier whose name collides with an
    already-paired device — the live check must flag it."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    existing_device = service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-2", "Thomas", Platform.ANDROID)
    pending = service.get_pending_request(second_attempt.token)

    assert pending.name_conflict is not None
    assert pending.name_conflict.existing_device_id == existing_device.id
    assert pending.name_conflict.existing_device_name == "Thomas"


def test_approve_pairing_raises_name_conflict_without_a_decision(db_session: Session) -> None:
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    existing_device = service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-2", "Thomas", Platform.ANDROID)

    with pytest.raises(NameConflictError) as excinfo:
        service.approve_pairing(second_attempt.token)

    assert excinfo.value.existing_device_id == existing_device.id
    assert excinfo.value.existing_device_name == "Thomas"
    # No duplicate/orphan device was created while the decision was pending.
    assert len(DeviceRepository(db_session).list_all()) == 1


def test_approve_pairing_name_conflict_does_not_strand_the_attempt(db_session: Session) -> None:
    """The pairing attempt must survive an aborted (no-decision) approve
    call, so a subsequent approve with a decision still succeeds."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-2", "Thomas", Platform.ANDROID)
    with pytest.raises(NameConflictError):
        service.approve_pairing(second_attempt.token)

    new_device = service.approve_pairing(second_attempt.token, "make_new")

    assert new_device.device_name == "Thomas (1)"


def test_approve_pairing_replace_produces_exactly_one_device_with_new_identity(
    db_session: Session,
) -> None:
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-2", "Thomas", Platform.ANDROID)
    new_device = service.approve_pairing(second_attempt.token, "replace")

    devices = DeviceRepository(db_session).list_all()
    assert len(devices) == 1
    assert devices[0].id == new_device.id
    assert devices[0].device_identifier == "device-uuid-2"
    assert devices[0].device_name == "Thomas"
    # id equality isn't asserted: SQLite reuses a freed integer PK once the
    # table is empty (P17, documented in CLAUDE.md) — expected, not a defect.
    # The old identity is simply gone rather than duplicated.
    assert service.device_service.get_by_identifier_or_none("device-uuid-1") is None


def test_approve_pairing_replace_invalidates_old_devices_session(db_session: Session) -> None:
    service = _service(db_session)
    session_repo = DeviceSessionRepository(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    service.approve_pairing(first_attempt.token)
    old_result = service.collect_result(first_attempt.token)
    assert session_repo.get_by_token_hash(hash_token(old_result.session_token)) is not None

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-2", "Thomas", Platform.ANDROID)
    service.approve_pairing(second_attempt.token, "replace")
    new_result = service.collect_result(second_attempt.token)

    assert session_repo.get_by_token_hash(hash_token(old_result.session_token)) is None
    assert session_repo.get_by_token_hash(hash_token(new_result.session_token)) is not None


def test_approve_pairing_make_new_preserves_old_device_and_assigns_suffix(
    db_session: Session,
) -> None:
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    old_device = service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-2", "Thomas", Platform.ANDROID)
    new_device = service.approve_pairing(second_attempt.token, "make_new")

    devices = {d.id: d.device_name for d in DeviceRepository(db_session).list_all()}
    assert devices == {old_device.id: "Thomas", new_device.id: "Thomas (1)"}


def test_approve_pairing_make_new_uses_smallest_available_suffix(db_session: Session) -> None:
    """Thomas + Thomas (1) already paired -> the next make_new pairing gets
    Thomas (2), and repeating the flow again continues to fill gaps."""
    service = _service(db_session)

    attempt_1 = service.start_pairing()
    service.submit_pairing_request(attempt_1.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    service.approve_pairing(attempt_1.token)

    attempt_2 = service.start_pairing()
    service.submit_pairing_request(attempt_2.token, "device-uuid-2", "Thomas", Platform.ANDROID)
    device_2 = service.approve_pairing(attempt_2.token, "make_new")
    assert device_2.device_name == "Thomas (1)"

    attempt_3 = service.start_pairing()
    service.submit_pairing_request(attempt_3.token, "device-uuid-3", "Thomas", Platform.ANDROID)
    device_3 = service.approve_pairing(attempt_3.token, "make_new")
    assert device_3.device_name == "Thomas (2)"


def test_approve_pairing_result_device_name_reflects_the_final_assigned_name(
    db_session: Session,
) -> None:
    """Android must learn the backend-assigned name (P43.1 §20/§24), not the
    name it originally submitted — collect_result's device_name is what
    Android's session ends up storing."""
    service = _service(db_session)
    first_attempt = service.start_pairing()
    service.submit_pairing_request(first_attempt.token, "device-uuid-1", "Thomas", Platform.ANDROID)
    service.approve_pairing(first_attempt.token)

    second_attempt = service.start_pairing()
    service.submit_pairing_request(second_attempt.token, "device-uuid-2", "Thomas", Platform.ANDROID)
    service.approve_pairing(second_attempt.token, "make_new")
    result = service.collect_result(second_attempt.token)

    assert result.device_name == "Thomas (1)"
