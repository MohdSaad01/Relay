"""Tests for the /transfers/{id}/download and /transfers/{id}/upload endpoints
(Milestone 12: Streaming Engine)."""

from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.security import hash_token
from app.models.device_session import DeviceSession
from app.utils.time import utc_now
from tests.repositories.conftest import make_device


def _make_file(tmp_path: Path, name: str = "report.pdf", content: bytes = b"file-content") -> str:
    file_path = tmp_path / name
    file_path.write_bytes(content)
    return str(file_path)


def _share_file(desktop_client: TestClient, path: str) -> dict:
    response = desktop_client.post("/api/v1/files", json={"file_path": path})
    assert response.status_code in (200, 201)
    return response.json()["data"]


def _pair_device_with_token(client: TestClient, token: str = "valid-token") -> int:
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


def _set_download_directory(desktop_client: TestClient, directory: Path) -> None:
    response = desktop_client.patch("/api/v1/settings", json={"download_directory": str(directory)})
    assert response.status_code == 200


def _accept_download(client: TestClient, desktop_client: TestClient, shared_file_id: int, token: str) -> dict:
    created = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "send", "shared_file_id": shared_file_id},
        headers=_auth_headers(token),
    ).json()["data"]
    response = desktop_client.post(f"/api/v1/transfers/requests/{created['request_id']}/accept")
    assert response.status_code == 201
    return response.json()["data"]


def _accept_upload(
    client: TestClient,
    desktop_client: TestClient,
    token: str,
    file_name: str = "photo.jpg",
    file_size: int = 12,
) -> dict:
    created = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "receive", "file_name": file_name, "file_size": file_size},
        headers=_auth_headers(token),
    ).json()["data"]
    response = desktop_client.post(f"/api/v1/transfers/requests/{created['request_id']}/accept")
    assert response.status_code == 201
    return response.json()["data"]


# --- GET /transfers/{id}/download ------------------------------------------------


def test_download_transfer_streams_file_bytes(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path, content=b"file-content"))
    _pair_device_with_token(client)
    transfer = _accept_download(client, desktop_client, shared_file["id"], "valid-token")

    response = client.get(
        f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers()
    )

    assert response.status_code == 200
    assert response.content == b"file-content"
    assert response.headers["content-length"] == "12"
    assert 'filename="report.pdf"' in response.headers["content-disposition"]

    poll = desktop_client.get(f"/api/v1/transfers/{transfer['id']}")
    data = poll.json()["data"]
    assert data["status"] == "completed"
    assert data["bytes_transferred"] == 12


def test_download_transfer_without_token_is_rejected(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client)
    transfer = _accept_download(client, desktop_client, shared_file["id"], "valid-token")

    response = client.get(f"/api/v1/transfers/{transfer['id']}/download")

    assert response.status_code == 401


def test_download_transfer_not_owned_returns_404(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client, "token-a")
    _pair_device_with_token(client, "token-b")
    transfer = _accept_download(client, desktop_client, shared_file["id"], "token-a")

    response = client.get(
        f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers("token-b")
    )

    assert response.status_code == 404


def test_download_transfer_wrong_direction_returns_409(
    client: TestClient, desktop_client: TestClient
) -> None:
    _pair_device_with_token(client)
    transfer = _accept_upload(client, desktop_client, "valid-token")

    response = client.get(
        f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers()
    )

    assert response.status_code == 409


def test_download_transfer_not_in_progress_returns_409(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client)
    transfer = _accept_download(client, desktop_client, shared_file["id"], "valid-token")
    desktop_client.post(f"/api/v1/transfers/{transfer['id']}/cancel")

    response = client.get(
        f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers()
    )

    assert response.status_code == 409


def test_download_transfer_missing_source_file_returns_400(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    file_path = _make_file(tmp_path)
    shared_file = _share_file(desktop_client, file_path)
    _pair_device_with_token(client)
    transfer = _accept_download(client, desktop_client, shared_file["id"], "valid-token")
    Path(file_path).unlink()

    response = client.get(
        f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers()
    )

    assert response.status_code == 400


# --- POST /transfers/{id}/upload --------------------------------------------------


def test_upload_transfer_writes_file_and_returns_completed(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    _set_download_directory(desktop_client, tmp_path)
    _pair_device_with_token(client)
    transfer = _accept_upload(client, desktop_client, "valid-token", file_name="photo.jpg", file_size=12)

    response = client.post(
        f"/api/v1/transfers/{transfer['id']}/upload",
        content=b"file-content",
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "completed"
    assert data["bytes_transferred"] == 12
    assert (tmp_path / "photo.jpg").read_bytes() == b"file-content"


def test_upload_transfer_renames_on_conflict(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    _set_download_directory(desktop_client, tmp_path)
    (tmp_path / "photo.jpg").write_bytes(b"existing file")
    _pair_device_with_token(client)
    transfer = _accept_upload(client, desktop_client, "valid-token", file_name="photo.jpg", file_size=12)

    response = client.post(
        f"/api/v1/transfers/{transfer['id']}/upload",
        content=b"file-content",
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["file_name"] == "photo (1).jpg"
    assert (tmp_path / "photo (1).jpg").read_bytes() == b"file-content"


def test_upload_transfer_without_token_is_rejected(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    _set_download_directory(desktop_client, tmp_path)
    _pair_device_with_token(client)
    transfer = _accept_upload(client, desktop_client, "valid-token")

    response = client.post(f"/api/v1/transfers/{transfer['id']}/upload", content=b"file-content")

    assert response.status_code == 401


def test_upload_transfer_not_owned_returns_404(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    _set_download_directory(desktop_client, tmp_path)
    _pair_device_with_token(client, "token-a")
    _pair_device_with_token(client, "token-b")
    transfer = _accept_upload(client, desktop_client, "token-a")

    response = client.post(
        f"/api/v1/transfers/{transfer['id']}/upload",
        content=b"file-content",
        headers=_auth_headers("token-b"),
    )

    assert response.status_code == 404


def test_upload_transfer_wrong_direction_returns_409(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client)
    transfer = _accept_download(client, desktop_client, shared_file["id"], "valid-token")

    response = client.post(
        f"/api/v1/transfers/{transfer['id']}/upload",
        content=b"file-content",
        headers=_auth_headers(),
    )

    assert response.status_code == 409
