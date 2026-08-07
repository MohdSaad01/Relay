"""Tests for the /folders endpoints (P13: Folder Transfer Support)."""

from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.security import hash_token
from app.models.device_session import DeviceSession
from app.utils.time import utc_now
from tests.repositories.conftest import make_device


def _make_tree(root: Path) -> None:
    (root / "Semester 1").mkdir(parents=True)
    (root / "Semester 1" / "DBMS.pdf").write_bytes(b"dbms notes")
    (root / "Semester 2").mkdir(parents=True)
    (root / "Semester 2" / "Trees.pdf").write_bytes(b"trees")


def _share_folder(desktop_client: TestClient, path: str) -> dict:
    response = desktop_client.post("/api/v1/folders", json={"folder_path": path})
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


# --- POST /folders -------------------------------------------------------------


def test_post_folders_creates_shared_folder(desktop_client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "University Notes"
    _make_tree(root)

    response = desktop_client.post("/api/v1/folders", json={"folder_path": str(root)})

    assert response.status_code == 201
    body = response.json()
    assert body["data"]["folder_path"] == str(root)
    assert body["data"]["folder_name"] == "University Notes"
    assert body["data"]["file_count"] == 2


def test_post_folders_rejects_a_regular_file(desktop_client: TestClient, tmp_path: Path) -> None:
    file_path = tmp_path / "report.pdf"
    file_path.write_bytes(b"content")

    response = desktop_client.post("/api/v1/folders", json={"folder_path": str(file_path)})

    assert response.status_code == 400


def test_post_folders_rejects_missing_folder(desktop_client: TestClient, tmp_path: Path) -> None:
    response = desktop_client.post("/api/v1/folders", json={"folder_path": str(tmp_path / "missing")})

    assert response.status_code == 400


def test_post_folders_re_sharing_same_path_returns_200_not_201(
    desktop_client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    desktop_client.post("/api/v1/folders", json={"folder_path": str(root)})

    response = desktop_client.post("/api/v1/folders", json={"folder_path": str(root)})

    assert response.status_code == 200


# --- GET /folders (dual audience) -----------------------------------------------


def test_get_folders_as_desktop_returns_full_view_without_auth(
    desktop_client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "Notes"
    _make_tree(root)
    _share_folder(desktop_client, str(root))

    response = desktop_client.get("/api/v1/folders")

    assert response.status_code == 200
    assert "folder_path" in response.json()["data"][0]


def test_get_folders_as_android_without_token_is_rejected(client: TestClient) -> None:
    response = client.get("/api/v1/folders")

    assert response.status_code == 401


def test_get_folders_as_android_with_valid_token_returns_sanitized_view(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "Notes"
    _make_tree(root)
    _share_folder(desktop_client, str(root))
    _pair_device_with_token(client, "valid-token")

    response = client.get("/api/v1/folders", headers={"Authorization": "Bearer valid-token"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 1
    assert "folder_path" not in data[0]
    assert data[0]["folder_name"] == "Notes"


# --- GET /folders/{id} -----------------------------------------------------------


def test_get_folder_by_id_returns_matching_folder(desktop_client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    shared_folder = _share_folder(desktop_client, str(root))

    response = desktop_client.get(f"/api/v1/folders/{shared_folder['id']}")

    assert response.status_code == 200
    assert response.json()["data"]["id"] == shared_folder["id"]


def test_get_folder_by_id_returns_404_when_missing(desktop_client: TestClient) -> None:
    response = desktop_client.get("/api/v1/folders/999")

    assert response.status_code == 404


# --- GET /folders/{id}/files (dual audience) --------------------------------------


def test_get_folder_files_as_desktop_returns_relative_paths(
    desktop_client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "Notes"
    _make_tree(root)
    shared_folder = _share_folder(desktop_client, str(root))

    response = desktop_client.get(f"/api/v1/folders/{shared_folder['id']}/files")

    assert response.status_code == 200
    data = response.json()["data"]
    assert {item["relative_path"] for item in data} == {
        "Semester 1/DBMS.pdf",
        "Semester 2/Trees.pdf",
    }


def test_get_folder_files_never_appear_in_flat_files_list(
    desktop_client: TestClient, tmp_path: Path
) -> None:
    """11_File_Transfer.md: "must not display every contained file individually"."""
    root = tmp_path / "Notes"
    _make_tree(root)
    _share_folder(desktop_client, str(root))
    standalone = tmp_path / "standalone.txt"
    standalone.write_bytes(b"standalone")
    desktop_client.post("/api/v1/files", json={"file_path": str(standalone)})

    response = desktop_client.get("/api/v1/files")

    assert response.status_code == 200
    data = response.json()["data"]
    assert [item["file_name"] for item in data] == ["standalone.txt"]


def test_get_folder_files_as_android_with_valid_token_omits_file_path(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "Notes"
    _make_tree(root)
    shared_folder = _share_folder(desktop_client, str(root))
    _pair_device_with_token(client, "valid-token")

    response = client.get(
        f"/api/v1/folders/{shared_folder['id']}/files", headers={"Authorization": "Bearer valid-token"}
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data) == 2
    assert all("file_path" not in item for item in data)


# --- POST /folders/{id}/refresh ---------------------------------------------------


def test_refresh_folder_reflects_new_files(desktop_client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    (root / "a.txt").write_bytes(b"a")
    shared_folder = _share_folder(desktop_client, str(root))
    (root / "b.txt").write_bytes(b"bb")

    response = desktop_client.post(f"/api/v1/folders/{shared_folder['id']}/refresh")

    assert response.status_code == 200
    assert response.json()["data"]["file_count"] == 2


def test_refresh_folder_returns_404_when_missing(desktop_client: TestClient) -> None:
    response = desktop_client.post("/api/v1/folders/999/refresh")

    assert response.status_code == 404


# --- DELETE /folders/{id} ----------------------------------------------------------


def test_delete_folder_returns_204_with_empty_body(desktop_client: TestClient, tmp_path: Path) -> None:
    root = tmp_path / "Notes"
    root.mkdir()
    shared_folder = _share_folder(desktop_client, str(root))

    response = desktop_client.delete(f"/api/v1/folders/{shared_folder['id']}")

    assert response.status_code == 204
    assert response.content == b""


def test_delete_folder_returns_404_when_missing(desktop_client: TestClient) -> None:
    response = desktop_client.delete("/api/v1/folders/999")

    assert response.status_code == 404
