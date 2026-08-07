"""Transfer endpoints: propose, list, cancel, and stream the bytes of file
transfers (docs/11_File_Transfer.md §7-8, docs/13_Database_Design.md §7).

Three sub-resources:

* `/transfers/requests` — the pending, in-memory phase (TransferManager).
  Android-only (`CurrentDeviceDep`) for proposing (POST); dual-audience
  (`RequestingDeviceDep`) for listing/inspecting. Both a `send` (download)
  and a `receive` (upload) proposal are auto-accepted inside that same POST
  — see TransferService.request_transfer — so a request is never actually
  observed PENDING; there is no desktop decision step and therefore no
  accept/reject/withdraw endpoint.
* `/transfers` — the persisted phase (TransferRepository), created in the
  same call that proposes it. Dual-audience throughout, same split as above.
* `/transfers/{id}/download` and `/transfers/{id}/upload` — the Streaming
  Engine (Milestone 12, TransferStreamService). Android-only, like the
  request sub-resource: the desktop never calls these itself, it just reads
  or writes local disk, since the backend is embedded in the desktop app.

Routes stay thin — no business logic and no route-level try/except. Every
TransferService/TransferStreamService exception is translated to an HTTP
response by the centralized handlers in app/api/exception_handlers.py
(Milestone 6).
"""

from urllib.parse import quote

import anyio
from fastapi import APIRouter, Request, status
from fastapi.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from app.api.dependencies import (
    CurrentDeviceDep,
    RequestingDeviceDep,
    TransferServiceDep,
    TransferStreamServiceDep,
)
from app.api.responses import success
from app.core.config import get_settings
from app.models.enums import TransferDirection, TransferStatus
from app.schemas.common import ApiResponse
from app.schemas.transfer import (
    TransferRequestCreate,
    TransferRequestResponse,
    TransferResponse,
)
from app.services.exceptions import ConflictError
from app.services.transfer_stream_service import TransferStreamService

router = APIRouter()


def _content_disposition(file_name: str) -> str:
    """Build a Content-Disposition header value safe for any file name,
    including non-Latin-1 characters (P13's "unicode filenames" edge case).

    HTTP header values are Latin-1 only — a raw unicode name previously
    crashed header encoding entirely with UnicodeEncodeError before any
    response was ever sent (found live during P13 verification: a shared
    file with a Japanese name made every download of it fail, whether
    standalone or a folder child, since both paths flow through this same
    route). RFC 6266's `filename*=UTF-8''<percent-encoded>` form carries the
    real name for any client that understands it (react-native-blob-util,
    browsers); the legacy `filename` parameter carries an ASCII-safe
    fallback for anything that only reads that older parameter. Neither
    value is actually load-bearing for this app's own correctness — the
    Android client names its saved file from the transfer's own JSON
    metadata (file_name/folder_relative_path), not from this header — but a
    standards-compliant header is the right default regardless, and it must
    not crash.
    """
    ascii_fallback = file_name.encode("ascii", errors="replace").decode("ascii").replace('"', "'")
    encoded = quote(file_name, safe="")
    return f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"


