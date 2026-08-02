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


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance shared across the application."""
    return Settings()
