from __future__ import annotations

import asyncio
import logging
import time

import asyncpg

from .config import settings

log = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


async def connect(timeout_seconds: float = 120.0) -> asyncpg.Pool:
    """Waits for the database rather than exiting if it is not up yet.

    Postgres and the API start together, and the API usually wins. Failing outright
    turns an ordinary few-second race into a CrashLoopBackOff that clears itself but
    looks alarming in `kubectl get pods` long afterwards.
    """
    global _pool
    if _pool is None:
        _pool = await _create_pool_with_retry(timeout_seconds)
    return _pool


async def _create_pool_with_retry(timeout_seconds: float) -> asyncpg.Pool:
    deadline = time.monotonic() + timeout_seconds
    delay = 1.0
    while True:
        try:
            return await _create_pool()
        except (OSError, asyncpg.PostgresError) as exc:
            if time.monotonic() >= deadline:
                log.error("database unreachable after %.0fs: %s", timeout_seconds, exc)
                raise
            log.info("waiting for the database (%s)", exc)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10.0)


async def _create_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=settings.database_pool_min,
        max_size=settings.database_pool_max,
        command_timeout=settings.database_statement_timeout_ms / 1000,
        server_settings={
            "statement_timeout": str(settings.database_statement_timeout_ms),
            "application_name": "copperkeep-api",
        },
    )


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("database pool not initialised")
    return _pool
