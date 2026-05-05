"""Emit SQL that creates a demo user with realistic mock data.

Pipe the output into a SQLite-compatible shell. Designed for Turso:

    turso db shell financial-tracker < <(python scripts/seed_demo_user.py)

Or against the local SQLite file:

    sqlite3 finance.db < <(python scripts/seed_demo_user.py)

Idempotent-ish: the SQL deletes any existing rows for `demo@demo.local`
first, then re-creates them. Run as many times as you like; the demo user's
state always resets to a fresh ~80-transaction snapshot. Other users'
data is never touched.
"""

from __future__ import annotations

import argparse
import random
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

# Make `app` importable when this script is run from the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.security import hash_password  # noqa: E402
from app.seed import DEFAULT_CATEGORIES  # noqa: E402

DEMO_EMAIL = "demo@demo.local"
DEMO_PASSWORD = "demo123"

random.seed(42)


def quote(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (date, datetime)):
        return f"'{v.isoformat()}'"
    s = str(v).replace("'", "''")
    return f"'{s}'"


# ---------- Mock data shape -------------------------------------------------

MERCHANTS_BY_CATEGORY: dict[str, list[tuple[str, int, int]]] = {
    "Groceries": [
        ("Albert Heijn", 18, 95),
        ("Delhaize", 22, 80),
        ("Lidl", 12, 55),
        ("Carrefour Express", 8, 35),
        ("Bio-Planet", 24, 70),
    ],
    "Dining": [
        ("Brasserie Centraal", 18, 65),
        ("Pizza Hut", 14, 32),
        ("Wagamama", 22, 48),
        ("Le Pain Quotidien", 9, 28),
        ("Ellis Gourmet Burger", 16, 42),
    ],
    "Transport": [
        ("NMBS", 6, 28),
        ("De Lijn", 3, 18),
        ("Uber", 8, 24),
        ("Q-Park", 4, 14),
        ("Total Energies", 55, 78),
    ],
    "Entertainment": [
        ("Netflix", 15, 15),
        ("Spotify", 11, 11),
        ("Kinepolis", 12, 22),
        ("Bol.com", 14, 60),
        ("Steam", 10, 45),
    ],
    "Utilities": [
        ("Engie Electrabel", 70, 110),
        ("Proximus", 55, 55),
        ("Mobile Vikings", 17, 17),
    ],
    "Health": [
        ("Apotheek De Brug", 8, 32),
        ("MultiPharma", 12, 44),
    ],
    "Shopping": [
        ("Zara", 25, 95),
        ("H&M", 18, 65),
        ("Decathlon", 20, 110),
        ("MediaMarkt", 35, 220),
    ],
    "Other": [
        ("Bpost", 4, 20),
        ("Ikea", 25, 180),
    ],
}

INCOME_BY_CATEGORY: dict[str, list[tuple[str, int, int]]] = {
    "Salary": [("PwC Belgium", 3400, 3650)],
    "Bonus": [("PwC Belgium", 800, 1500)],
    "Interest": [("KBC Bank", 8, 22)],
}


def emit_user_id_subq() -> str:
    # Use a SELECT subquery wherever we need the demo user_id; this keeps the
    # dump portable across DBs that auto-assign different IDs.
    return f"(SELECT id FROM users WHERE email = '{DEMO_EMAIL}')"


def emit_account_id_subq(name: str) -> str:
    return (
        f"(SELECT id FROM accounts WHERE user_id = {emit_user_id_subq()} "
        f"AND name = '{name}')"
    )


def emit_category_id_subq(name: str) -> str:
    return (
        f"(SELECT id FROM categories WHERE user_id = {emit_user_id_subq()} "
        f"AND name = '{name}')"
    )


def emit_delete() -> list[str]:
    """SQL to wipe any prior demo-user data, run before reinsertion."""
    uid = emit_user_id_subq()
    return [
        f"DELETE FROM investment_holdings WHERE user_id = {uid};",
        f"DELETE FROM savings_goals WHERE user_id = {uid};",
        f"DELETE FROM budgets WHERE user_id = {uid};",
        f"DELETE FROM csv_imports WHERE user_id = {uid};",
        f"DELETE FROM recurring_classifications WHERE user_id = {uid};",
        f"DELETE FROM chat_messages WHERE session_id IN "
        f"(SELECT id FROM chat_sessions WHERE user_id = {uid});",
        f"DELETE FROM chat_sessions WHERE user_id = {uid};",
        f"DELETE FROM custom_tools WHERE user_id = {uid};",
        f"DELETE FROM transactions WHERE user_id = {uid};",
        f"DELETE FROM categories WHERE user_id = {uid};",
        f"DELETE FROM accounts WHERE user_id = {uid};",
        f"DELETE FROM users WHERE email = '{DEMO_EMAIL}';",
    ]


