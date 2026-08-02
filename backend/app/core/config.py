"""Application configuration loaded from environment variables."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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

    DATABASE_URL: str = "sqlite:///./relay.db"

    LOG_LEVEL: str = "INFO"
    LOG_DIR: str = "logs"

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


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance shared across the application."""
    return Settings()
