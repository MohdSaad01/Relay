"""Tests for the /files endpoints (Milestone 10)."""

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
    exercised by tests/api/test_pairing.py, not here."""
    session = client.session_factory()  # type: ignore[attr-defined]
    device = make_device()
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


# --- POST /files -------------------------------------------------------------


def test_post_files_creates_shared_file(desktop_client: TestClient, tmp_path: Path) -> None:
    path = _make_file(tmp_path)

    response = desktop_client.post("/api/v1/files", json={"file_path": path})

    assert response.status_code == 201
    body = response.json()
    assert body["data"]["file_path"] == path
    assert body["data"]["file_name"] == "report.pdf"


def test_post_files_rejects_missing_file(desktop_client: TestClient, tmp_path: Path) -> None:
    response = desktop_client.post("/api/v1/files", json={"file_path": str(tmp_path / "missing.pdf")})

    assert response.status_code == 400


def test_post_files_rejects_relative_path(desktop_client: TestClient) -> None:
    response = desktop_client.post("/api/v1/files", json={"file_path": "relative/report.pdf"})

    assert response.status_code == 400


def test_post_files_re_sharing_same_path_returns_200_not_201(
    desktop_client: TestClient, tmp_path: Path
) -> None:
    path = _make_file(tmp_path)
    desktop_client.post("/api/v1/files", json={"file_path": path})

    response = desktop_client.post("/api/v1/files", json={"file_path": path})

    assert response.status_code == 200


# --- GET /files (dual audience) ----------------------------------------------


def test_get_files_as_desktop_returns_full_view_without_auth(
    desktop_client: TestClient, tmp_path: Path
) -> None:
    _share_file(desktop_client, _make_file(tmp_path))

    response = desktop_client.get("/api/v1/files")

    assert response.status_code == 200
    assert "file_path" in response.json()["data"][0]


def test_get_files_as_android_without_token_is_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/files")

    assert response.status_code == 401


def test_get_files_as_android_with_valid_token_returns_sanitized_view(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client, "valid-token")

    response = client.get("/api/v1/files", headers={"Authorization": "Bearer valid-token"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert "file_path" not in data[0]
    assert data[0]["file_name"] == "report.pdf"


def test_get_files_as_android_with_invalid_token_is_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/files", headers={"Authorization": "Bearer unknown-token"})

    assert response.status_code == 401


# --- GET /files/{id} -----------------------------------------------------------


def test_get_file_by_id_returns_matching_file(desktop_client: TestClient, tmp_path: Path) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))

    response = desktop_client.get(f"/api/v1/files/{shared_file['id']}")

    assert response.status_code == 200
    assert response.json()["data"]["id"] == shared_file["id"]


def test_get_file_by_id_returns_404_when_missing(desktop_client: TestClient) -> None:
    response = desktop_client.get("/api/v1/files/999")

    assert response.status_code == 404


# --- POST /files/{id}/refresh --------------------------------------------------


def test_refresh_file_updates_size(desktop_client: TestClient, tmp_path: Path) -> None:
    path = _make_file(tmp_path)
    shared_file = _share_file(desktop_client, path)
    Path(path).write_bytes(b"much longer content now")

    response = desktop_client.post(f"/api/v1/files/{shared_file['id']}/refresh")

    assert response.status_code == 200
    assert response.json()["data"]["file_size"] == len(b"much longer content now")


def test_refresh_file_rejects_when_source_missing(desktop_client: TestClient, tmp_path: Path) -> None:
    path = _make_file(tmp_path)
    shared_file = _share_file(desktop_client, path)
    Path(path).unlink()

    response = desktop_client.post(f"/api/v1/files/{shared_file['id']}/refresh")

    assert response.status_code == 400


def test_refresh_file_returns_404_when_missing(desktop_client: TestClient) -> None:
    response = desktop_client.post("/api/v1/files/999/refresh")

    assert response.status_code == 404


# --- DELETE /files/{id} ---------------------------------------------------------


def test_delete_file_returns_204_with_empty_body(desktop_client: TestClient, tmp_path: Path) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))

    response = desktop_client.delete(f"/api/v1/files/{shared_file['id']}")

    assert response.status_code == 204
    assert response.content == b""


def test_delete_file_returns_404_when_missing(desktop_client: TestClient) -> None:
    response = desktop_client.delete("/api/v1/files/999")

    assert response.status_code == 404
