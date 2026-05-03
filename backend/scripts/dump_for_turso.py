"""Emit a libSQL-compatible SQL dump of the local SQLite DB.

Why this exists: macOS's bundled `sqlite3 .dump` uses `unistr()` for non-ASCII
strings, which Turso's older libSQL build doesn't recognize. This script uses
the Python stdlib instead and emits plain quoted INSERT statements that any
SQLite-compatible engine accepts.

Usage:
    python scripts/dump_for_turso.py finance.db > /tmp/finance_dump.sql
    turso db shell financial-tracker < /tmp/finance_dump.sql
"""

from __future__ import annotations

import sqlite3
import sys


def quote(v: object) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, bytes):
        return "X'" + v.hex() + "'"
    s = str(v).replace("'", "''")
    return "'" + s + "'"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: dump_for_turso.py <path/to/finance.db>", file=sys.stderr)
        return 2

    conn = sqlite3.connect(sys.argv[1])
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    tables = [
        r["name"]
        for r in cur.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY name"
        )
    ]

    out = sys.stdout.write
    out("PRAGMA foreign_keys=OFF;\n")
    out("BEGIN TRANSACTION;\n")

    # Schema first.
    for t in tables:
        ddl = cur.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (t,),
        ).fetchone()["sql"]
        out(ddl + ";\n")

    # Indexes (skip the auto-created ones).
    for r in cur.execute(
        "SELECT sql FROM sqlite_master "
        "WHERE type='index' AND sql IS NOT NULL "
        "ORDER BY name"
    ):
        out(r["sql"] + ";\n")

    # Data.
    for t in tables:
        cols = [c[1] for c in cur.execute(f"PRAGMA table_info({t})").fetchall()]
        col_list = ", ".join(f'"{c}"' for c in cols)
        for row in cur.execute(f'SELECT {col_list} FROM "{t}"'):
            values = ", ".join(quote(row[i]) for i in range(len(cols)))
            out(f'INSERT INTO "{t}" ({col_list}) VALUES ({values});\n')

    out("COMMIT;\n")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
