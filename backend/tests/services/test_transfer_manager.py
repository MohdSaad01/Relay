"""Tests for TransferManager."""

from datetime import timedelta

from app.models.enums import TransferDirection
from app.services.transfer_manager import (
    PendingTransferRequest,
    TransferManager,
    TransferRequestStatus,
    generate_request_id,
)
from app.utils.time import utc_now


def _make_request(
    device_id: int = 1, request_id: str | None = None, ttl_seconds: int = 120
) -> PendingTransferRequest:
    now = utc_now()
    return PendingTransferRequest(
        request_id=request_id or generate_request_id(),
        device_id=device_id,
        device_name="Test Phone",
        direction=TransferDirection.RECEIVE,
        shared_file_id=None,
        file_name="photo.jpg",
        file_size=2048,
        status=TransferRequestStatus.PENDING,
        created_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
    )


def test_create_stores_request() -> None:
    manager = TransferManager()
    request = _make_request()

    manager.create(request)

    assert manager.get(request.request_id) is request


def test_create_supports_multiple_concurrent_requests() -> None:
    manager = TransferManager()
    first = _make_request(request_id="req-1")
    second = _make_request(request_id="req-2")

    manager.create(first)
    manager.create(second)

    assert manager.get("req-1") is first
    assert manager.get("req-2") is second


def test_get_returns_none_for_unknown_request() -> None:
    manager = TransferManager()

    assert manager.get("missing") is None


def test_get_returns_none_for_expired_request() -> None:
    manager = TransferManager()
    manager.create(_make_request(request_id="expired", ttl_seconds=-1))

    assert manager.get("expired") is None


def test_list_pending_returns_only_pending_requests() -> None:
    manager = TransferManager()
    manager.create(_make_request(request_id="pending"))
    manager.create(_make_request(request_id="decided"))
    manager.claim_for_decision("decided")

    assert [r.request_id for r in manager.list_pending()] == ["pending"]


def test_list_pending_scopes_to_device() -> None:
    manager = TransferManager()
    manager.create(_make_request(device_id=1, request_id="a"))
    manager.create(_make_request(device_id=2, request_id="b"))

    assert [r.request_id for r in manager.list_pending(device_id=1)] == ["a"]


def test_claim_for_decision_removes_request() -> None:
    manager = TransferManager()
    request = _make_request()
    manager.create(request)

    claimed = manager.claim_for_decision(request.request_id)

    assert claimed is not None
    assert manager.get(request.request_id) is None


def test_double_claim_for_decision_only_succeeds_once() -> None:
    """The atomic claim is what prevents a double-accept race from creating two Transfer rows."""
    manager = TransferManager()
    request = _make_request()
    manager.create(request)

    first_claim = manager.claim_for_decision(request.request_id)
    second_claim = manager.claim_for_decision(request.request_id)

    assert first_claim is not None
    assert second_claim is None


def test_store_decided_makes_request_collectible() -> None:
    manager = TransferManager()
    request = _make_request()
    manager.create(request)
    claimed = manager.claim_for_decision(request.request_id)
    assert claimed is not None
    claimed.status = TransferRequestStatus.ACCEPTED
    claimed.transfer_id = 42

    manager.store_decided(claimed)

    stored = manager.get(request.request_id)
    assert stored is not None
    assert stored.status is TransferRequestStatus.ACCEPTED
    assert stored.transfer_id == 42


def test_withdraw_removes_own_pending_request() -> None:
    manager = TransferManager()
    request = _make_request(device_id=1)
    manager.create(request)

    withdrawn = manager.withdraw(request.request_id, device_id=1)

    assert withdrawn is not None
    assert manager.get(request.request_id) is None


def test_withdraw_returns_none_when_not_owned() -> None:
    manager = TransferManager()
    request = _make_request(device_id=1)
    manager.create(request)

    assert manager.withdraw(request.request_id, device_id=2) is None
    assert manager.get(request.request_id) is not None


def test_withdraw_returns_none_when_already_decided() -> None:
    manager = TransferManager()
    request = _make_request(device_id=1)
    manager.create(request)
    manager.claim_for_decision(request.request_id)

    assert manager.withdraw(request.request_id, device_id=1) is None


def test_cleanup_expired_removes_expired_request() -> None:
    manager = TransferManager()
    manager.create(_make_request(request_id="expired", ttl_seconds=-1))

    assert manager.cleanup_expired() == 1


def test_cleanup_expired_returns_zero_when_nothing_expired() -> None:
    manager = TransferManager()
    manager.create(_make_request())

    assert manager.cleanup_expired() == 0
