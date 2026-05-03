"""One-shot data migration from a local SQLite file to a Turso (libSQL) DB.

Usage (from the `backend/` directory, with the venv activated):

    SOURCE_URL="sqlite:///./finance.db" \
    TARGET_URL="sqlite+libsql://<host>?authToken=<JWT>&secure=true" \
    python scripts/migrate_to_turso.py

The script:
  1. Connects to both databases.
  2. Creates the schema on the target via SQLAlchemy `Base.metadata.create_all`.
  3. For each table, copies every row verbatim (including primary keys).
  4. Refuses to run if the target already has user data, so re-runs are safe
     unless you pass `--force`.

Run once. After it succeeds, set the deployed backend's `DATABASE_URL` to the
target URL and you're done.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Make `app` importable when this script is run from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import Base  # noqa: E402  — registers all tables on import.
from app import models  # noqa: F401, E402  — ensures every model is mapped.


# Order matters for FK-respecting inserts even if SQLite doesn't enforce them
# by default — keep it tidy in case the target ever flips on enforcement.
TABLE_ORDER = [
    "users",
    "accounts",
    "categories",
    "transactions",  # self-FK via refund_for_id; see note below
    "budgets",
    "investment_holdings",
    "geocode_cache",
    "csv_imports",
    "recurring_classifications",
    "savings_goals",
    "chat_sessions",
    "custom_tools",
    "chat_messages",
]


def _build_engine(url: str):
    if url.startswith("sqlite+libsql"):
        return create_engine(url, future=True, pool_pre_ping=True)
    if url.startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False}, future=True)
    return create_engine(url, future=True, pool_pre_ping=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Wipe the target tables before copying. Without this, the script "
        "refuses to run if the target already contains user data.",
    )
    args = parser.parse_args()

    source_url = os.environ.get("SOURCE_URL", "sqlite:///./finance.db")
    target_url = os.environ.get("TARGET_URL")
    if not target_url:
        print("ERROR: TARGET_URL env var is required.", file=sys.stderr)
        print("  e.g. sqlite+libsql://<host>?authToken=<JWT>&secure=true", file=sys.stderr)
        return 2

    print(f"Source: {source_url}")
    print(f"Target: {target_url.split('?')[0]}?…")

    src = _build_engine(source_url)
    dst = _build_engine(target_url)

    print("Creating schema on target…")
    Base.metadata.create_all(bind=dst)

    # Sanity: warn / abort if target already populated.
    with Session(dst) as s:
        existing_users = s.execute(select(models.User)).first()
    if existing_users and not args.force:
        print(
            "ERROR: target already contains a `users` row. "
            "Re-run with --force to wipe-and-reload.",
            file=sys.stderr,
        )
        return 1

    if args.force:
        print("Wiping target tables (in reverse FK order)…")
        with dst.begin() as conn:
            for table_name in reversed(TABLE_ORDER):
                tbl = Base.metadata.tables[table_name]
                conn.execute(tbl.delete())

    # Copy each table.
    total = 0
    with src.connect() as src_conn, dst.begin() as dst_conn:
        for table_name in TABLE_ORDER:
            tbl = Base.metadata.tables[table_name]
            rows = [dict(r._mapping) for r in src_conn.execute(select(tbl)).all()]
            if not rows:
                print(f"  {table_name}: empty")
                continue
            dst_conn.execute(tbl.insert(), rows)
            print(f"  {table_name}: {len(rows)} rows")
            total += len(rows)

    print(f"Done. Copied {total} rows across {len(TABLE_ORDER)} tables.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
