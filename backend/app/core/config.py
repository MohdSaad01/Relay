"""Application configuration loaded from environment variables."""

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_database_url() -> str:
    """Default DATABASE_URL: under RELAY_DATA_DIR when set, else today's
    dev-mode relative path (docs/12_Packaging_Deployment.md, "Windows Data
    Storage": user data belongs in the local app data directory, separate
    from application binaries). The packaged desktop app sets RELAY_DATA_DIR
    to Electron's `app.getPath("userData")`; nothing sets it in dev, so
    local development is unaffected. An explicit DATABASE_URL (env var or
    .env) always takes priority over this default.
    """
    data_dir = os.environ.get("RELAY_DATA_DIR")
    if data_dir:
        return f"sqlite:///{(Path(data_dir) / 'relay.db').as_posix()}"
    return "sqlite:///./relay.db"


def _default_log_dir() -> str:
    """Default LOG_DIR, mirroring `_default_database_url`'s RELAY_DATA_DIR handling."""
    data_dir = os.environ.get("RELAY_DATA_DIR")
    if data_dir:
        return str(Path(data_dir) / "logs")
    return "logs"


class Settings(BaseSettings):
    """Runtime configuration for the Relay backend."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "Relay"
    APP_VERSION: str = "0.1.0"
    API_V1_PREFIX: str = "/api/v1"

    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True

    DATABASE_URL: str = Field(default_factory=_default_database_url)

    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = Field(default_factory=_default_log_dir)

    # Pairing (10_Security.md §6): short-lived, single-use handshake tokens.
    # A security parameter, not a user-editable preference, so it lives here
    # rather than in the app_settings table.
    PAIRING_TOKEN_TTL_SECONDS: int = 300
    PAIRING_PROTOCOL_VERSION: int = 1

    # Transfer requests (11_File_Transfer.md §7, 13_Database_Design.md §7): how
    # long a proposed transfer may wait for the desktop user's decision before
    # it is treated as expired. A security/UX parameter, not a user-editable
    # preference, so it lives here rather than in the app_settings table —
    # mirrors PAIRING_TOKEN_TTL_SECONDS above.
    TRANSFER_REQUEST_TTL_SECONDS: int = 120

    # Streaming Engine (11_File_Transfer.md §8, Milestone 12): chunk size used
    # for both reading a file to stream (download) and writing an incoming
    # stream to disk (upload). A performance/technical parameter, not a
    # user-editable preference, so it lives here rather than in app_settings.
    STREAM_CHUNK_SIZE_BYTES: int = 1_048_576  # 1 MiB

    # Device Discovery (09_Networking.md §4, Milestone 13): the desktop
    # broadcasts a periodic UDP announcement so nearby Android devices can
    # find it without manual configuration. Static deployment/protocol
    # parameters, not user-editable preferences — mirrors
    # PAIRING_TOKEN_TTL_SECONDS above. Whether broadcasting happens at all is
    # controlled separately by the user-editable app_settings.discovery_enabled
    # flag, not by anything here.
    DISCOVERY_PORT: int = 40890
    DISCOVERY_BROADCAST_INTERVAL_SECONDS: int = 2
    DISCOVERY_PROTOCOL_VERSION: int = 1


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance shared across the application."""
    return Settings()
