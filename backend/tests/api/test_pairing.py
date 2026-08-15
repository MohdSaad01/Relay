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


def test_submit_request_reconciles_already_paired_device_instead_of_conflicting(
    client: TestClient,
) -> None:
    """P43: re-pairing with a known device_identifier is not a 409 — it's
    reconciled onto the same Device row (docs/15_QA_NOTEBOOK.md's P43 entry)."""
    first_token = _start(client)
    _submit(client, first_token)
    approve_response = client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})
    first_device_id = approve_response.json()["data"]["id"]

    second_token = _start(client)
    request_response = client.post(
        "/api/v1/pairing/request",
        json={
            "pairing_token": second_token,
            "device_identifier": "device-uuid-1",
            "device_name": "Another Name",
            "platform": "android",
        },
    )
    assert request_response.status_code == 200

    approve_response = client.post("/api/v1/pairing/approve", json={"pairing_token": second_token})
    assert approve_response.status_code == 200
    assert approve_response.json()["data"]["id"] == first_device_id

    devices_response = client.get("/api/v1/devices")
    assert len(devices_response.json()["data"]) == 1


# --- P43.1: device name collision & re-pairing resolution -------------------


def test_pending_reports_name_conflict_for_new_identifier_same_name(client: TestClient) -> None:
    first_token = _start(client)
    _submit(client, first_token, identifier="device-uuid-1", name="Thomas")
    approve_response = client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})
    existing_device_id = approve_response.json()["data"]["id"]

    second_token = _start(client)
    _submit(client, second_token, identifier="device-uuid-2", name="Thomas")

    pending_response = client.get(f"/api/v1/pairing/pending/{second_token}")
    conflict = pending_response.json()["data"]["name_conflict"]

    assert conflict is not None
    assert conflict["existing_device_id"] == existing_device_id
    assert conflict["existing_device_name"] == "Thomas"


def test_approve_without_decision_returns_409_and_creates_no_device(client: TestClient) -> None:
    first_token = _start(client)
    _submit(client, first_token, identifier="device-uuid-1", name="Thomas")
    client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})

    second_token = _start(client)
    _submit(client, second_token, identifier="device-uuid-2", name="Thomas")

    response = client.post("/api/v1/pairing/approve", json={"pairing_token": second_token})

    assert response.status_code == 409
    assert response.json()["data"]["existing_device_name"] == "Thomas"
    assert len(client.get("/api/v1/devices").json()["data"]) == 1


def test_approve_replace_leaves_exactly_one_device_with_the_new_identity(client: TestClient) -> None:
    first_token = _start(client)
    _submit(client, first_token, identifier="device-uuid-1", name="Thomas")
    client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})

    second_token = _start(client)
    _submit(client, second_token, identifier="device-uuid-2", name="Thomas")
    response = client.post(
        "/api/v1/pairing/approve",
        json={"pairing_token": second_token, "name_conflict_action": "replace"},
    )

    assert response.status_code == 200
    devices = client.get("/api/v1/devices").json()["data"]
    assert len(devices) == 1
    assert devices[0]["device_identifier"] == "device-uuid-2"
    assert devices[0]["device_name"] == "Thomas"


def test_approve_make_new_produces_two_devices_with_distinct_names(client: TestClient) -> None:
    first_token = _start(client)
    _submit(client, first_token, identifier="device-uuid-1", name="Thomas")
    client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})

    second_token = _start(client)
    _submit(client, second_token, identifier="device-uuid-2", name="Thomas")
    response = client.post(
        "/api/v1/pairing/approve",
        json={"pairing_token": second_token, "name_conflict_action": "make_new"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["device_name"] == "Thomas (1)"
    devices = client.get("/api/v1/devices").json()["data"]
    assert {d["device_name"] for d in devices} == {"Thomas", "Thomas (1)"}


def test_pairing_result_returns_the_final_assigned_device_name(client: TestClient) -> None:
    first_token = _start(client)
    _submit(client, first_token, identifier="device-uuid-1", name="Thomas")
    client.post("/api/v1/pairing/approve", json={"pairing_token": first_token})

    second_token = _start(client)
    _submit(client, second_token, identifier="device-uuid-2", name="Thomas")
    client.post(
        "/api/v1/pairing/approve",
        json={"pairing_token": second_token, "name_conflict_action": "make_new"},
    )

    result_response = client.get(f"/api/v1/pairing/result/{second_token}")

    assert result_response.json()["data"]["device_name"] == "Thomas (1)"
