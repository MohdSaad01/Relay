"""Tests for core security helpers."""

from app.core.security import generate_token, hash_token


def test_generate_token_is_url_safe_and_sufficiently_long() -> None:
    token = generate_token()

    assert len(token) >= 32
    assert all(c.isalnum() or c in "-_" for c in token)


def test_generate_token_produces_unique_values() -> None:
    tokens = {generate_token() for _ in range(100)}

    assert len(tokens) == 100


def test_hash_token_is_deterministic() -> None:
    token = "same-value"

    assert hash_token(token) == hash_token(token)


def test_hash_token_differs_for_different_input() -> None:
    assert hash_token("a") != hash_token("b")


def test_hash_token_never_equals_plaintext() -> None:
    token = "plaintext-token"

    assert hash_token(token) != token
