"""Aggregates all v1 API routes."""

from fastapi import APIRouter

from app.api.v1.devices import router as devices_router
from app.api.v1.health import router as health_router
from app.api.v1.settings import router as settings_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["Health"])
api_router.include_router(settings_router, prefix="/settings", tags=["Settings"])
api_router.include_router(devices_router, prefix="/devices", tags=["Devices"])
