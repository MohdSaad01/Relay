"""FastAPI dependency providers for the Service Layer."""

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.models.device import Device
from app.services.active_stream_registry import ActiveStreamRegistry
from app.services.active_stream_registry import (
    get_active_stream_registry as _get_active_stream_registry,
)
from app.services.app_settings_service import AppSettingsService
from app.services.auth_service import AuthService
from app.services.device_service import DeviceService
from app.services.discovery_service import DiscoveryService
from app.services.discovery_service import (
    get_discovery_service as _get_discovery_service,
)
from app.services.pairing_manager import PairingManager
from app.services.pairing_manager import get_pairing_manager as _get_pairing_manager
from app.services.pairing_service import PairingService
from app.services.shared_file_service import SharedFileService
from app.services.transfer_manager import TransferManager
from app.services.transfer_manager import get_transfer_manager as _get_transfer_manager
from app.services.transfer_service import TransferService
from app.services.transfer_stream_service import TransferStreamService

_bearer_scheme = HTTPBearer(auto_error=False)

# The backend runs embedded in the desktop application (13_Database_Design.md
# §9), so the desktop's own Electron UI always calls it over loopback, even
# though the server also binds 0.0.0.0 for Android reachability over LAN.
_LOOPBACK_HOSTS = {"127.0.0.1", "::1"}


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


def get_shared_file_service(db: Annotated[Session, Depends(get_db)]) -> SharedFileService:
    """Provide a SharedFileService bound to a request-scoped database session."""
    return SharedFileService(db)


def get_transfer_manager() -> TransferManager:
    """Provide the process-wide TransferManager singleton (app/services/transfer_manager.py)."""
    return _get_transfer_manager()


def get_transfer_service(
    db: Annotated[Session, Depends(get_db)],
    transfer_manager: Annotated[TransferManager, Depends(get_transfer_manager)],
) -> TransferService:
    """Provide a TransferService bound to a request-scoped database session and the shared TransferManager."""
    return TransferService(db, transfer_manager)


def get_active_stream_registry() -> ActiveStreamRegistry:
    """Provide the process-wide ActiveStreamRegistry singleton (app/services/active_stream_registry.py)."""
    return _get_active_stream_registry()


def get_transfer_stream_service(
    db: Annotated[Session, Depends(get_db)],
    active_stream_registry: Annotated[ActiveStreamRegistry, Depends(get_active_stream_registry)],
) -> TransferStreamService:
    """Provide a TransferStreamService bound to a request-scoped database session and the shared ActiveStreamRegistry."""
    return TransferStreamService(db, active_stream_registry)


def get_discovery_service() -> DiscoveryService:
    """Provide the process-wide DiscoveryService singleton (app/services/discovery_service.py)."""
    return _get_discovery_service()


def get_current_device(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> Device:
    """Resolve the paired Device for the request's `Authorization: Bearer` token.

    Add `Depends(get_current_device)` to a router/route to require a valid
    device session (10_Security.md §7-9).
    """
    token = credentials.credentials if credentials else None
    return auth_service.authenticate(token)


def _is_loopback_request(request: Request) -> bool:
    return request.client is not None and request.client.host in _LOOPBACK_HOSTS


def get_requesting_device(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)],
    auth_service: Annotated[AuthService, Depends(get_auth_service)],
) -> Device | None:
    """Resolve the caller of a dual-audience endpoint (e.g. `GET /files`, the
    `/transfers` and `/transfers/requests` routes).

    Returns None for the trusted local desktop caller — the desktop can
    never hold a DeviceSession, since `devices.platform` is Android-only
    (app/models/enums.py) — identified by the request arriving over
    loopback. Otherwise delegates to `get_current_device`, so any other,
    LAN-originating caller must present a valid session token under
    exactly the same rules as a fully protected endpoint (10_Security.md
    §3: unauthorized LAN devices must not be able to browse the shared
    file list).
    """
    if _is_loopback_request(request):
        return None
    return get_current_device(credentials, auth_service)


AppSettingsServiceDep = Annotated[AppSettingsService, Depends(get_app_settings_service)]
DeviceServiceDep = Annotated[DeviceService, Depends(get_device_service)]
PairingServiceDep = Annotated[PairingService, Depends(get_pairing_service)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]
SharedFileServiceDep = Annotated[SharedFileService, Depends(get_shared_file_service)]
TransferServiceDep = Annotated[TransferService, Depends(get_transfer_service)]
TransferStreamServiceDep = Annotated[TransferStreamService, Depends(get_transfer_stream_service)]
DiscoveryServiceDep = Annotated[DiscoveryService, Depends(get_discovery_service)]
CurrentDeviceDep = Annotated[Device, Depends(get_current_device)]
RequestingDeviceDep = Annotated[Device | None, Depends(get_requesting_device)]
