from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from . import db, metrics
from .config import settings
from .content import index
from .routers import admin, auth, learn, reports
from .security import hash_secret

log = logging.getLogger(__name__)


async def _refresh_content_forever() -> None:
    while True:
        await asyncio.sleep(settings.content_refresh_seconds)
        ok = await index.refresh()
        metrics.content_loaded.set(1 if index.loaded else 0)
        if not ok:
            log.warning("content still unreachable; continuing on the last-good copy")


async def _bootstrap_org() -> None:
    """First boot only. Never touches an existing org, never overwrites a password."""
    if not settings.bootstrap_admin_password:
        return
    existing = await db.pool().fetchval("SELECT 1 FROM orgs LIMIT 1")
    if existing:
        return
    async with db.pool().acquire() as conn:
        async with conn.transaction():
            org_id = await conn.fetchval(
                "INSERT INTO orgs (slug, name) VALUES ($1, $2) RETURNING id",
                settings.bootstrap_org_slug,
                settings.bootstrap_org_name,
            )
            await conn.execute(
                """
                INSERT INTO users (org_id, username, display_name, role, password_hash,
                                   reading_tier, theme)
                VALUES ($1, $2, $2, 'adult', $3, 'adult', 'dark')
                """,
                org_id,
                settings.bootstrap_admin_username,
                hash_secret(settings.bootstrap_admin_password),
            )
    log.info("bootstrapped org %s with adult %s", settings.bootstrap_org_slug,
             settings.bootstrap_admin_username)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(
        level=settings.log_level,
        format='{"level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
    )
    await db.connect()
    await _bootstrap_org()
    await index.refresh()
    metrics.content_loaded.set(1 if index.loaded else 0)
    refresher = asyncio.create_task(_refresh_content_forever())
    try:
        yield
    finally:
        refresher.cancel()
        await db.disconnect()


app = FastAPI(
    title="Copperkeep API",
    version=settings.app_version,
    lifespan=lifespan,
    # Sessions are httpOnly, Secure, SameSite=Strict cookies. The single origin makes
    # this CSRF-safe without tokens, and there is no CORS middleware here on purpose:
    # a second browser-facing origin would break cross-origin isolation (§3.1).
)

app.include_router(auth.router)
app.include_router(learn.router)
app.include_router(reports.router)
app.include_router(admin.router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict[str, str]:
    return {"status": "ok", "version": settings.app_version}


@app.get("/readyz", include_in_schema=False)
async def readyz(response: Response) -> dict[str, object]:
    """Ready means: the database answers and the loaded curriculum is compatible.

    A `minAppVersion` mismatch fails this probe, so a bad content release never goes
    live (§11.1).
    """
    try:
        await db.pool().fetchval("SELECT 1")
        database_ok = True
    except Exception:  # noqa: BLE001
        database_ok = False

    ready = database_ok and index.loaded and index.compatible
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "ready": ready,
        "database": database_ok,
        "contentLoaded": index.loaded,
        "contentVersion": index.content_version,
        "contentCompatible": index.compatible,
    }


@app.get("/metrics", include_in_schema=False)
async def prometheus_metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
