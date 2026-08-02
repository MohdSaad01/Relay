"""Tests for the /devices endpoints."""

from fastapi.testclient import TestClient

from tests.repositories.conftest import make_device


def _create_device(client: TestClient, identifier: str = "device-uuid-1", name: str = "Test Phone") -> int:
    """Seed a paired device directly; the pairing endpoint doesn't exist yet."""
    session = client.session_factory()  # type: ignore[attr-defined]
    device = make_device(identifier=identifier, name=name)
    session.add(device)
    session.commit()
    device_id = device.id
    session.close()
    return device_id


def test_list_devices_returns_every_paired_device(client: TestClient) -> None:
    _create_device(client, identifier="device-1", name="Phone 1")
    _create_device(client, identifier="device-2", name="Phone 2")

    response = client.get("/api/v1/devices")

    assert response.status_code == 200
    body = response.json()
    assert {d["device_identifier"] for d in body["data"]} == {"device-1", "device-2"}


def test_list_devices_excludes_secret_hash(client: TestClient) -> None:
    _create_device(client)

    response = client.get("/api/v1/devices")

    assert "device_secret_hash" not in response.json()["data"][0]


def test_get_device_returns_matching_device(client: TestClient) -> None:
    device_id = _create_device(client)

    response = client.get(f"/api/v1/devices/{device_id}")

    assert response.status_code == 200
    assert response.json()["data"]["id"] == device_id


def test_get_device_returns_404_when_missing(client: TestClient) -> None:
    response = client.get("/api/v1/devices/999")

    assert response.status_code == 404
    assert response.json()["success"] is False


def test_patch_device_renames_it(client: TestClient) -> None:
    device_id = _create_device(client)

    response = client.patch(f"/api/v1/devices/{device_id}", json={"device_name": "New Name"})

    assert response.status_code == 200
    assert response.json()["data"]["device_name"] == "New Name"


def test_patch_device_rejects_blank_name(client: TestClient) -> None:
    device_id = _create_device(client)

    response = client.patch(f"/api/v1/devices/{device_id}", json={"device_name": "   "})

    assert response.status_code == 400


def test_patch_device_returns_404_when_missing(client: TestClient) -> None:
    response = client.patch("/api/v1/devices/999", json={"device_name": "New Name"})

    assert response.status_code == 404


def test_delete_device_returns_204_with_empty_body(client: TestClient) -> None:
    device_id = _create_device(client)

    response = client.delete(f"/api/v1/devices/{device_id}")

    assert response.status_code == 204
    assert response.content == b""


def test_delete_device_returns_404_when_missing(client: TestClient) -> None:
    response = client.delete("/api/v1/devices/999")

    assert response.status_code == 404
