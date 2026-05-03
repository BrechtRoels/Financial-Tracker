from __future__ import annotations

from datetime import date, datetime
from enum import Enum

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class AccountType(str, Enum):
    cash = "cash"
    checking = "checking"
    savings = "savings"
    investment = "investment"
    meal_vouchers = "meal_vouchers"
    credit_card = "credit_card"
    loan = "loan"
    other = "other"


LIABILITY_TYPES = {AccountType.credit_card.value, AccountType.loan.value}


class CategoryKind(str, Enum):
    income = "income"
    expense = "expense"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(30))
    iban: Mapped[str | None] = mapped_column(String(34), nullable=True, index=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    opening_balance_cents: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account")

    @property
    def is_asset(self) -> bool:
        return self.type not in LIABILITY_TYPES


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20))
    color: Mapped[str] = mapped_column(String(16), default="#C8E6D0")
    icon: Mapped[str | None] = mapped_column(String(8), nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    occurred_on: Mapped[date] = mapped_column(Date, index=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    transfer_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    counterparty_iban: Mapped[str | None] = mapped_column(String(34), nullable=True, index=True)
    counterparty_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    merchant: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    import_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    location_city: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    location_country: Mapped[str | None] = mapped_column(String(4), nullable=True, index=True)
    refund_for_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    account: Mapped[Account] = relationship(back_populates="transactions")
    category: Mapped[Category | None] = relationship()


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("user_id", "category_id", "month", name="uq_budget_month"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), index=True)
    month: Mapped[date] = mapped_column(Date, index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)


class InvestmentHolding(Base):
    """A position the user holds in an investment-type account.

    `symbol` follows Yahoo Finance notation (e.g. "AAPL", "ASML.AS", "BRK-B").
    `cost_basis_cents` is the total amount invested in this position, in EUR
    cents. `last_price`, `last_currency`, `last_price_at` are the most recent
    cached quote (refreshed by the read endpoints).
    """

    __tablename__ = "investment_holdings"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", "symbol", name="uq_holding_symbol"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    symbol: Mapped[str] = mapped_column(String(20))
    name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    shares: Mapped[float] = mapped_column(Float)
    cost_basis_cents: Mapped[int] = mapped_column(Integer, default=0)
    # Cached quote
    last_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    last_price_eur: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_fx_rate: Mapped[float | None] = mapped_column(Float, nullable=True)  # ccy→EUR
    last_price_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class GeocodeCache(Base):
    """Persistent (city, country) → lat/lon cache for the locations map.

    Each `(country, city)` pair is geocoded once via Nominatim and re-used
    forever. `lat=None` records a previous failed lookup so we don't hammer
    Nominatim on repeat misses.
    """

    __tablename__ = "geocode_cache"
    __table_args__ = (UniqueConstraint("country", "city", name="uq_geocode_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    city: Mapped[str] = mapped_column(String(80))
    country: Mapped[str | None] = mapped_column(String(4), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CsvImport(Base):
    """Tracks CSV files already ingested to prevent accidental double-uploads."""

    __tablename__ = "csv_imports"
    __table_args__ = (
        UniqueConstraint("user_id", "account_id", "content_hash", name="uq_csv_import"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RecurringClassification(Base):
    """User override for how a detected recurring pattern is grouped.

    `key` matches the key computed in `stats.recurring`. If a row exists the
    user's classification wins; otherwise the default (monthly/yearly →
    subscription, weekly → regular) applies.
    """

    __tablename__ = "recurring_classifications"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_recur_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    key: Mapped[str] = mapped_column(String(80), index=True)
    classification: Mapped[str] = mapped_column(String(20))  # subscription|regular|ignore
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SavingsGoal(Base):
    __tablename__ = "savings_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    target_cents: Mapped[int] = mapped_column(Integer)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id"), nullable=True, index=True
    )
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="New chat")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class CustomTool(Base):
    __tablename__ = "custom_tools"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_user_tool_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))  # snake_case
    description: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(40), default="sql_rows")
    sql_template: Mapped[str] = mapped_column(String)
    parameters_json: Mapped[str] = mapped_column(String, default="[]")
    config_json: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user | assistant | tool
    content: Mapped[str] = mapped_column(String, default="")
    # For tool invocation / result rows
    tool_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tool_args_json: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_result_json: Mapped[str | None] = mapped_column(String, nullable=True)
    chart_spec_json: Mapped[str | None] = mapped_column(String, nullable=True)
    images_json: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
