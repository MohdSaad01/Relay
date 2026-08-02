"""Tests for the discovery status endpoint."""

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import app

client = TestClient(app)


def test_get_discovery_status_returns_success() -> None:
    response = client.get("/api/v1/discovery/status")

    assert response.status_code == 200

    body = response.json()
    assert body["success"] is True
    assert "broadcasting" in body["data"]
    assert "instance_id" in body["data"]
    assert body["data"]["port"] == get_settings().DISCOVERY_PORT
