"""Tests for PairingManager."""

from datetime import timedelta

from app.models.enums import Platform
from app.services.pairing_manager import (
    PairingAttempt,
    PairingManager,
    PairingStatus,
    RequestingDeviceInfo,
)
from app.utils.time import utc_now


def _make_attempt(token: str = "token-1", ttl_seconds: int = 300) -> PairingAttempt:
    now = utc_now()
    return PairingAttempt(
        token=token,
        status=PairingStatus.PENDING,
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
    )


def _make_requesting_device(identifier: str = "device-uuid-1") -> RequestingDeviceInfo:
    return RequestingDeviceInfo(
        device_identifier=identifier, device_name="Test Phone", platform=Platform.ANDROID
    )


def test_start_stores_new_attempt() -> None:
    manager = PairingManager()
    attempt = _make_attempt()

    manager.start(attempt)

    assert manager.get(attempt.token) is attempt


def test_start_discards_previous_pending_attempt() -> None:
    manager = PairingManager()
    manager.start(_make_attempt(token="first"))

    second = _make_attempt(token="second")
    manager.start(second)

    assert manager.get("first") is None
    assert manager.get("second") is second


def test_start_discards_previous_awaiting_approval_attempt() -> None:
    manager = PairingManager()
    first = _make_attempt(token="first")
    manager.start(first)
    manager.submit_request(first.token, _make_requesting_device())

    manager.start(_make_attempt(token="second"))

    assert manager.get("first") is None


def test_start_preserves_uncollected_approved_attempt() -> None:
    """A device/session already committed to the database on approval must stay
    collectible even if the desktop starts a new pairing attempt before Android
    calls collect_result() -- otherwise the device is stranded: registered, but
    with credentials nobody can retrieve, and re-pairing blocked by the
    already-registered check in PairingService.submit_pairing_request.
    """
    manager = PairingManager()
    first = _make_attempt(token="first")
    manager.start(first)
    manager.submit_request(first.token, _make_requesting_device())
    claimed = manager.claim_for_approval(first.token)
    assert claimed is not None
    claimed.status = PairingStatus.APPROVED
    manager.store_approved(claimed)

    manager.start(_make_attempt(token="second"))

    assert manager.get("first") is claimed
    collected = manager.collect_result("first")
    assert collected is claimed


def test_start_preserves_uncollected_rejected_attempt() -> None:
    manager = PairingManager()
    first = _make_attempt(token="first")
    manager.start(first)
    manager.submit_request(first.token, _make_requesting_device())
    rejected = manager.reject(first.token)
    assert rejected is not None

    manager.start(_make_attempt(token="second"))

    assert manager.get("first") is rejected


def test_get_returns_none_for_unknown_token() -> None:
    manager = PairingManager()

    assert manager.get("missing") is None


def test_get_returns_none_for_expired_attempt() -> None:
    manager = PairingManager()
    manager.start(_make_attempt(token="expired", ttl_seconds=-1))

    assert manager.get("expired") is None


def test_submit_request_transitions_to_awaiting_approval() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)

    updated = manager.submit_request(attempt.token, _make_requesting_device())

    assert updated is not None
    assert updated.status is PairingStatus.AWAITING_APPROVAL
    assert updated.requesting_device is not None
    assert updated.requesting_device.device_identifier == "device-uuid-1"


def test_submit_request_returns_none_when_not_pending() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)
    manager.submit_request(attempt.token, _make_requesting_device())

    result = manager.submit_request(attempt.token, _make_requesting_device())

    assert result is None


def test_submit_request_returns_none_for_unknown_token() -> None:
    manager = PairingManager()

    assert manager.submit_request("missing", _make_requesting_device()) is None


def test_claim_for_approval_removes_attempt() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)
    manager.submit_request(attempt.token, _make_requesting_device())

    claimed = manager.claim_for_approval(attempt.token)

    assert claimed is not None
    assert manager.get(attempt.token) is None


def test_claim_for_approval_returns_none_when_still_pending() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)

    assert manager.claim_for_approval(attempt.token) is None


def test_double_claim_for_approval_only_succeeds_once() -> None:
    """The atomic claim is what prevents a double-approve race from registering a device twice."""
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)
    manager.submit_request(attempt.token, _make_requesting_device())

    first_claim = manager.claim_for_approval(attempt.token)
    second_claim = manager.claim_for_approval(attempt.token)

    assert first_claim is not None
    assert second_claim is None


def test_store_approved_makes_attempt_collectible() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)
    manager.submit_request(attempt.token, _make_requesting_device())
    claimed = manager.claim_for_approval(attempt.token)
    assert claimed is not None
    claimed.status = PairingStatus.APPROVED

    manager.store_approved(claimed)

    assert manager.get(attempt.token) is claimed


def test_reject_transitions_to_rejected() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)
    manager.submit_request(attempt.token, _make_requesting_device())

    rejected = manager.reject(attempt.token)

    assert rejected is not None
    assert rejected.status is PairingStatus.REJECTED


def test_reject_returns_none_when_not_awaiting_approval() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)

    assert manager.reject(attempt.token) is None


def test_collect_result_pops_terminal_attempt() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)
    manager.submit_request(attempt.token, _make_requesting_device())
    rejected = manager.reject(attempt.token)
    assert rejected is not None

    collected = manager.collect_result(attempt.token)

    assert collected is rejected
    assert manager.get(attempt.token) is None


def test_collect_result_returns_none_while_still_pending() -> None:
    manager = PairingManager()
    attempt = _make_attempt()
    manager.start(attempt)

    assert manager.collect_result(attempt.token) is None


def test_cleanup_expired_removes_expired_attempt() -> None:
    manager = PairingManager()
    manager.start(_make_attempt(token="expired", ttl_seconds=-1))

    assert manager.cleanup_expired() == 1


def test_cleanup_expired_returns_zero_when_nothing_expired() -> None:
    manager = PairingManager()
    manager.start(_make_attempt())

    assert manager.cleanup_expired() == 0
