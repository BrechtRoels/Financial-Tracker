from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    is_admin: bool = False
    ai_enabled: bool = True
    month_start_day: int = 1
    created_at: datetime


class UserUpdate(BaseModel):
    month_start_day: int | None = Field(default=None, ge=1, le=28)


class AccountCreate(BaseModel):
    name: str
    type: str
    iban: str | None = None
    logo_url: str | None = None
    opening_balance_cents: int = 0


class AccountUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    iban: str | None = None
    logo_url: str | None = None
    opening_balance_cents: int | None = None
    archived: bool | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    type: str
    iban: str | None = None
    logo_url: str | None = None
    opening_balance_cents: int
    archived: bool
    is_asset: bool
    balance_cents: int = 0
    holdings_value_cents: int = 0  # Σ market value of stock holdings (investment accounts)


_VALID_BUCKETS = {"need", "want", "save", None}


class CategoryCreate(BaseModel):
    name: str
    kind: str
    color: str = "#C8E6D0"
    icon: str | None = None
    bucket: str | None = None


class CategoryUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    color: str | None = None
    icon: str | None = None
    bucket: str | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    kind: str
    color: str
    icon: str | None
    bucket: str | None = None


class TransactionCreate(BaseModel):
    account_id: int
    category_id: int | None = None
    amount_cents: int
    occurred_on: date
    description: str = ""
    merchant: str | None = None


class TransactionUpdate(BaseModel):
    account_id: int | None = None
    category_id: int | None = None
    amount_cents: int | None = None
    occurred_on: date | None = None
    description: str | None = None
    merchant: str | None = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    category_id: int | None
    amount_cents: int
    occurred_on: date
    description: str
    transfer_group_id: str | None
    counterparty_iban: str | None = None
    counterparty_name: str | None = None
    merchant: str | None = None
    refund_for_id: int | None = None


class TransferCreate(BaseModel):
    from_account_id: int
    to_account_id: int
    amount_cents: int = Field(gt=0)
    occurred_on: date
    description: str = ""


class BudgetUpsert(BaseModel):
    category_id: int
    month: date
    amount_cents: int


class BudgetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    category_id: int
    month: date
    amount_cents: int
    spent_cents: int = 0


class SummaryOut(BaseModel):
    month: date
    income_cents: int
    expenses_cents: int
    net_cents: int
    savings_rate: float
    top_categories: list[dict]
    avg_monthly_expenses_cents: int = 0
    months_sampled: int = 0


class NetWorthPoint(BaseModel):
    date: date
    assets_cents: int
    liabilities_cents: int
    net_worth_cents: int


class SpendingByCategory(BaseModel):
    category_id: int | None
    category_name: str
    color: str
    amount_cents: int
