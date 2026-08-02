"""Tests for the /settings endpoints."""

from fastapi.testclient import TestClient


def test_get_settings_returns_defaults_on_first_run(client: TestClient) -> None:
    response = client.get("/api/v1/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["discovery_enabled"] is True


def test_patch_settings_updates_provided_fields(client: TestClient) -> None:
    response = client.patch("/api/v1/settings", json={"device_display_name": "Living Room PC"})

    assert response.status_code == 200
    body = response.json()
    assert body["data"]["device_display_name"] == "Living Room PC"


def test_patch_settings_leaves_unprovided_fields_unchanged(client: TestClient) -> None:
    client.patch("/api/v1/settings", json={"device_display_name": "Living Room PC"})

    response = client.patch("/api/v1/settings", json={"discovery_enabled": False})

    body = response.json()
    assert body["data"]["device_display_name"] == "Living Room PC"
    assert body["data"]["discovery_enabled"] is False


def test_patch_settings_rejects_blank_display_name(client: TestClient) -> None:
    response = client.patch("/api/v1/settings", json={"device_display_name": "   "})

    assert response.status_code == 400
    assert response.json()["success"] is False


def test_patch_settings_rejects_non_positive_lifetime(client: TestClient) -> None:
    response = client.patch("/api/v1/settings", json={"session_token_lifetime_minutes": 0})

    assert response.status_code == 400


def test_patch_settings_rejects_wrong_type(client: TestClient) -> None:
    response = client.patch("/api/v1/settings", json={"discovery_enabled": "not-a-bool"})

    assert response.status_code == 422
    assert response.json()["success"] is False
