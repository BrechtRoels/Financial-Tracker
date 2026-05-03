from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


def _build_engine():
    """Build a SQLAlchemy engine that works for plain SQLite *and* libSQL/Turso.

    A Turso URL looks like:
        sqlite+libsql://<host>?authToken=<JWT>&secure=true
    The `sqlalchemy-libsql` driver handles the network layer; we still get a
    SQLite-compatible dialect so all our existing queries (`strftime`, `iif`,
    `PRAGMA table_info`) keep working.
    """
    url = settings.database_url
    if url.startswith("sqlite+libsql"):
        # Network DB — no thread-safety arg, no PRAGMA hack needed.
        return create_engine(url, future=True, pool_pre_ping=True)
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            future=True,
        )
    return create_engine(url, future=True, pool_pre_ping=True)


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


# Lightweight forward-only migrations for SQLite. Each entry is
# (table, column_name, full ALTER COLUMN DDL fragment). Runs on startup and
# only adds columns that don't already exist, keeping the user's data intact.
_SCHEMA_ADDITIONS: list[tuple[str, str, str]] = [
    ("accounts", "iban", "iban VARCHAR(34)"),
    ("transactions", "import_hash", "import_hash VARCHAR(64)"),
    ("transactions", "counterparty_iban", "counterparty_iban VARCHAR(34)"),
    ("transactions", "counterparty_name", "counterparty_name VARCHAR(120)"),
    ("custom_tools", "kind", "kind VARCHAR(40) DEFAULT 'sql_rows'"),
    ("custom_tools", "config_json", "config_json VARCHAR"),
    ("chat_messages", "images_json", "images_json VARCHAR"),
    ("transactions", "location_city", "location_city VARCHAR(80)"),
    ("transactions", "location_country", "location_country VARCHAR(4)"),
    ("transactions", "merchant", "merchant VARCHAR(120)"),
    ("investment_holdings", "last_price_eur", "last_price_eur FLOAT"),
    ("investment_holdings", "last_fx_rate", "last_fx_rate FLOAT"),
    ("accounts", "logo_url", "logo_url VARCHAR(500)"),
    ("transactions", "refund_for_id", "refund_for_id INTEGER REFERENCES transactions(id)"),
]


def ensure_schema() -> None:
    """Add any missing columns without touching existing data. SQLite/libSQL only."""
    if not settings.database_url.startswith("sqlite"):
        return
    with engine.begin() as conn:
        for table, column, ddl in _SCHEMA_ADDITIONS:
            rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            existing = {r[1] for r in rows}
            if column not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))
