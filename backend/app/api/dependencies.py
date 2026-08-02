"""FastAPI dependency providers for the Service Layer."""

from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.device import Device
from app.services.app_settings_service import AppSettingsService
from app.services.auth_service import AuthService
from app.services.device_service import DeviceService
from app.services.pairing_manager import PairingManager
from app.services.pairing_manager import get_pairing_manager as _get_pairing_manager
from app.services.pairing_service import PairingService

_bearer_scheme = HTTPBearer(auto_error=False)


def get_app_settings_service(db: Annotated[Session, Depends(get_db)]) -> AppSettingsService:
    """Provide an AppSettingsService bound to a request-scoped database session."""
    return AppSettingsService(db)


def get_device_service(db: Annotated[Session, Depends(get_db)]) -> DeviceService:
    """Provide a DeviceService bound to a request-scoped database session."""
    return DeviceService(db)


def get_pairing_manager() -> PairingManager:
    """Provide the process-wide PairingManager singleton (app/services/pairing_manager.py)."""
    return _get_pairing_manager()


def get_pairing_service(
    db: Annotated[Session, Depends(get_db)],
    pairing_manager: Annotated[PairingManager, Depends(get_pairing_manager)],
) -> PairingService:
    """Provide a PairingService bound to a request-scoped database session and the shared PairingManager."""
    return PairingService(db, pairing_manager)


def get_auth_service(db: Annotated[Session, Depends(get_db)]) -> AuthService:
    """Provide an AuthService bound to a request-scoped database session."""
    return AuthService(db)


def get_current_device(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> Device:
    """Resolve the paired Device for the request's `Authorization: Bearer` token.

    Add `Depends(get_current_device)` to a router/route to require a valid
    device session (10_Security.md §7-9). Not yet attached to any router —
    see CLAUDE.md M9 notes.
    """
    token = credentials.credentials if credentials else None
    return auth_service.authenticate(token)


AppSettingsServiceDep = Annotated[AppSettingsService, Depends(get_app_settings_service)]
DeviceServiceDep = Annotated[DeviceService, Depends(get_device_service)]
PairingServiceDep = Annotated[PairingService, Depends(get_pairing_service)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
CurrentDeviceDep = Annotated[Device, Depends(get_current_device)]
