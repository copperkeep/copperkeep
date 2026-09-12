"""Migration runner.

Runs as a Helm `pre-upgrade` Job and as a Compose one-shot — never on API startup,
or deploy order and replica count start mattering (coupling rule 4, §9.1).
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

import asyncpg

from .config import settings

log = logging.getLogger("copperkeep.migrate")

_DEFAULT_DIR = Path(__file__).resolve().parent.parent / "migrations"
MIGRATIONS_DIR = Path(settings.migrations_dir) if settings.migrations_dir else _DEFAULT_DIR


async def run() -> None:
    conn = await asyncpg.connect(settings.database_url)
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
