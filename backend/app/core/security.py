"""Cryptographic helpers for generating and hashing single-use secrets.

Shared by pairing tokens, device secrets, and (in a future milestone) session
tokens: all three are high-entropy, machine-generated values rather than
human-chosen passwords, so a fast cryptographic hash is the correct tool here
rather than a slow, password-oriented KDF such as bcrypt or argon2.
"""

import hashlib
import secrets


def generate_token(n_bytes: int = 32) -> str:
    """Generate a URL-safe, cryptographically secure random token."""
    return secrets.token_urlsafe(n_bytes)


def hash_token(token: str) -> str:
    """Hash a token for storage, so the plaintext value is never persisted."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
