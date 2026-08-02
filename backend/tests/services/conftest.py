"""Shared fixtures for service-layer tests. Reuses the repository-layer fixtures."""

from tests.repositories.conftest import db_session, make_device  # noqa: F401
