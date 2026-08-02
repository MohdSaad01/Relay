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

A new resource gets its own router module in `app/api/v1/`, included in
`router.py` — routers are never nested arbitrarily deep, matching one file
per resource.

### Dependency injection

`app/api/dependencies.py` provides one function per service
(`get_app_settings_service`, `get_device_service`, `get_pairing_service`),
each depending on `get_db` (`app/database/session.py`) for a request-scoped
SQLAlchemy `Session`. `get_pairing_service` additionally depends on
`get_pairing_manager`, a thin wrapper around the process-wide
`PairingManager` singleton (`app/services/pairing_manager.py`) — the one
service dependency that isn't purely `Session`-scoped, since pairing state
lives outside the database by design (`docs/13_Database_Design.md` §9).
Routes consume these through `Annotated` type aliases
(`AppSettingsServiceDep`, `DeviceServiceDep`, `PairingServiceDep`) rather
than `= Depends(...)` default values, e.g.:

```python
def get_device(device_id: int, service: DeviceServiceDep) -> ApiResponse:
    ...
```

This keeps routes free of any direct `Session` or repository knowledge, and
is the ruff-clean form of the pattern (`Depends(...)` as an argument default
triggers the bugbear `B008` rule).

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

`DELETE` endpoints are the one exception — they return `204 No Content` with
an empty body, per HTTP semantics and `docs/05_API_Design.md` §7.

### Exception handling

`app/api/exception_handlers.py` registers centralized handlers on the
FastAPI app (wired up in `main.py`) so routes never need their own
try/except blocks:

| Exception | HTTP Status | Logged at |
|---|---|---|
| `NotFoundError` | 404 | — |
| `ValidationError` | 400 | `INFO` |
| `ConflictError` | 409 | `WARNING` |
| `RequestValidationError` (Pydantic/FastAPI) | 422 | — |
| Any other unhandled `Exception` | 500 | `ERROR` (with traceback) |

All error responses use the same `ApiResponse` envelope (`success: false`,
`data: null`), so clients only ever handle one response shape.

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
│   │   ├── transfer.py            # Transfer
│   │   └── app_settings.py        # AppSettings
│   ├── repositories/
│   │   ├── base_repository.py           # Generic get_by_id, shared by all repositories
│   │   ├── device_repository.py
│   │   ├── device_session_repository.py
│   │   ├── shared_file_repository.py
│   │   ├── transfer_repository.py
│   │   └── app_settings_repository.py
│   ├── services/
│   │   ├── exceptions.py           # NotFoundError, ValidationError, ConflictError (FastAPI-agnostic)
│   │   ├── device_service.py       # List/inspect/rename/remove/register paired devices
│   │   ├── app_settings_service.py # Get/update the singleton settings row
│   │   ├── pairing_manager.py      # In-memory, lock-guarded pairing attempt store (singleton)
│   │   └── pairing_service.py      # Pairing handshake workflow; exposed via app/api/v1/pairing.py
│   ├── schemas/
│   │   ├── common.py            # ApiResponse — the shared response envelope
│   │   ├── device.py            # DeviceResponse, DeviceUpdateRequest
│   │   ├── settings.py          # SettingsResponse, SettingsUpdateRequest
│   │   └── pairing.py           # PairingQrPayload, PairingStartResponse, PairingRequestSubmitRequest,
│   │                             # PairingPendingRequestResponse, PairingApproveRequest,
│   │                             # PairingRejectRequest, PairingResultResponse
│   ├── api/
│   │   ├── dependencies.py      # Service provider functions + Annotated Dep aliases
│   │   ├── responses.py         # success() helper for building ApiResponse envelopes
│   │   ├── exception_handlers.py # Service exception → HTTP response mapping (see above)
│   │   └── v1/                  # Versioned API routes (mounted at /api/v1)
│   │       ├── router.py         # Aggregates all v1 routers
│   │       ├── health.py         # GET /health
│   │       ├── settings.py       # GET/PATCH /settings
│   │       ├── devices.py        # GET /devices, GET/PATCH/DELETE /devices/{id}
│   │       └── pairing.py        # POST /pairing/start, GET /pairing/pending/{token},
│   │                              # POST /pairing/request, POST /pairing/approve,
│   │                              # POST /pairing/reject, GET /pairing/result/{token}
│   └── utils/
│       ├── time.py              # utc_now() helper shared by models
│       └── network.py           # get_local_ip_address() — for the pairing QR's desktop_ip
└── tests/
    ├── api/                     # Route-level tests via FastAPI TestClient (in-memory SQLite)
    ├── services/                # Service-layer unit tests
    ├── repositories/            # Repository-layer unit tests
    ├── database/                # Constraint and cascade/set-null delete behavior
    └── core/                    # Tests for app/core (security token generation/hashing)
```

`app/websocket/` (described in `docs/04_Project_Structure.md`) will be added
in the Transfers milestone, when it has actual content — it is intentionally
not scaffolded empty.

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
   * Pairing: no plain GET link — start a pairing attempt via
     `POST /api/v1/pairing/start` (e.g. from Swagger UI) and follow the flow
     described in [Pairing API](#pairing-api)
   * Swagger UI: http://localhost:8000/docs
   * ReDoc: http://localhost:8000/redoc

   Note: `/settings`, `/devices`, and `/pairing` are all unauthenticated in
   this milestone — authentication has not been implemented yet (see
   `docs/10_Security.md`).

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
