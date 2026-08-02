"""Tests for network helpers."""

from app.utils.network import get_broadcast_address


def test_get_broadcast_address_returns_limited_broadcast() -> None:
    assert get_broadcast_address() == "255.255.255.255"
