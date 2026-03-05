"""
Automatic SQL migration runner.

On startup, scans palpal-conductor/migrations/*.sql in alphabetical order,
checks which files have already been recorded in the schema_migrations table,
and applies any that are pending — in order, inside a transaction.

All migration files should be written idempotently (IF NOT EXISTS, IF EXISTS,
DROP ... IF EXISTS, etc.) so that partial failures can be safely retried by
just restarting the conductor.
"""

import logging
from pathlib import Path

import db

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


async def run_migrations() -> None:
    pool = db.get_pool()

    # Ensure the tracking table exists (safe to run every time)
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name       TEXT        PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    migration_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not migration_files:
        logger.info("Migrations: no files found in %s", MIGRATIONS_DIR)
        return

    rows = await pool.fetch("SELECT name FROM schema_migrations")
    applied = {row["name"] for row in rows}

    pending = [f for f in migration_files if f.name not in applied]

    if not pending:
        logger.info("Migrations: all %d up to date", len(migration_files))
        return

    logger.info("Migrations: %d pending — %s", len(pending), [f.name for f in pending])

    for migration_file in pending:
        sql = migration_file.read_text()
        logger.info("Applying migration: %s", migration_file.name)
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute(sql)
                    await conn.execute(
                        "INSERT INTO schema_migrations (name) VALUES ($1)",
                        migration_file.name,
                    )
            logger.info("Migration applied:  %s", migration_file.name)
        except Exception as exc:
            logger.error("Migration FAILED:   %s — %s", migration_file.name, exc)
            raise
