# Relay Backend

FastAPI backend for Relay. See `/docs` at the repository root for the full
project specification.

## Structure

```text
backend/
├── app/
│   ├── main.py              # FastAPI app instance, startup/shutdown, router registration
│   ├── core/
│   │   ├── config.py         # Environment-driven settings (pydantic-settings)
│   │   └── logging_config.py # Logging setup (console + file handlers)
│   ├── database/
│   │   ├── base.py           # Declarative Base and TimestampMixin
│   │   ├── session.py        # SQLAlchemy engine, session factory, get_db dependency, FK pragma
│   │   └── init_db.py        # Creates all tables (no Alembic in V1 yet)
│   ├── models/
│   │   ├── enums.py           # Platform, TransferDirection, TransferStatus + as_db_enum helper
│   │   ├── device.py          # Device
│   │   ├── device_session.py  # DeviceSession (table: sessions)
│   │   ├── shared_file.py     # SharedFile
│   │   ├── transfer.py        # Transfer
│   │   └── app_settings.py    # AppSettings
│   ├── utils/
│   │   └── time.py           # utc_now() helper shared by models
│   ├── api/
│   │   └── v1/                # Versioned API routes (mounted at /api/v1)
│   │       ├── router.py      # Aggregates all v1 routers
│   │       └── health.py      # GET /health
│   └── schemas/
│       └── common.py         # Shared Pydantic response models (ApiResponse)
└── tests/
    ├── api/
    │   └── test_health.py    # Tests for the health endpoint
    └── database/
        └── test_database_models.py  # Constraint and cascade/set-null delete behavior
```

Folders such as `services/`, `repositories/`, and `websocket/` (described in
`docs/04_Project_Structure.md`) will be added in later milestones when they
have actual content — they are intentionally not scaffolded empty.

See `docs/13_Database_Design.md` for the full schema reference (tables,
relationships, constraints, and the reasoning behind them).

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
   * Swagger UI: http://localhost:8000/docs
   * ReDoc: http://localhost:8000/redoc

## Running tests

```bash
pytest
```
