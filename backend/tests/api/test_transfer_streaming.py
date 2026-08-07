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


def _accept_download(client: TestClient, shared_file_id: int, token: str) -> dict:
    """Named `_accept_download` for parity with `_accept_upload` below, even
    though a download no longer needs a separate desktop accept call -- the
    propose response already carries the accepted Transfer's id."""
    created = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "send", "shared_file_id": shared_file_id},
        headers=_auth_headers(token),
    ).json()["data"]
    assert created["status"] == "accepted"
    response = client.get(f"/api/v1/transfers/{created['transfer_id']}", headers=_auth_headers(token))
    assert response.status_code == 200
    return response.json()["data"]


def _accept_upload(
    client: TestClient,
    token: str,
    file_name: str = "photo.jpg",
    file_size: int = 12,
) -> dict:
    """Named `_accept_upload` for parity with `_accept_download` above, even
    though an upload no longer needs a separate desktop accept call -- the
    propose response already carries the accepted Transfer's id."""
    created = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "receive", "file_name": file_name, "file_size": file_size},
        headers=_auth_headers(token),
    ).json()["data"]
    assert created["status"] == "accepted"
    response = client.get(f"/api/v1/transfers/{created['transfer_id']}", headers=_auth_headers(token))
    assert response.status_code == 200
    return response.json()["data"]


# --- GET /transfers/{id}/download ------------------------------------------------


def test_download_transfer_streams_file_bytes(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path, content=b"file-content"))
    _pair_device_with_token(client)
    transfer = _accept_download(client, shared_file["id"], "valid-token")

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


def test_download_transfer_with_unicode_file_name_streams_successfully(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    """Regression test: a non-Latin-1 file name previously crashed header
    encoding entirely (UnicodeEncodeError building Content-Disposition)
    before any response was sent -- found live during P13 verification."""
    shared_file = _share_file(desktop_client, _make_file(tmp_path, name="日本語.txt", content=b"content"))
    _pair_device_with_token(client)
    transfer = _accept_download(client, shared_file["id"], "valid-token")

    response = client.get(f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers())

    assert response.status_code == 200
    assert response.content == b"content"
    assert "filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt" in response.headers["content-disposition"]


def test_download_transfer_without_token_is_rejected(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client)
    transfer = _accept_download(client, shared_file["id"], "valid-token")

    response = client.get(f"/api/v1/transfers/{transfer['id']}/download")

    assert response.status_code == 401


def test_download_transfer_not_owned_returns_404(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client, "token-a")
    _pair_device_with_token(client, "token-b")
    transfer = _accept_download(client, shared_file["id"], "token-a")

    response = client.get(
        f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers("token-b")
    )

    assert response.status_code == 404


def test_download_transfer_wrong_direction_returns_409(
    client: TestClient, desktop_client: TestClient
) -> None:
    _pair_device_with_token(client)
    transfer = _accept_upload(client, "valid-token")

    response = client.get(
        f"/api/v1/transfers/{transfer['id']}/download", headers=_auth_headers()
    )

    assert response.status_code == 409


def test_download_transfer_not_in_progress_returns_409(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    shared_file = _share_file(desktop_client, _make_file(tmp_path))
    _pair_device_with_token(client)
    transfer = _accept_download(client, shared_file["id"], "valid-token")
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
    transfer = _accept_download(client, shared_file["id"], "valid-token")
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
    transfer = _accept_upload(client, "valid-token", file_name="photo.jpg", file_size=12)

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
    transfer = _accept_upload(client, "valid-token", file_name="photo.jpg", file_size=12)

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
    transfer = _accept_upload(client, "valid-token")

    response = client.post(f"/api/v1/transfers/{transfer['id']}/upload", content=b"file-content")

    assert response.status_code == 401


def test_upload_transfer_not_owned_returns_404(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    _set_download_directory(desktop_client, tmp_path)
    _pair_device_with_token(client, "token-a")
    _pair_device_with_token(client, "token-b")
    transfer = _accept_upload(client, "token-a")

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
    transfer = _accept_download(client, shared_file["id"], "valid-token")

    response = client.post(
        f"/api/v1/transfers/{transfer['id']}/upload",
        content=b"file-content",
        headers=_auth_headers(),
    )

    assert response.status_code == 409


# --- Folder download/upload, end to end (P13) -------------------------------------


def test_download_folder_child_streams_bytes_and_carries_folder_fields(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    root = tmp_path / "University Notes"
    (root / "Semester 1").mkdir(parents=True)
    (root / "Semester 1" / "DBMS.pdf").write_bytes(b"dbms-notes")
    shared_folder = desktop_client.post(
        "/api/v1/folders", json={"folder_path": str(root)}
    ).json()["data"]
    child = desktop_client.get(f"/api/v1/folders/{shared_folder['id']}/files").json()["data"][0]
    _pair_device_with_token(client)

    proposed = client.post(
        "/api/v1/transfers/requests",
        json={"direction": "send", "shared_file_id": child["id"]},
        headers=_auth_headers(),
    ).json()["data"]
    transfer_id = proposed["transfer_id"]

    response = client.get(f"/api/v1/transfers/{transfer_id}/download", headers=_auth_headers())

    assert response.status_code == 200
    assert response.content == b"dbms-notes"

    transfer = desktop_client.get(f"/api/v1/transfers/{transfer_id}").json()["data"]
    assert transfer["shared_folder_id"] == shared_folder["id"]
    assert transfer["folder_relative_path"] == "University Notes/Semester 1/DBMS.pdf"


def test_upload_folder_children_recreate_hierarchy_on_disk(
    client: TestClient, desktop_client: TestClient, tmp_path: Path
) -> None:
    """Android picks a local folder and uploads it: two files proposed under
    the same upload_batch_id/upload_folder_name must land in the same
    recreated directory tree on the desktop."""
    _set_download_directory(desktop_client, tmp_path)
    _pair_device_with_token(client)

    first = client.post(
        "/api/v1/transfers/requests",
        json={
            "direction": "receive",
            "file_name": "DBMS.pdf",
            "file_size": len(b"dbms-notes"),
            "folder_relative_path": "Semester 1/DBMS.pdf",
            "upload_batch_id": "batch-1",
            "upload_folder_name": "University Notes",
        },
        headers=_auth_headers(),
    ).json()["data"]
    second = client.post(
        "/api/v1/transfers/requests",
        json={
            "direction": "receive",
            "file_name": "Trees.pdf",
            "file_size": len(b"trees"),
            "folder_relative_path": "Semester 2/DSA/Trees.pdf",
            "upload_batch_id": "batch-1",
            "upload_folder_name": "University Notes",
        },
        headers=_auth_headers(),
    ).json()["data"]

    client.post(
        f"/api/v1/transfers/{first['transfer_id']}/upload",
        content=b"dbms-notes",
        headers=_auth_headers(),
    )
    client.post(
        f"/api/v1/transfers/{second['transfer_id']}/upload",
        content=b"trees",
        headers=_auth_headers(),
    )

    assert (tmp_path / "University Notes" / "Semester 1" / "DBMS.pdf").read_bytes() == b"dbms-notes"
    assert (tmp_path / "University Notes" / "Semester 2" / "DSA" / "Trees.pdf").read_bytes() == b"trees"