def emit_user() -> str:
    pwd_hash = hash_password(DEMO_PASSWORD)
    return (
        "INSERT INTO users (email, password_hash, is_admin, ai_enabled, created_at) "
        f"VALUES ('{DEMO_EMAIL}', {quote(pwd_hash)}, 0, 1, "
        f"{quote(datetime.utcnow())});"
    )


def emit_categories() -> list[str]:
    out = []
    for name, kind, color in DEFAULT_CATEGORIES:
        out.append(
            "INSERT INTO categories (user_id, name, kind, color, icon) VALUES "
            f"({emit_user_id_subq()}, {quote(name)}, {quote(kind)}, {quote(color)}, NULL);"
        )
    return out


def emit_accounts() -> list[str]:
    specs = [
        ("KBC Checking", "checking", 220_000, "BE68 5390 0754 7034"),
        ("KBC Spaarrekening", "savings", 1_450_000, "BE71 5390 0754 8121"),
        ("KBC Mastercard", "credit_card", 0, None),
    ]
    out = []
    for name, type_, opening, iban in specs:
        out.append(
            "INSERT INTO accounts (user_id, name, type, iban, logo_url, "
            "opening_balance_cents, archived, created_at) VALUES "
            f"({emit_user_id_subq()}, {quote(name)}, {quote(type_)}, "
            f"{quote(iban)}, NULL, {opening}, 0, {quote(datetime.utcnow())});"
        )
    return out


def _tx_sql(
    *,
    account_name: str,
    category_name: str | None,
    amount_cents: int,
    occurred_on: date,
    description: str,
    merchant: str | None = None,
    counterparty_name: str | None = None,
    transfer_group_id: str | None = None,
    refund_for_id_sql: str | None = None,
) -> str:
    cat_sql = emit_category_id_subq(category_name) if category_name else "NULL"
    refund_sql = refund_for_id_sql or "NULL"
    return (
        "INSERT INTO transactions (user_id, account_id, category_id, amount_cents, "
        "occurred_on, description, transfer_group_id, counterparty_iban, "
        "counterparty_name, merchant, refund_for_id, created_at) VALUES ("
        f"{emit_user_id_subq()}, {emit_account_id_subq(account_name)}, {cat_sql}, "
        f"{amount_cents}, {quote(occurred_on)}, {quote(description)}, "
        f"{quote(transfer_group_id)}, NULL, {quote(counterparty_name)}, "
        f"{quote(merchant)}, {refund_sql}, {quote(datetime.utcnow())});"
    )


