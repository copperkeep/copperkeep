"""Migration runner.

Runs as a Helm `pre-upgrade` Job and as a Compose one-shot — never on API startup,
or deploy order and replica count start mattering (coupling rule 4, §9.1).
"""

from __future__ import annotations

import asyncio
import logging
import sys
import time
from pathlib import Path

import asyncpg

from .config import settings

log = logging.getLogger("copperkeep.migrate")

_DEFAULT_DIR = Path(__file__).resolve().parent.parent / "migrations"
MIGRATIONS_DIR = Path(settings.migrations_dir) if settings.migrations_dir else _DEFAULT_DIR


async def connect_with_retry(timeout_seconds: float = 120.0) -> asyncpg.Connection:
    """Waits for the database instead of assuming it is up.

    On a fresh install this Job can start while Postgres is still accepting no
    connections, and on an upgrade the primary may be briefly unavailable. Failing
    immediately would surface as a mysterious install timeout.
    """
    deadline = time.monotonic() + timeout_seconds
    delay = 1.0
    while True:
        try:
            return await asyncpg.connect(settings.database_url)
        except (OSError, asyncpg.PostgresError) as exc:
            if time.monotonic() >= deadline:
                log.error("database unreachable after %.0fs: %s", timeout_seconds, exc)
                raise
            log.info("waiting for the database (%s)", exc)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 10.0)


async def run() -> None:
    conn = await connect_with_retry()
    try:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        applied = {
            r["filename"] for r in await conn.fetch("SELECT filename FROM schema_migrations")
        }
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            log.info("applying %s", path.name)
            async with conn.transaction():
                await conn.execute(path.read_text())
                await conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES ($1)", path.name
                )
        log.info("migrations up to date")
    finally:
        await conn.close()


def main() -> int:
    logging.basicConfig(level=settings.log_level, format="%(levelname)s %(message)s")
    asyncio.run(run())
    return 0


if __name__ == "__main__":
    sys.exit(main())