class _WriteTimeoutStreamingResponse(StreamingResponse):
    """A download StreamingResponse where a stalled `send()` is treated as a
    lost connection, instead of waiting on Starlette/the OS to notice.

    Milestone P8 (docs/15_QA_NOTEBOOK.md) found that on this project's
    Windows target, a client that drops the connection mid-download can
    leave `send()` hung indefinitely — the OS/event loop doesn't reliably
    surface the dead socket while the process is otherwise idle. Wrapping
    each chunk's `send()` in `anyio.fail_after` turns that into a bounded,
    deterministic timeout (`Settings.STREAM_WRITE_TIMEOUT_SECONDS`) instead.
    On expiry, `abort_stalled_download` finalizes the transfer directly
    (see its docstring) and the response simply stops — the client is
    already gone, so there's nothing left to send.
    """

    def __init__(self, *args: object, stream_service: TransferStreamService, transfer_id: int, **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self._stream_service = stream_service
        self._transfer_id = transfer_id

    async def stream_response(self, send: Send) -> None:
        await send({"type": "http.response.start", "status": self.status_code, "headers": self.raw_headers})
        bytes_sent = 0
        async for chunk in self.body_iterator:
            if not isinstance(chunk, bytes | memoryview):
                chunk = chunk.encode(self.charset)
            try:
                with anyio.fail_after(get_settings().STREAM_WRITE_TIMEOUT_SECONDS):
                    await send({"type": "http.response.body", "body": chunk, "more_body": True})
            except TimeoutError:
                await anyio.to_thread.run_sync(
                    self._stream_service.abort_stalled_download, self._transfer_id, bytes_sent
                )
                return
            bytes_sent += len(chunk)
        await send({"type": "http.response.body", "body": b"", "more_body": False})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self.stream_response(send)
        if self.background is not None:
            await self.background()


# --- /transfers/requests (pending, in-memory) --------------------------------


@router.post("/requests", response_model=ApiResponse, status_code=status.HTTP_201_CREATED)
def request_transfer(
    body: TransferRequestCreate, device: CurrentDeviceDep, service: TransferServiceDep
) -> ApiResponse:
    """Propose a transfer: a download of a shared file, or an upload. Both are
    auto-accepted in this same call — the response already carries
    status=accepted and a transfer_id."""
    request = service.request_transfer(
        device,
        body.direction,
        body.shared_file_id,
        body.file_name,
        body.file_size,
        body.folder_relative_path,
        body.upload_batch_id,
        body.upload_folder_name,
    )
    response = TransferRequestResponse.model_validate(request)
    return success(response.model_dump(mode="json"), message="Transfer requested.")


@router.get("/requests", response_model=ApiResponse)
def list_transfer_requests(device: RequestingDeviceDep, service: TransferServiceDep) -> ApiResponse:
    """List pending transfer requests: every one for the desktop, only its own for Android."""
    requests = service.list_requests(device)
    data = [TransferRequestResponse.model_validate(r).model_dump(mode="json") for r in requests]
    return success(data)


@router.get("/requests/{request_id}", response_model=ApiResponse)
def get_transfer_request(
    request_id: str, device: RequestingDeviceDep, service: TransferServiceDep
) -> ApiResponse:
    """Return a single transfer request, pending or already decided."""
    request = service.get_request_or_raise(request_id, device)
    response = TransferRequestResponse.model_validate(request)
    return success(response.model_dump(mode="json"))


# --- /transfers (persisted) ---------------------------------------------------


@router.get("", response_model=ApiResponse)
def list_transfers(device: RequestingDeviceDep, service: TransferServiceDep) -> ApiResponse:
    """List transfers: full history for the desktop, only its own for Android."""
    transfers = service.list_transfers(device)
    data = [TransferResponse.model_validate(t).model_dump(mode="json") for t in transfers]
    return success(data)


@router.get("/{transfer_id}", response_model=ApiResponse)
def get_transfer(transfer_id: int, device: RequestingDeviceDep, service: TransferServiceDep) -> ApiResponse:
    """Return a single transfer by id."""
    transfer = service.get_transfer_or_raise(transfer_id, device)
    response = TransferResponse.model_validate(transfer)
    return success(response.model_dump(mode="json"))


@router.post("/{transfer_id}/cancel", response_model=ApiResponse)
def cancel_transfer(
    transfer_id: int, device: RequestingDeviceDep, service: TransferServiceDep
) -> ApiResponse:
    """Cancel an in-progress transfer."""
    transfer = service.cancel_transfer(transfer_id, device)
    response = TransferResponse.model_validate(transfer)
    return success(response.model_dump(mode="json"), message="Transfer cancelled.")


# --- /transfers/{id}/download, /transfers/{id}/upload (Streaming Engine) -------


@router.get("/{transfer_id}/download")
def download_transfer(
    transfer_id: int,
    device: CurrentDeviceDep,
    service: TransferServiceDep,
    stream_service: TransferStreamServiceDep,
) -> StreamingResponse:
    """Stream an in-progress SEND transfer's bytes to the paired Android device
    that requested it. Not wrapped in the standard ApiResponse envelope — the
    body is the raw file (05_API_Design.md §5)."""
    transfer = service.get_transfer_or_raise(transfer_id, device)
    if transfer.direction is not TransferDirection.SEND:
        raise ConflictError(f"Transfer {transfer_id} is not a download.")
    if transfer.status is not TransferStatus.IN_PROGRESS:
        raise ConflictError(f"Transfer {transfer_id} is not in progress.")

    file_path = stream_service.resolve_download_source(transfer)
    headers = {
        "Content-Length": str(transfer.file_size),
        "Content-Disposition": _content_disposition(transfer.file_name),
    }
    return _WriteTimeoutStreamingResponse(
        stream_service.stream_download(transfer, file_path),
        media_type=stream_service.guess_media_type(transfer.file_name),
        headers=headers,
        stream_service=stream_service,
        transfer_id=transfer_id,
    )


@router.post("/{transfer_id}/upload", response_model=ApiResponse)
async def upload_transfer(
    transfer_id: int,
    request: Request,
    device: CurrentDeviceDep,
    service: TransferServiceDep,
    stream_service: TransferStreamServiceDep,
) -> ApiResponse:
    """Receive an in-progress RECEIVE transfer's bytes from the paired Android
    device that owns it. The request body is the raw file, not JSON
    (05_API_Design.md §5) — only the response uses the standard envelope."""
    transfer = service.get_transfer_or_raise(transfer_id, device)
    if transfer.direction is not TransferDirection.RECEIVE:
        raise ConflictError(f"Transfer {transfer_id} is not an upload.")
    if transfer.status is not TransferStatus.IN_PROGRESS:
        raise ConflictError(f"Transfer {transfer_id} is not in progress.")

    updated = await stream_service.receive_upload(transfer, request.stream())
    response = TransferResponse.model_validate(updated)
    return success(response.model_dump(mode="json"), message="Transfer completed.")
