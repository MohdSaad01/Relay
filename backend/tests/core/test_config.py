"""Tests for backend configuration defaults, particularly RELAY_DATA_DIR
handling (T8: packaged backend must not write user data into its own
install directory — see docs/12_Packaging_Deployment.md, "Windows Data
Storage")."""

import pytest

from app.core.config import Settings, _default_database_url, _default_log_dir


def test_default_database_url_without_relay_data_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RELAY_DATA_DIR", raising=False)

    assert _default_database_url() == "sqlite:///./relay.db"


def test_default_log_dir_without_relay_data_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RELAY_DATA_DIR", raising=False)

    assert _default_log_dir() == "logs"


def test_default_database_url_uses_relay_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("RELAY_DATA_DIR", str(tmp_path))

    assert _default_database_url() == f"sqlite:///{tmp_path.as_posix()}/relay.db"


def test_default_log_dir_uses_relay_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("RELAY_DATA_DIR", str(tmp_path))

    assert _default_log_dir() == str(tmp_path / "logs")


def test_explicit_database_url_overrides_relay_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("RELAY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATABASE_URL", "sqlite:///explicit.db")

    settings = Settings(_env_file=None)

    assert settings.DATABASE_URL == "sqlite:///explicit.db"


def test_explicit_log_dir_overrides_relay_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("RELAY_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("LOG_DIR", "explicit-logs")

    settings = Settings(_env_file=None)

    assert settings.LOG_DIR == "explicit-logs"


def test_settings_uses_relay_data_dir_when_no_explicit_override(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("LOG_DIR", raising=False)
    monkeypatch.setenv("RELAY_DATA_DIR", str(tmp_path))

    settings = Settings(_env_file=None)

    assert settings.DATABASE_URL == f"sqlite:///{tmp_path.as_posix()}/relay.db"
    assert settings.LOG_DIR == str(tmp_path / "logs")
