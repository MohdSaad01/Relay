"""FastAPI dependency providers for the Service Layer."""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.services.app_settings_service import AppSettingsService
from app.services.device_service import DeviceService
from app.services.pairing_manager import PairingManager
from app.services.pairing_manager import get_pairing_manager as _get_pairing_manager
from app.services.pairing_service import PairingService


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


AppSettingsServiceDep = Annotated[AppSettingsService, Depends(get_app_settings_service)]
DeviceServiceDep = Annotated[DeviceService, Depends(get_device_service)]
PairingServiceDep = Annotated[PairingService, Depends(get_pairing_service)]
