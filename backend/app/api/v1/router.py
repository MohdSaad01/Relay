"""Aggregates all v1 API routes."""

from fastapi import APIRouter

from app.api.v1.devices import router as devices_router
from app.api.v1.health import router as health_router
from app.api.v1.pairing import router as pairing_router
from app.api.v1.settings import router as settings_router
from app.api.v1.shared_files import router as shared_files_router
from app.api.v1.transfers import router as transfers_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["Health"])
api_router.include_router(settings_router, prefix="/settings", tags=["Settings"])
api_router.include_router(devices_router, prefix="/devices", tags=["Devices"])
api_router.include_router(pairing_router, prefix="/pairing", tags=["Pairing"])
api_router.include_router(shared_files_router, prefix="/files", tags=["Shared Files"])
api_router.include_router(transfers_router, prefix="/transfers", tags=["Transfers"])