def emit_transactions() -> list[str]:
    today = date.today()
    start = today - timedelta(days=120)
    out: list[str] = []

    # 1. Monthly salary on the 27th
    cursor = date(start.year, start.month, 1)
    while cursor <= today:
        d = date(cursor.year, cursor.month, 27)
        if start <= d <= today:
            merchant, lo, hi = INCOME_BY_CATEGORY["Salary"][0]
            amt = random.randint(lo, hi)
            out.append(
                _tx_sql(
                    account_name="KBC Checking",
                    category_name="Salary",
                    amount_cents=amt * 100,
                    occurred_on=d,
                    description="Maandelijks loon",
                    merchant=merchant,
                    counterparty_name=merchant,
                )
            )
        cursor = date(cursor.year + (cursor.month == 12), (cursor.month % 12) + 1, 1)

    # 2. Rent on the 1st
    cursor = date(start.year, start.month, 1)
    while cursor <= today:
        if start <= cursor <= today:
            out.append(
                _tx_sql(
                    account_name="KBC Checking",
                    category_name="Rent",
                    amount_cents=-110_000,
                    occurred_on=cursor,
                    description="Huur appartement",
                    merchant="Immo De Smedt",
                    counterparty_name="Immo De Smedt",
                )
            )
        cursor = date(cursor.year + (cursor.month == 12), (cursor.month % 12) + 1, 1)

    # 3. Subscriptions
    cursor = date(start.year, start.month, 1)
    while cursor <= today:
        for name, cat_name, day in [
            ("Netflix", "Entertainment", 5),
            ("Spotify", "Entertainment", 12),
            ("Mobile Vikings", "Utilities", 8),
            ("Proximus", "Utilities", 15),
        ]:
            try:
                d = date(cursor.year, cursor.month, day)
            except ValueError:
                continue
            if start <= d <= today:
                merchants = MERCHANTS_BY_CATEGORY[cat_name]
                amt = next(amount for m, amount, _ in merchants if m == name)
                out.append(
                    _tx_sql(
                        account_name="KBC Checking",
                        category_name=cat_name,
                        amount_cents=-amt * 100,
                        occurred_on=d,
                        description=f"Abonnement {name}",
                        merchant=name,
                        counterparty_name=name,
                    )
                )
        cursor = date(cursor.year + (cursor.month == 12), (cursor.month % 12) + 1, 1)

    # 4. Weekly groceries on Saturdays
    d = start
    while d <= today:
        if d.weekday() == 5:
            store, lo, hi = random.choice(MERCHANTS_BY_CATEGORY["Groceries"])
            amt = random.randint(lo, hi)
            out.append(
                _tx_sql(
                    account_name="KBC Checking",
                    category_name="Groceries",
                    amount_cents=-amt * 100,
                    occurred_on=d,
                    description="Boodschappen",
                    merchant=store,
                )
            )
        d += timedelta(days=1)

    # 5. Random extras
    extras = [
        ("Dining", "KBC Checking", 10),
        ("Transport", "KBC Checking", 14),
        ("Entertainment", "KBC Checking", 4),
        ("Health", "KBC Checking", 3),
        ("Shopping", "KBC Mastercard", 6),
        ("Other", "KBC Checking", 4),
    ]
    for cat_name, acc_name, count in extras:
        for _ in range(count):
            offset = random.randint(0, (today - start).days)
            d = start + timedelta(days=offset)
            store, lo, hi = random.choice(MERCHANTS_BY_CATEGORY[cat_name])
            amt = random.randint(lo, hi)
            out.append(
                _tx_sql(
                    account_name=acc_name,
                    category_name=cat_name,
                    amount_cents=-amt * 100,
                    occurred_on=d,
                    description=cat_name.lower() + " purchase",
                    merchant=store,
                )
            )

    # 6. Mid-period bonus
    bonus_day = start + timedelta(days=(today - start).days // 2)
    merchant, lo, hi = INCOME_BY_CATEGORY["Bonus"][0]
    out.append(
        _tx_sql(
            account_name="KBC Checking",
            category_name="Bonus",
            amount_cents=random.randint(lo, hi) * 100,
            occurred_on=bonus_day,
            description="Year-end bonus",
            merchant=merchant,
            counterparty_name=merchant,
        )
    )

    # 7. Monthly transfer checking → savings
    cursor = date(start.year, start.month, 1)
    while cursor <= today:
        try:
            d = date(cursor.year, cursor.month, 28)
        except ValueError:
            cursor = date(cursor.year + (cursor.month == 12), (cursor.month % 12) + 1, 1)
            continue
        if start <= d <= today:
            group = str(uuid.uuid4())
            out.append(
                _tx_sql(
                    account_name="KBC Checking",
                    category_name=None,
                    amount_cents=-50_000,
                    occurred_on=d,
                    description="Overschrijving naar spaarrekening",
                    transfer_group_id=group,
                )
            )
            out.append(
                _tx_sql(
                    account_name="KBC Spaarrekening",
                    category_name=None,
                    amount_cents=50_000,
                    occurred_on=d,
                    description="Overschrijving van zichtrekening",
                    transfer_group_id=group,
                )
            )
        cursor = date(cursor.year + (cursor.month == 12), (cursor.month % 12) + 1, 1)

    # 8. Refund pair — group dinner and Tom paying back his share.
    refund_day_a = today - timedelta(days=18)
    refund_day_b = today - timedelta(days=9)
    out.append(
        _tx_sql(
            account_name="KBC Checking",
            category_name="Dining",
            amount_cents=-8400,
            occurred_on=refund_day_a,
            description="Group dinner — covered the bill",
            merchant="Brasserie Centraal",
        )
    )
    # Refund row references the expense via a subquery (we don't know its
    # id at SQL-emit time, so use the unique description+date+amount).
    refund_for_subq = (
        "(SELECT id FROM transactions WHERE user_id = "
        f"{emit_user_id_subq()} "
        "AND description = 'Group dinner — covered the bill' LIMIT 1)"
    )
    out.append(
        _tx_sql(
            account_name="KBC Checking",
            category_name="Dining",
            amount_cents=2100,
            occurred_on=refund_day_b,
            description="Tom paid back his share",
            merchant="Tom Janssens",
            counterparty_name="Tom Janssens",
            refund_for_id_sql=refund_for_subq,
        )
    )

    return out


def emit_goal() -> str:
    target = (date.today() + timedelta(days=180)).isoformat()
    return (
        "INSERT INTO savings_goals (user_id, name, target_cents, target_date, "
        "account_id, archived, created_at) VALUES "
        f"({emit_user_id_subq()}, 'Vacation Japan', 500000, '{target}', "
        f"{emit_account_id_subq('KBC Spaarrekening')}, 0, {quote(datetime.utcnow())});"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()

    print("BEGIN TRANSACTION;")
    for s in emit_delete():
        print(s)
    print(emit_user())
    for s in emit_categories():
        print(s)
    for s in emit_accounts():
        print(s)
    for s in emit_transactions():
        print(s)
    print(emit_goal())
    print("COMMIT;")
    print(
        f"-- Login email:    {DEMO_EMAIL}",
        file=sys.stderr,
    )
    print(f"-- Login password: {DEMO_PASSWORD}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
