"""Tests for the /pairing endpoints."""

from fastapi.testclient import TestClient


def _start(client: TestClient) -> str:
    response = client.post("/api/v1/pairing/start")
    assert response.status_code == 201
    return response.json()["data"]["qr"]["pairing_token"]


def _submit(
    client: TestClient,
    token: str,
    identifier: str = "device-uuid-1",
    name: str = "Test Phone",
) -> None:
    response = client.post(
        "/api/v1/pairing/request",
        json={
            "pairing_token": token,
            "device_identifier": identifier,
            "device_name": name,
            "platform": "android",
        },
    )
    assert response.status_code == 200


def test_start_pairing_returns_qr_payload(client: TestClient) -> None:
    response = client.post("/api/v1/pairing/start")

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["qr"]["pairing_token"]
    assert data["qr"]["protocol_version"] >= 1
    assert data["expires_at"]


def test_get_pending_returns_404_before_request_submitted(client: TestClient) -> None:
    token = _start(client)

    response = client.get(f"/api/v1/pairing/pending/{token}")

    assert response.status_code == 404


def test_submit_request_then_pending_returns_device_info(client: TestClient) -> None:
    token = _start(client)
    _submit(client, token)

    response = client.get(f"/api/v1/pairing/pending/{token}")

    assert response.status_code == 200
    assert response.json()["data"]["device_identifier"] == "device-uuid-1"


def test_submit_request_rejects_blank_name(client: TestClient) -> None:
    token = _start(client)

    response = client.post(
        "/api/v1/pairing/request",
        json={
            "pairing_token": token,
            "device_identifier": "device-uuid-1",
            "device_name": "   ",
            "platform": "android",
        },
    )

    assert response.status_code == 400


def test_submit_request_returns_404_for_unknown_token(client: TestClient) -> None:
    response = client.post(
        "/api/v1/pairing/request",
        json={
            "pairing_token": "unknown-token",
            "device_identifier": "device-uuid-1",
            "device_name": "Test Phone",
            "platform": "android",
        },
    )

    assert response.status_code == 404


def test_approve_pairing_registers_device_and_result_returns_credentials(client: TestClient) -> None:
    token = _start(client)
    _submit(client, token)

    approve_response = client.post("/api/v1/pairing/approve", json={"pairing_token": token})
    assert approve_response.status_code == 200
    assert approve_response.json()["data"]["device_identifier"] == "device-uuid-1"

    result_response = client.get(f"/api/v1/pairing/result/{token}")
    assert result_response.status_code == 200
    result_data = result_response.json()["data"]
    assert result_data["device_secret"]
    assert result_data["session_token"]


def test_collect_result_returns_404_when_already_collected(client: TestClient) -> None:
    token = _start(client)
    _submit(client, token)
    client.post("/api/v1/pairing/approve", json={"pairing_token": token})
    client.get(f"/api/v1/pairing/result/{token}")

    response = client.get(f"/api/v1/pairing/result/{token}")

    assert response.status_code == 404


def test_reject_pairing_then_result_returns_400(client: TestClient) -> None:
    token = _start(client)
    _submit(client, token)

    reject_response = client.post("/api/v1/pairing/reject", json={"pairing_token": token})
    assert reject_response.status_code == 200

    result_response = client.get(f"/api/v1/pairing/result/{token}")
    assert result_response.status_code == 400


def test_approved_result_still_collectible_after_new_pairing_started(client: TestClient) -> None:
    """A new pairing attempt must not strand a just-approved device.

    Regression for a T5 integration defect: PairingManager.start() used to
    unconditionally discard the previous attempt, including one already
    APPROVED (and therefore already registered in the database) but not yet
    collected by Android. If the desktop user started a new pairing attempt
    in that window, the original device's one-time credentials were lost
    forever -- Android got a 404 indistinguishable from "still pending", and
    re-pairing the same device_identifier was permanently blocked by the
    already-registered check below.
    """
    first_token = _start(client)
    _submit(client, first_token)
    client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})

    _start(client)

    result_response = client.get(f"/api/v1/pairing/result/{first_token}")
    assert result_response.status_code == 200
    result_data = result_response.json()["data"]
    assert result_data["device_secret"]
    assert result_data["session_token"]


def test_submit_request_conflicts_for_already_paired_device(client: TestClient) -> None:
    first_token = _start(client)
    _submit(client, first_token)
    client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})

    second_token = _start(client)
    response = client.post(
        "/api/v1/pairing/request",
        json={
            "pairing_token": second_token,
            "device_identifier": "device-uuid-1",
            "device_name": "Another Name",
            "platform": "android",
        },
    )

    assert response.status_code == 409
