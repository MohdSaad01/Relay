"""Relay backend application entry point."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.exception_handlers import register_exception_handlers
from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging_config import configure_logging
from app.database.init_db import init_db
from app.database.session import SessionLocal
from app.services.active_stream_registry import get_active_stream_registry
from app.services.discovery_service import get_discovery_service
from app.services.transfer_manager import get_transfer_manager
from app.services.transfer_service import TransferService
from app.services.transfer_stream_service import TransferStreamService

settings = get_settings()
configure_logging(settings)

logger = logging.getLogger(__name__)


def _reconcile_after_unclean_shutdown() -> None:
    """Sweep state an unclean shutdown could have left behind (docs/09_Networking.md
    §9: "gracefully handle... backend restarts") before serving any request.

    Runs in its own short-lived session, the same pattern DiscoveryService
    uses for its background ticks — this happens outside any request scope.
    """
    db = SessionLocal()
    try:
        TransferService(db, get_transfer_manager()).reconcile_interrupted_transfers()
        TransferStreamService(db, get_active_stream_registry()).cleanup_orphaned_upload_temp_files()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Log application startup/shutdown and run the discovery broadcaster."""
    logger.info("Relay backend starting up.")
    init_db()
    _reconcile_after_unclean_shutdown()
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
