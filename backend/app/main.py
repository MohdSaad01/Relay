"""Relay backend application entry point."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.exception_handlers import register_exception_handlers
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging_config import configure_logging
from app.services.discovery_service import get_discovery_service

settings = get_settings()
configure_logging(settings)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Log application startup/shutdown and run the discovery broadcaster."""
    logger.info("Relay backend starting up.")
    discovery_service = get_discovery_service()
    discovery_service.start()
    yield
    discovery_service.stop()
    logger.info("Relay backend shutting down.")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.API_V1_PREFIX)
