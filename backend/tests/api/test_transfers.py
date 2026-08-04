"""Tests for the /transfers and /transfers/requests endpoints (Milestone 11)."""

from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.security import hash_token
from app.models.device_session import DeviceSession
from app.utils.time import utc_now
from tests.repositories.conftest import make_device


def _make_file(tmp_path: Path, name: str = "report.pdf", content: bytes = b"content") -> str:
    file_path = tmp_path / name
    file_path.write_bytes(content)
    return str(file_path)


def _share_file(desktop_client: TestClient, path: str) -> dict:
    response = desktop_client.post("/api/v1/files", json={"file_path": path})
    assert response.status_code in (200, 201)
    return response.json()["data"]


def _pair_device_with_token(client: TestClient, token: str = "valid-token") -> int:
    """Seed a paired device with a valid session token directly; pairing itself is
    exercised by tests/api/test_pairing.py, not here. Each call gets its own
    device_identifier (derived from the token) so a test can pair more than
    one device without hitting the devices.device_identifier UNIQUE constraint."""
    session = client.session_factory()  # type: ignore[attr-defined]
    device = make_device(identifier=f"device-{token}")
    session.add(device)
    session.flush()
    session.add(
        DeviceSession(
            device_id=device.id,
            token_hash=hash_token(token),
            expires_at=utc_now() + timedelta(minutes=30),
        )
    )
    session.commit()
    device_id = device.id
    session.close()
    return device_id


def _auth_headers(token: str = "valid-token") -> dict:
    return {"Authorization": f"Bearer {token}"}


def _request_upload(
    client: TestClient, token: str = "valid-token", file_name: str = "photo.jpg", file_size: int = 2048
) -> dict:
    response = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "receive", "file_name": file_name, "file_size": file_size},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201
    return response.json()["data"]


# --- POST /transfers/requests --------------------------------------------------


def test_request_download_creates_accepted_transfer(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    """A download is auto-accepted in the same call that proposes it -- no
    desktop approval step -- so the response already carries transfer_id."""
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client)

    response = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "send", "shared_file_id": shared_file["id"]},
        headers=_auth_headers(),
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["status"] == "accepted"
    assert data["file_name"] == "report.pdf"
    assert data["transfer_id"] is not None

    transfer = client.get(
        f"/api/v1/transfers/{data['transfer_id']}", headers=_auth_headers()
    ).json()["data"]
    assert transfer["status"] == "in_progress"


def test_request_upload_creates_accepted_transfer(client: TestClient) -> None:
    """An upload is now auto-accepted the same way a download is -- no
    desktop approval step -- so the response already carries transfer_id."""
    _pair_device_with_token(client)

    data = _request_upload(client)

    assert data["status"] == "accepted"
    assert data["file_name"] == "photo.jpg"
    assert data["shared_file_id"] is None
    assert data["transfer_id"] is not None

    transfer = client.get(
        f"/api/v1/transfers/{data['transfer_id']}", headers=_auth_headers()
    ).json()["data"]
    assert transfer["status"] == "in_progress"
    assert transfer["direction"] == "receive"


def test_request_transfer_without_token_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "receive", "file_name": "photo.jpg", "file_size": 2048},
    )

    assert response.status_code == 401


def test_request_download_for_unknown_shared_file_returns_404(client: TestClient) -> None:
    _pair_device_with_token(client)

    response = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "send", "shared_file_id": 999},
        headers=_auth_headers(),
    )

    assert response.status_code == 404


# --- GET /transfers/requests (dual audience) -----------------------------------


def test_list_requests_never_includes_auto_accepted_uploads(
    client: TestClient, desktop_client: TestClient
) -> None:
    """Every transfer request is auto-accepted now, so it's never observed
    sitting PENDING -- GET /transfers/requests is always empty."""
    _pair_device_with_token(client)
    _request_upload(client)

    response = desktop_client.get("/api/v1/transfers/requests")

    assert response.status_code == 200
    assert response.json()["data"] == []


def test_list_requests_as_android_returns_only_own(client: TestClient) -> None:
    _pair_device_with_token(client, "token-a")
    _pair_device_with_token(client, "token-b")
    _request_upload(client, "token-a")

    response = client.get("/api/v1/transfers/requests", headers=_auth_headers("token-a"))

    assert response.status_code == 200
    assert response.json()["data"] == []


# --- GET /transfers/requests/{id} -----------------------------------------------


def test_get_transfer_request_returns_the_auto_accepted_request(client: TestClient) -> None:
    _pair_device_with_token(client)
    created = _request_upload(client)

    response = client.get(
        f"/api/v1/transfers/requests/{created['request_id']}", headers=_auth_headers()
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "accepted"


def test_get_transfer_request_not_owned_returns_404(client: TestClient) -> None:
    _pair_device_with_token(client, "token-a")
    _pair_device_with_token(client, "token-b")
    created = _request_upload(client, "token-a")

    response = client.get(
        f"/api/v1/transfers/requests/{created['request_id']}", headers=_auth_headers("token-b")
    )

    assert response.status_code == 404


# --- GET /transfers, GET /transfers/{id} (dual audience) -----------------------


def test_list_transfers_as_desktop_returns_all(client: TestClient, desktop_client: TestClient) -> None:
    _pair_device_with_token(client)
    _request_upload(client)

    response = desktop_client.get("/api/v1/transfers")

    assert response.status_code == 200
    assert len(response.json()["data"]) == 1


def test_get_transfer_not_owned_returns_404(client: TestClient) -> None:
    _pair_device_with_token(client, "token-a")
    _pair_device_with_token(client, "token-b")
    created = _request_upload(client, "token-a")

    response = client.get(
        f"/api/v1/transfers/{created['transfer_id']}", headers=_auth_headers("token-b")
    )

    assert response.status_code == 404


# --- POST /transfers/{id}/cancel ------------------------------------------------


def test_cancel_transfer_marks_cancelled(client: TestClient, desktop_client: TestClient) -> None:
    _pair_device_with_token(client)
    created = _request_upload(client)

    response = desktop_client.post(f"/api/v1/transfers/{created['transfer_id']}/cancel")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "cancelled"


def test_cancel_already_cancelled_transfer_returns_409(
    client: TestClient, desktop_client: TestClient
) -> None:
    _pair_device_with_token(client)
    created = _request_upload(client)
    desktop_client.post(f"/api/v1/transfers/{created['transfer_id']}/cancel")

    response = desktop_client.post(f"/api/v1/transfers/{created['transfer_id']}/cancel")

    assert response.status_code == 409
