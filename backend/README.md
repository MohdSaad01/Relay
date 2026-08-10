# Relay Backend

FastAPI backend for Relay. See `/docs` at the repository root for the full
project specification.

## Architecture

The backend follows the layered design described in `docs/02_Architecture.md`:

```text
API Layer (app/api/)          — HTTP routing, request/response schemas, DI, exception mapping
        │
Service Layer (app/services/) — business rules, workflows, transaction boundaries (commit/rollback)
        │
Repository Layer (app/repositories/) — SQLAlchemy queries only
        │
Models (app/models/)          — SQLAlchemy table definitions
```

Each layer only calls the one directly below it:

* API routes call **Services** only — never repositories or SQLAlchemy models directly.
* Services call **Repositories** only, and own transaction boundaries (`db.commit()`).
* Repositories are the only code that queries SQLAlchemy.

Service Layer exceptions (`app/services/exceptions.py`: `NotFoundError`,
`ValidationError`, `ConflictError`) are deliberately plain Python exceptions
with no FastAPI dependency — the API Layer is what translates them into HTTP
responses (see [Exception Handling](#exception-handling) below).

## Pairing Infrastructure

`PairingService` (`app/services/pairing_service.py`) orchestrates the
pairing handshake described in `docs/10_Security.md` §4-6 — start, submit,
approve/reject, collect. It delegates persistence to the existing
`DeviceService`/`DeviceSessionRepository`/`AppSettingsService` rather than
duplicating logic, and is exposed over HTTP by `app/api/v1/pairing.py`
(see [Pairing API](#pairing-api) below).

Its runtime state does not go through the layers above: pairing tokens are
single-use and expire within minutes, so per `docs/13_Database_Design.md` §9
they are never written to the database. `PairingManager`
(`app/services/pairing_manager.py`) holds them in a lock-guarded, in-memory
dict instead — a process-lifetime singleton (`get_pairing_manager()`)
alongside, not inside, the layered request/DB flow described above. Token
generation and hashing (`generate_token`, `hash_token`) live in
`app/core/security.py`, reused for both pairing tokens and device secrets.

## Authentication Infrastructure

`AuthService` (`app/services/auth_service.py`) validates the bearer
`DeviceSession` token minted by `PairingService.approve_pairing` (M7/M8),
per `docs/10_Security.md` §7-9. It hashes the presented token
(`app/core/security.hash_token`, the same helper used for pairing tokens
and device secrets), looks it up via
`DeviceSessionRepository.get_by_token_hash`, rejects a missing, unknown, or
expired token with `AuthenticationError`, and on success updates
`sessions.last_used_at`/`devices.last_seen_at`.

Every failure path raises the same `AuthenticationError` with an identical
generic message, regardless of which case occurred — this avoids giving a
caller an oracle for probing valid tokens, per `docs/10_Security.md` §11.
The specific cause is only ever logged server-side (`WARNING`), never
returned to the client.

`AuthService.authenticate()` deliberately never calls `db.commit()`. It runs
as part of a FastAPI dependency ahead of the route's own service call,
sharing that request's `Session` (FastAPI caches `Depends(get_db)` per
request), so its `last_used_at`/`last_seen_at` writes ride along inside
whatever transaction the route's own service commits — keeping
authentication itself from owning a transaction boundary on every protected
request. Trade-off: on a purely read-only protected route with no other
writes, that bookkeeping update can be rolled back on session close instead
of persisting. Accepted, since these two fields are informational only and
never participate in a security decision.

It is exposed as the `get_current_device` dependency / `CurrentDeviceDep`
type alias (`app/api/dependencies.py`), following the same pattern as the
service dependencies below. A second dependency, `get_requesting_device` /
`RequestingDeviceDep`, wraps it for **dual-audience** routes: it returns
`None` for the trusted local desktop caller — identified by the request
arriving over loopback (`_is_loopback_request`), since `devices.platform`
is Android-only and the desktop can therefore never hold a `DeviceSession`
— and otherwise falls through to `get_current_device`, so any other,
LAN-originating caller must present a valid session token under exactly the
same rules as a fully protected endpoint.

As of M10 (Shared Files) and M11/M12 (Transfers/Streaming), this is
actively enforced: `GET /files` and the dual-audience `/transfers` routes
use `RequestingDeviceDep`; the Android-only transfer-proposal and
byte-streaming routes (`POST /transfers/requests`,
`GET /transfers/{id}/download`, `POST /transfers/{id}/upload`) require
`CurrentDeviceDep` outright — see [Shared Files API](#shared-files-api) and
[Transfer API](#transfer-api) below. `/settings` and `/pairing` remain
fully unauthenticated — still desktop-only, loopback-trusted endpoints in
practice, and whether they should ever require a session was raised during
M9 and left open. `/devices` followed the same pattern until P23 (Android
Settings), which needed `PATCH /devices/{id}` (device display-name rename)
to be genuinely callable by Android itself — see [Devices
API](#devices-api) below for the narrow, route-scoped fix.

## Shared File Infrastructure

`SharedFileService` (`app/services/shared_file_service.py`) implements the
desktop's shared-file list (`docs/13_Database_Design.md` §6,
`docs/11_File_Transfer.md` §5-6): sharing a path, listing/inspecting shared
files, refreshing a share's on-disk metadata, and unsharing. It only ever
stats a path (name, size, MIME type via `mimetypes.guess_type`) — it never
opens or reads file contents; that is the Streaming Engine's job (below).

Filesystem checks (`app/utils/filesystem.py`) are pure, framework-agnostic
functions — absolute-path check, existence, regular-file check, symlink
rejection, metadata stat, and (added in M12) conflict-free-path resolution
— reused by both this service and `TransferStreamService`.
`SharedFileService` translates their failures into `ValidationError`.
`docs/13_Database_Design.md` §6's `UNIQUE(file_path)` constraint means
re-sharing an already-shared path refreshes the existing row instead of
creating a duplicate (`share_file` returns `(shared_file, was_created)`).

Symlinks are rejected outright, and a directory is rejected by this
service specifically — `/files` shares individual regular files only; a
whole folder is shared via the separate `/folders` resource below
(`docs/11_File_Transfer.md` §6, Milestone P13).

## Shared Folder Infrastructure (Milestone P13)

`SharedFolderService` (`app/services/shared_folder_service.py`) is
`SharedFileService`'s counterpart for a *whole folder* shared as one item
(`docs/13_Database_Design.md` §6a, `docs/11_File_Transfer.md` §6):
share/list/refresh/unshare, plus `list_folder_files` for a folder's child
manifest. Structurally identical to `SharedFileService` — validate
(absolute, exists, not a symlink, is a directory), upsert-by-path on
re-share — with one genuinely new piece of logic: `refresh_folder` re-walks
the folder and *reconciles* its child `SharedFile` rows (update matched,
insert new, delete vanished), since a folder's contents can change shape
between shares, unlike a single file's refresh, which only ever re-stats
one path.

The walk itself is `app/utils/filesystem.walk_directory` — a pure,
recursive generator (`os.walk(followlinks=False)`, matching the existing
single-file symlink rejection) that computes each file's POSIX-style
`relative_path` and lets a per-file stat failure be handled by the caller
via an `on_stat_error` callback (mirroring `os.walk`'s own `onerror`
parameter) rather than deciding itself whether to abort the whole share —
`SharedFolderService` supplies a callback that logs and skips, so one
unreadable file never fails an entire folder share.

A folder's children are ordinary `SharedFile` rows
(`shared_folder_id`/`relative_path` set) — no new streaming or transfer
concept exists for them. They are excluded from `GET /files`'s flat list
(`SharedFileRepository.list_all` filters `shared_folder_id IS NULL`) and
only ever surface via `GET /folders/{id}/files`, which is what a client
uses to enumerate what to individually propose when the user taps Download
on a folder.

## Transfer Infrastructure

Transfers are described by `docs/11_File_Transfer.md` §7 and
`docs/13_Database_Design.md` §7: a paired Android device *proposes* a
transfer — a download of a shared file, or an upload — and it is
**auto-accepted in that same call**. A download always has been (the
desktop already made the decision that matters when it shared the file);
an upload now follows the same reasoning, since the desktop already made
the decision that matters when it paired with the device — see the
Milestone P1 entry in `docs/15_QA_NOTEBOOK.md`. There is no longer any
desktop review step for either direction, and only an accepted proposal
ever becomes a persisted `Transfer` row.

**Pending-request bookkeeping is runtime-only state**, mirroring the
pairing-token pattern (`docs/13_Database_Design.md` §9): the
`transfers.status` enum has no "pending" or "rejected" value, so a proposal
is never written to the database until it's accepted. `TransferManager`
(`app/services/transfer_manager.py`) holds every decided
`PendingTransferRequest`, keyed by an opaque `request_id`, in a
lock-guarded, in-memory dict — a process-lifetime singleton
(`get_transfer_manager()`), the same pattern as `PairingManager` — for the
short grace period a requester's poll needs to observe the outcome. Since
`request_transfer` now decides every request in the same call that creates
it, nothing is ever actually left `PENDING` in this store; `TransferManager`
itself is unchanged (it still supports genuinely pending, multi-device
state as a building block), but `TransferService` no longer calls the
methods (`create`, `claim_for_decision`, `withdraw`) that would use that
capability.

`TransferService` (`app/services/transfer_service.py`) orchestrates this:
`request_transfer` (propose-and-accept in one step), `list_requests` /
`get_request_or_raise` (pending-phase queries — always empty/immediately
`accepted` in practice, kept for existing pollers), and `list_transfers` /
`get_transfer_or_raise` / `cancel_transfer` (persisted-phase queries). It
delegates persistence to `SharedFileService`, `DeviceRepository`, and
`TransferRepository` rather than duplicating their logic. `request_transfer`
re-validates and re-snapshots `file_name`/`file_size`/`device_name` at the
moment the `Transfer` row is created, not just from the proposal payload,
per `docs/10_Security.md` §9 — if that re-validation fails (e.g. a `send`
names a shared file that was removed in the meantime), the call raises
`NotFoundError` and nothing is persisted.

**Folder transfers (Milestone P13) reuse this exact lifecycle unchanged —
there is no separate "propose a folder" call.** A folder download is the
client enumerating `GET /folders/{id}/files` and calling
`request_transfer` once per child, same as today; `_create_transfer`
additionally derives `shared_folder_id`/`folder_relative_path` fresh from
the shared file's own folder membership when present. A folder upload adds
three new, all-optional `request_transfer` parameters
(`folder_relative_path`, `upload_batch_id`, `upload_folder_name`),
validated by a new `_validate_folder_upload_payload` (reusing the existing
per-segment traversal-safety check, `_validate_plain_name_segment`, that
already guards a flat upload's `file_name`) and resolved via
`UploadBatchRegistry` (`app/services/upload_batch_registry.py`, a
lock-guarded singleton in the same shape as `ActiveStreamRegistry`) so
every file in one Android folder-upload batch lands under the same
conflict-resolved root folder name.

M11 does not stream bytes — the only DB-level status transition it performs
on an accepted transfer is `in_progress -> cancelled`. Byte movement, and
the `completed`/`failed` transitions, belong to the Streaming Engine below.

## Streaming Engine

`TransferStreamService` (`app/services/transfer_stream_service.py`) moves
the actual bytes of an already-`in_progress` transfer
(`docs/11_File_Transfer.md` §8). It is deliberately separate from
`TransferService`: `TransferService` owns the transfer *lifecycle* (M11,
unchanged by this milestone) and this service only ever operates on a
transfer that lifecycle has already put in `IN_PROGRESS` — it never
creates, accepts, rejects, or lists transfers.

**Transport:** an HTTP `StreamingResponse` over a generator that reads the
source file in fixed-size chunks — `resolve_download_source` re-validates
the file's existence, type, and size immediately before streaming begins —
with an explicit `Content-Length` set from the transfer's known
`file_size`, chosen over implicit chunked transfer-encoding so clients can
compute real download progress. Chunk size is configurable
(`Settings.STREAM_CHUNK_SIZE_BYTES`, default 1 MiB) rather than hardcoded.

**Download** (`GET /transfers/{id}/download`, SEND direction): streams the
shared file's bytes directly from disk, reusing `SharedFileService` for
source-path resolution/validation rather than duplicating it.

**Upload** (`POST /transfers/{id}/upload`, RECEIVE direction): this route
is `async def` — the only one in the codebase — because consuming the raw
ASGI request body via `Request.stream()` requires `await`, which a sync
`def` route cannot do. Incoming bytes are written to a temp file inside
`app_settings.download_directory` (`tempfile.mkstemp`), then atomically
renamed into place (`os.replace`) only once the full declared `file_size`
has been received; a short, oversized, or interrupted upload is recorded
as a failed transfer and its temp file is discarded, never left under its
final name. `STREAM_CHUNK_SIZE_BYTES` does not govern this path — chunk
boundaries are whatever the ASGI server delivers, not something this loop
controls.

**Filename conflicts** are resolved automatically with the conventional
`name (1).ext`, `name (2).ext`, ... pattern
(`app/utils/filesystem.resolve_available_path`). When a rename happens,
the transfer's `file_name` is updated to the actual saved name — see
`docs/13_Database_Design.md` §7 for why this is a deliberate, narrow
exception to that document's stated immutability of that column.

**Cancellation** of an active stream is cooperative, not preemptive: the
streaming loop periodically (at the same interval as its progress-update
checkpoint, not per-chunk) re-reads the transfer's status from the
database, and stops without overwriting an already-terminal state (e.g. an
explicit `POST /transfers/{id}/cancel` from a different request) if it
finds one. This works without any change to `TransferService`/
`TransferManager`, because the project's `SessionLocal` uses the SQLAlchemy
default `expire_on_commit=True` — each of this service's own periodic
commits expires its in-session `Transfer` object, so the next read is a
genuine `SELECT`, not a cached identity-map hit.

**Concurrency:** `ActiveStreamRegistry` (`app/services/active_stream_registry.py`)
is a small, additional process-wide singleton — the same lock-guarded,
in-memory pattern as `PairingManager`/`TransferManager`, but scoped to
exactly one fact: whether a byte stream is currently active for a given
`transfer_id`. A second concurrent stream attempt on the same transfer
(e.g. a retried request from a flaky connection) is rejected with the
existing `ConflictError` (409) rather than allowed to race.

**Not implemented in this milestone** (explicitly out of scope): `Range`
request/resume support, checksum verification, compression, encryption,
and WebSocket push — progress is observed by polling the existing
`GET /transfers/{id}`.

## Device Discovery Infrastructure

`DiscoveryService` (`app/services/discovery_service.py`) lets a nearby
Android device find this desktop's backend without manual configuration
(`docs/09_Networking.md` §4). UDP broadcast was selected as the mechanism
for Version 1 — simpler than mDNS/Zeroconf, no extra dependency, and
sufficient for the home Wi-Fi/office LAN/mobile-hotspot networks
`docs/09_Networking.md` §3 targets.

Unlike every other service in this codebase, `DiscoveryService` is not
request-scoped: it is started once at process startup and stopped once at
shutdown (`app/main.py`'s `lifespan`), running its broadcast loop on a
single dedicated daemon thread that opens its own short-lived DB session on
every tick (it cannot borrow a request-scoped `Session`, since no request is
driving it). While running, it sends a `DiscoveryAnnouncePayload`
(`app/schemas/discovery.py`) — protocol version, Relay version, a
per-process `instance_id`, `device_display_name`, `desktop_ip`, and `port`,
deliberately no credentials, per `docs/10_Security.md` §5 — to the LAN
broadcast address (`app/utils/network.get_broadcast_address`, always
`255.255.255.255` in V1) on `Settings.DISCOVERY_PORT` every
`Settings.DISCOVERY_BROADCAST_INTERVAL_SECONDS`, unless
`app_settings.discovery_enabled` is currently off.

Deliberately isolated: this module only reads `AppSettingsService`, and
nothing else in the codebase depends on it. A broadcast failure (socket
creation at startup, a transient send error mid-loop) is always logged and
swallowed, never raised — discovery is a pure UX convenience layer, not a
dependency of pairing (`PairingService.build_qr_payload` already resolves
`desktop_ip`/`port` independently) or any other feature.

## API Layer

### Routing structure

All routes are versioned under `/api/v1` (mounted in `app/main.py`, prefix
from `Settings.API_V1_PREFIX`). `app/api/v1/router.py` aggregates one
sub-router per resource:

| Router | Prefix | Endpoints |
|---|---|---|
| `health.py` | `/health` | `GET /health` |
| `settings.py` | `/settings` | `GET /settings`, `PATCH /settings` |
| `devices.py` | `/devices` | `GET /devices`, `GET /devices/{id}`, `PATCH /devices/{id}`, `DELETE /devices/{id}` |
| `pairing.py` | `/pairing` | `POST /pairing/start`, `GET /pairing/pending/{token}`, `POST /pairing/request`, `POST /pairing/approve`, `POST /pairing/reject`, `GET /pairing/result/{token}` |
| `discovery.py` | `/discovery` | `GET /discovery/status` |
| `shared_files.py` | `/files` | `POST /files`, `GET /files`, `GET /files/{id}`, `POST /files/{id}/refresh`, `DELETE /files/{id}` |
| `transfers.py` | `/transfers` | `POST /transfers/requests`, `GET /transfers/requests`, `GET /transfers/requests/{id}`, `GET /transfers`, `GET /transfers/{id}`, `POST /transfers/{id}/cancel`, `GET /transfers/{id}/download`, `POST /transfers/{id}/upload` |

A new resource gets its own router module in `app/api/v1/`, included in
`router.py` — routers are never nested arbitrarily deep, matching one file
per resource.

### Dependency injection

`app/api/dependencies.py` provides one function per service
(`get_app_settings_service`, `get_device_service`, `get_pairing_service`,
`get_auth_service`, `get_shared_file_service`, `get_transfer_service`,
`get_transfer_stream_service`, `get_discovery_service`), each depending on
`get_db` (`app/database/session.py`) for a request-scoped SQLAlchemy
`Session`. Four of these additionally depend on a process-wide, in-memory
singleton rather than being purely `Session`-scoped, since that runtime
state lives outside the database by design: `get_pairing_service` on
`get_pairing_manager` (`PairingManager`, `docs/13_Database_Design.md` §9),
`get_transfer_service` on `get_transfer_manager` (`TransferManager`, same
reasoning — see [Transfer Infrastructure](#transfer-infrastructure)),
`get_transfer_stream_service` on `get_active_stream_registry`
(`ActiveStreamRegistry` — see [Streaming Engine](#streaming-engine)), and
`get_discovery_service` on the module-level `DiscoveryService` singleton
started/stopped by `app/main.py`'s `lifespan` (see
[Device Discovery Infrastructure](#device-discovery-infrastructure)).
Routes consume these through `Annotated` type aliases
(`AppSettingsServiceDep`, `DeviceServiceDep`, `PairingServiceDep`,
`AuthServiceDep`, `SharedFileServiceDep`, `TransferServiceDep`,
`TransferStreamServiceDep`, `DiscoveryServiceDep`) rather than
`= Depends(...)` default values, e.g.:

```python
def get_device(device_id: int, service: DeviceServiceDep) -> ApiResponse:
    ...
```

This keeps routes free of any direct `Session` or repository knowledge, and
is the ruff-clean form of the pattern (`Depends(...)` as an argument default
triggers the bugbear `B008` rule).

Two further dependencies sit on top of `get_auth_service`:
`get_current_device` (`CurrentDeviceDep`) extracts the
`Authorization: Bearer` header via FastAPI's `HTTPBearer(auto_error=False)`
and calls `AuthService.authenticate`, returning the resolved `Device`;
`get_requesting_device` (`RequestingDeviceDep`) wraps it for dual-audience
routes, returning `None` for the trusted loopback desktop caller instead.
See [Authentication Infrastructure](#authentication-infrastructure) above.

### Request/response flow

1. FastAPI validates the incoming request against a Pydantic schema in
   `app/schemas/` (e.g. `SettingsUpdateRequest`, `DeviceUpdateRequest`).
   These schemas validate **structure and types only** — business rules
   (non-empty strings, positive numbers, etc.) are intentionally left to the
   Service Layer so the rule is only ever implemented once.
2. The route calls the injected service and passes the validated data through.
3. The service applies business rules, calls its repository, and commits.
4. The route builds a response schema from the returned model
   (`SettingsResponse.model_validate(settings)`), and wraps it with the
   `success()` helper (`app/api/responses.py`) into the standard envelope.

### Response envelope

Every successful response uses `ApiResponse` (`app/schemas/common.py`):

```json
{ "success": true, "message": "...", "data": { } }
```

`DELETE` endpoints are one exception — they return `204 No Content` with an
empty body, per HTTP semantics and `docs/05_API_Design.md` §7.
`GET /transfers/{id}/download` is the other: its body is the raw file
stream, not this envelope, per `docs/05_API_Design.md` §5 — see
[Transfer API](#transfer-api) below.

### Exception handling

`app/api/exception_handlers.py` registers centralized handlers on the
FastAPI app (wired up in `main.py`) so routes never need their own
try/except blocks:

| Exception | HTTP Status | Logged at |
|---|---|---|
| `NotFoundError` | 404 | — |
| `ValidationError` | 400 | `INFO` |
| `ConflictError` | 409 | `WARNING` |
| `AuthenticationError` | 401 | `WARNING` |
| `RequestValidationError` (Pydantic/FastAPI) | 422 | — |
| Any other unhandled `Exception` | 500 | `ERROR` (with traceback) |

All error responses use the same `ApiResponse` envelope (`success: false`,
`data: null`), so clients only ever handle one response shape. The 401
response additionally carries a `WWW-Authenticate: Bearer` header, and its
message is deliberately generic — see
[Authentication Infrastructure](#authentication-infrastructure) above.

## Devices API

`app/api/v1/devices.py` exposes `DeviceService` (list, inspect, rename,
remove a paired device) over HTTP.

| Endpoint | Status codes | Caller |
|---|---|---|
| `GET /devices` | 200 | Desktop |
| `GET /devices/{id}` | 200, 404 | Desktop |
| `PATCH /devices/{id}` | 200, 400, 401, 404 | Desktop, or the device itself |
| `DELETE /devices/{id}` | 204, 404 | Desktop |

`PATCH /devices/{id}` is the router's one dual-audience route, added in
P23 so Android's Settings screen can rename its own device display name
(the human-readable label a paired device shows on the desktop's Devices
list — distinct from `device_identifier`, which never changes after
pairing). The trusted loopback desktop caller may rename any device, as
before; any other caller must present a `DeviceSession` bearer token
(`DeviceOwnerAuthDep`/`verify_device_owner`, `app/api/dependencies.py`)
belonging to the exact `device_id` in the path — a valid token for a
*different* device is rejected with the same generic 401 as a missing or
unknown one (`docs/10_Security.md` §11: never reveal which case
occurred). `GET /devices`, `GET /devices/{id}`, and `DELETE /devices/{id}`
are unchanged — still desktop-only and unauthenticated in practice, since
Android has no legitimate reason to list/inspect/unpair devices.

## Pairing API

`app/api/v1/pairing.py` exposes the M7 pairing handshake
(`docs/10_Security.md` §4-6) over HTTP. Routes stay thin — each one calls a
single `PairingService` method and lets the centralized exception handlers
above do the HTTP translation; there is no route-level try/except and no
business logic in this layer.

| Endpoint | Status codes | Caller |
|---|---|---|
| `POST /pairing/start` | 201, 500 | Desktop |
| `GET /pairing/pending/{token}` | 200, 404 | Desktop |
| `POST /pairing/request` | 200, 400, 404, 409 | Android |
| `POST /pairing/approve` | 200, 404 | Desktop |
| `POST /pairing/reject` | 200, 404 | Desktop |
| `GET /pairing/result/{token}` | 200, 400, 404 | Android |

`POST /pairing/start` is the only pairing endpoint returning `201` — it
mints a new pairing attempt (a new resource). The rest are state
transitions on that existing attempt, so they return `200` like the
`Devices`/`Settings` routers.

Typical flow:

1. Desktop calls `POST /pairing/start`; the response's `qr` object
   (`PairingQrPayload`) is rendered as a QR code, and `expires_at` reflects
   the attempt's TTL (`Settings.PAIRING_TOKEN_TTL_SECONDS`).
2. Android scans the QR and calls `POST /pairing/request` with the embedded
   `pairing_token` plus its own device info.
3. Desktop polls `GET /pairing/pending/{token}` (404 until Android submits)
   to learn who's asking, then calls `POST /pairing/approve` or
   `POST /pairing/reject`.
4. Android polls `GET /pairing/result/{token}` (404 while still pending,
   400 if rejected) until it gets a 200 with its one-time
   `device_secret`/`session_token` credentials — collected exactly once,
   per `docs/13_Database_Design.md` §9.

There is no server-defined polling interval — each client (desktop, Android)
chooses its own cadence; the backend only guarantees idempotent, side-effect-free
reads until a terminal state is reached.

`PairingManager` is a process-wide singleton, so its state is not reset
between requests the way the per-request `Session` is — `docs/13_Database_Design.md`
§9 only requires one active pairing attempt at a time, which the manager
already enforces (`start()` discards any prior attempt).

## Shared Files API

`app/api/v1/shared_files.py` exposes `SharedFileService`
(M10, `docs/13_Database_Design.md` §6) over HTTP.

| Endpoint | Status codes | Caller |
|---|---|---|
| `POST /files` | 200/201, 400 | Desktop |
| `GET /files` | 200, 401 | Dual-audience (desktop: full view; Android: sanitized view) |
| `GET /files/{id}` | 200, 404 | Desktop |
| `POST /files/{id}/refresh` | 200, 400, 404 | Desktop |
| `DELETE /files/{id}` | 204, 404 | Desktop |

`GET /files` is the one dual-audience route: the desktop's own loopback
caller gets the full `SharedFileResponse` (including `file_path`); a paired
Android device must present a valid `DeviceSession` bearer token
(`RequestingDeviceDep`) and receives the sanitized `AvailableFileResponse`
instead, which omits `file_path` — Android has no legitimate use for the
desktop's local directory structure, and `docs/10_Security.md` §10 requires
the filesystem never be exposed beyond what was explicitly shared.

`POST /files` returns `201` for a new share and `200` when it refreshed an
existing one (`shared_files.file_path` is unique, per
`docs/13_Database_Design.md` §6 — re-sharing a known path updates metadata
rather than duplicating the row). Every route other than `GET /files` is
desktop-only and unauthenticated, matching the `/devices`/`/settings`
precedent — Android cannot select files or mutate the shared list.

## Folders API (Milestone P13)

`app/api/v1/folders.py` exposes `SharedFolderService`
(`docs/13_Database_Design.md` §6a) over HTTP — mirrors the Shared Files API
above exactly, with one additional dual-audience route for a folder's
child manifest.

| Endpoint | Status codes | Caller |
|---|---|---|
| `POST /folders` | 200/201, 400 | Desktop |
| `GET /folders` | 200, 401 | Dual-audience (desktop: full view; Android: sanitized view) |
| `GET /folders/{id}` | 200, 404 | Desktop |
| `GET /folders/{id}/files` | 200, 401, 404 | Dual-audience |
| `POST /folders/{id}/refresh` | 200, 400, 404 | Desktop |
| `DELETE /folders/{id}` | 204, 404 | Desktop |

`GET /folders/{id}/files` is what a paired Android device calls to
enumerate a folder's children before proposing individual downloads for
each (`POST /transfers/requests`, unchanged) — a folder is never streamed
as a single unit. Same sanitization split as `GET /files`: the desktop
gets `file_path` on each child, Android does not.

## Transfer API

`app/api/v1/transfers.py` exposes `TransferService` (M11) and
`TransferStreamService` (M12) over HTTP, under three sub-resources.

**Transfer requests** (pending, in-memory — [Transfer Infrastructure](#transfer-infrastructure)):

| Endpoint | Status codes | Caller |
|---|---|---|
| `POST /transfers/requests` | 201, 400, 404 | Android |
| `GET /transfers/requests` | 200 | Dual-audience |
| `GET /transfers/requests/{id}` | 200, 404 | Dual-audience |

`POST /transfers/requests` auto-accepts in the same call — the response
already carries `status=accepted` and a `transfer_id` — for both directions,
so there is no accept/reject/withdraw endpoint: nothing is ever left for a
second call to decide on.

**Folder uploads (Milestone P13)** use this exact same endpoint with three
additional optional fields (`folder_relative_path`, `upload_batch_id`,
`upload_folder_name`) — see [Transfer Infrastructure](#transfer-infrastructure)
above. A `send`/download proposal is completely unaffected by P13; its
`folder_relative_path`/`shared_folder_id` (if any) are derived server-side
from the shared file's own folder membership, never supplied by the caller.

**Transfers** (persisted):

| Endpoint | Status codes | Caller |
|---|---|---|
| `GET /transfers` | 200 | Dual-audience |
| `GET /transfers/{id}` | 200, 404 | Dual-audience |
| `POST /transfers/{id}/cancel` | 200, 404, 409 | Dual-audience |

**Streaming** (bytes — [Streaming Engine](#streaming-engine)):

| Endpoint | Status codes | Caller |
|---|---|---|
| `GET /transfers/{id}/download` | 200, 400, 401, 404, 409 | Android |
| `POST /transfers/{id}/upload` | 200, 400, 401, 404, 409 | Android |

Unlike every other route in this router, these two are Android-only with no
desktop/loopback exemption (`CurrentDeviceDep`, not `RequestingDeviceDep`):
the desktop never calls them itself — it just reads or writes local disk,
since the backend is embedded in the desktop app. `409` covers both a
direction mismatch (e.g. calling `/download` on a `RECEIVE` transfer) and a
non-`in_progress` transfer; `400` covers a source file that is missing, has
changed type, or has changed size since the transfer was accepted
(download), or an upload that over/under-delivers relative to its declared
`file_size`.

Typical flow: Android proposes (`POST /transfers/requests`, auto-accepted,
creating the persisted `Transfer`) → Android streams bytes (`GET .../download`
or `POST .../upload`) → either side polls `GET /transfers/{id}` for progress
(`bytes_transferred`) until `status` reaches a terminal value.

## Discovery API

`app/api/v1/discovery.py` exposes one read-only route over
`DiscoveryService` (M13, see
[Device Discovery Infrastructure](#device-discovery-infrastructure)).

| Endpoint | Status codes | Caller |
|---|---|---|
| `GET /discovery/status` | 200 | Desktop |

It reports whether the broadcaster is actually running right now
(`broadcasting`), its per-process `instance_id`, and the port it broadcasts
on — useful for the desktop UI to show, e.g., "not discoverable" if socket
creation failed at startup. It adds no way to control discovery: that
remains `PATCH /settings` (`app_settings.discovery_enabled`), unchanged
from before this milestone.

## Structure

```text
backend/
├── app/
│   ├── main.py                 # FastAPI app instance, startup/shutdown, router + exception handler registration
│   ├── core/
│   │   ├── config.py            # Environment-driven settings (pydantic-settings)
│   │   ├── logging_config.py    # Logging setup (console + file handlers)
│   │   └── security.py          # generate_token()/hash_token() — shared by pairing + device secrets
│   ├── database/
│   │   ├── base.py              # Declarative Base and TimestampMixin
│   │   ├── session.py           # SQLAlchemy engine, session factory, get_db dependency, FK pragma
│   │   └── init_db.py           # Creates all tables (no Alembic in V1 yet)
│   ├── models/
│   │   ├── enums.py              # Platform, TransferDirection, TransferStatus + as_db_enum helper
│   │   ├── device.py              # Device
│   │   ├── device_session.py      # DeviceSession (table: sessions)
│   │   ├── shared_file.py         # SharedFile
│   │   ├── shared_folder.py       # SharedFolder (Milestone P13)
│   │   ├── transfer.py            # Transfer
│   │   └── app_settings.py        # AppSettings
│   ├── repositories/
│   │   ├── base_repository.py           # Generic get_by_id, shared by all repositories
│   │   ├── device_repository.py
│   │   ├── device_session_repository.py
│   │   ├── shared_file_repository.py
│   │   ├── shared_folder_repository.py  # (Milestone P13)
│   │   ├── transfer_repository.py
│   │   └── app_settings_repository.py
│   ├── services/
│   │   ├── exceptions.py              # NotFoundError, ValidationError, ConflictError, AuthenticationError (FastAPI-agnostic)
│   │   ├── device_service.py          # List/inspect/rename/remove/register paired devices
│   │   ├── app_settings_service.py    # Get/update the singleton settings row
│   │   ├── pairing_manager.py         # In-memory, lock-guarded pairing attempt store (singleton)
│   │   ├── pairing_service.py         # Pairing handshake workflow; exposed via app/api/v1/pairing.py
│   │   ├── auth_service.py            # Validates a DeviceSession bearer token
│   │   ├── shared_file_service.py     # Share/list/refresh/unshare the desktop's shared file list
│   │   ├── shared_folder_service.py   # Share/list/refresh/unshare a whole folder (Milestone P13)
│   │   ├── transfer_manager.py        # In-memory, lock-guarded pending-transfer-request store (singleton)
│   │   ├── upload_batch_registry.py   # In-memory, lock-guarded folder-upload root-name resolver (singleton, Milestone P13)
│   │   ├── transfer_service.py        # Transfer lifecycle: propose (auto-accepted)/cancel; exposed via app/api/v1/transfers.py
│   │   ├── transfer_stream_service.py # Streams bytes for an already-accepted transfer (Milestone 12)
│   │   ├── active_stream_registry.py  # In-memory guard: one active byte stream per transfer_id (singleton)
│   │   └── discovery_service.py       # Background UDP broadcaster singleton (Milestone 13)
│   ├── schemas/
│   │   ├── common.py            # ApiResponse — the shared response envelope
│   │   ├── device.py            # DeviceResponse, DeviceUpdateRequest
│   │   ├── settings.py          # SettingsResponse, SettingsUpdateRequest
│   │   ├── pairing.py           # PairingQrPayload, PairingStartResponse, PairingRequestSubmitRequest,
│   │   │                         # PairingPendingRequestResponse, PairingApproveRequest,
│   │   │                         # PairingRejectRequest, PairingResultResponse
│   │   ├── shared_file.py       # SharedFileResponse, AvailableFileResponse, ShareFileRequest
│   │   ├── shared_folder.py     # SharedFolderResponse, AvailableFolderResponse, ShareFolderRequest,
│   │   │                         # SharedFolderFileResponse, AvailableFolderFileResponse (Milestone P13)
│   │   ├── transfer.py          # TransferRequestCreate, TransferRequestResponse, TransferResponse
│   │   └── discovery.py         # DiscoveryAnnouncePayload (UDP), DiscoveryStatusResponse
│   ├── api/
│   │   ├── dependencies.py      # Service provider functions + Annotated Dep aliases
│   │   ├── responses.py         # success() helper for building ApiResponse envelopes
│   │   ├── exception_handlers.py # Service exception → HTTP response mapping (see above)
│   │   └── v1/                  # Versioned API routes (mounted at /api/v1)
│   │       ├── router.py         # Aggregates all v1 routers
│   │       ├── health.py         # GET /health
│   │       ├── settings.py       # GET/PATCH /settings
│   │       ├── devices.py        # GET /devices, GET/PATCH/DELETE /devices/{id}
│   │       ├── pairing.py        # POST /pairing/start, GET /pairing/pending/{token},
│   │       │                      # POST /pairing/request, POST /pairing/approve,
│   │       │                      # POST /pairing/reject, GET /pairing/result/{token}
│   │       ├── shared_files.py   # POST/GET /files, GET/POST(refresh)/DELETE /files/{id}
│   │       ├── folders.py        # POST/GET /folders, GET /folders/{id}/files,
│   │       │                      # GET/POST(refresh)/DELETE /folders/{id} (Milestone P13)
│   │       ├── transfers.py      # /transfers/requests..., /transfers..., /transfers/{id}/download|upload
│   │       └── discovery.py      # GET /discovery/status
│   └── utils/
│       ├── time.py              # utc_now() helper shared by models
│       ├── network.py           # get_local_ip_address(), get_broadcast_address() — desktop_ip for pairing QR + discovery broadcasts
│       └── filesystem.py        # Pure filesystem helpers: path validation, metadata stat, conflict-free
│                                 # renaming, recursive folder walk (walk_directory, Milestone P13)
└── tests/
    ├── api/                     # Route-level tests via FastAPI TestClient (in-memory SQLite)
    ├── services/                # Service-layer unit tests
    ├── repositories/            # Repository-layer unit tests
    ├── database/                # Constraint and cascade/set-null delete behavior
    ├── core/                    # Tests for app/core (security token generation/hashing)
    └── utils/                   # Tests for app/utils (filesystem helpers)
```

`app/websocket/` (mentioned in early planning, `docs/02_Architecture.md`
§11) is still not scaffolded — Version 1's real-time need is transfer
progress, which M12 covers by polling `GET /transfers/{id}` instead
(`docs/11_File_Transfer.md` §16 lists WebSockets as a future enhancement,
not a V1 requirement). It will be added when a milestone actually needs
it.

See `docs/13_Database_Design.md` for the full schema reference (tables,
relationships, constraints, and the reasoning behind them), and
`docs/05_API_Design.md` for the API conventions this layer follows.

## Running the backend

All commands below are run from the `backend/` directory.

1. Create and activate a virtual environment:

   ```bash
   python -m venv .venv
   .venv\Scripts\activate
   ```

2. Install dependencies (development, includes testing and linting tools):

   ```bash
   pip install -r ../requirements-dev.txt
   ```

3. Copy the environment template and adjust values if needed:

   ```bash
   copy .env.example .env
   ```

4. Start the development server:

   ```bash
   uvicorn app.main:app --reload
   ```

5. Verify the backend is running:

   * Health check: http://localhost:8000/api/v1/health
   * Settings: http://localhost:8000/api/v1/settings
   * Devices: http://localhost:8000/api/v1/devices
   * Shared files: http://localhost:8000/api/v1/files
   * Pairing: no plain GET link — start a pairing attempt via
     `POST /api/v1/pairing/start` (e.g. from Swagger UI) and follow the flow
     described in [Pairing API](#pairing-api)
   * Transfers: no plain GET link is interesting until a device is paired —
     follow the pairing flow above, then the propose (auto-accepted) →
     download/upload flow described in [Transfer API](#transfer-api)
   * Discovery status: http://localhost:8000/api/v1/discovery/status — the
     background broadcaster starts automatically with the app (see
     [Device Discovery Infrastructure](#device-discovery-infrastructure))
   * Swagger UI: http://localhost:8000/docs
   * ReDoc: http://localhost:8000/redoc

   Note: `/settings`, `/devices`, `/pairing`, and `/discovery` remain fully
   unauthenticated — the desktop's own Electron UI always calls them over
   loopback. `/files`, `/transfers/requests`, `/transfers`, and
   `/transfers/{id}/download|upload` enforce a `DeviceSession` bearer token
   (`AuthService`, M9) for any non-loopback caller — see
   [Authentication Infrastructure](#authentication-infrastructure) above.

## Running tests

```bash
python -m pytest
```

Use `python -m pytest`, not a bare `pytest` invocation — there is no
`pyproject.toml`/`pytest.ini` declaring `backend/` as the import root, and
`tests/` has no `__init__.py` files, so a bare `pytest` cannot resolve the
`app` and `tests` packages (`ModuleNotFoundError`). `python -m pytest` adds
the current directory to `sys.path` and works correctly.

API-layer tests (`tests/api/`) run against an isolated in-memory SQLite
database per test (via a `client` fixture in `tests/api/conftest.py`), so
they never touch the real `relay.db` file.

## Linting

```bash
ruff check app tests
```
