from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Account, InvestmentHolding, User
from ..quotes import fetch_fx_rates, fetch_fx_to_eur, fetch_quote, fetch_quotes, invalidate_cache

router = APIRouter(prefix="/investments", tags=["investments"])


class HoldingIn(BaseModel):
    account_id: int
    symbol: str = Field(min_length=1, max_length=20)
    shares: float = Field(gt=0)
    cost_basis_cents: int = 0
    notes: str | None = None


class HoldingPatch(BaseModel):
    symbol: str | None = None
    shares: float | None = None
    cost_basis_cents: int | None = None
    notes: str | None = None


class HoldingOut(BaseModel):
    id: int
    account_id: int
    symbol: str
    name: str | None
    shares: float
    cost_basis_cents: int
    notes: str | None
    # Live / cached quote
    last_price: float | None
    last_currency: str | None
    last_price_eur: float | None  # native_price × FX(currency → EUR)
    last_fx_rate: float | None
    last_price_at: datetime | None
    # Computed (always in EUR cents — uses FX-converted price)
    market_value_cents: int
    unrealised_pnl_cents: int
    unrealised_pnl_pct: float | None


class QuoteOut(BaseModel):
    symbol: str
    price: float
    currency: str
    exchange: str | None = None
    long_name: str | None = None


def _validate_investment_account(db: Session, user_id: int, account_id: int) -> Account:
    acc = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=400, detail=f"Unknown account {account_id}")
    if acc.type != "investment":
        raise HTTPException(
            status_code=400,
            detail=f"Account {acc.name!r} is not an investment account",
        )
    return acc


def _to_out(h: InvestmentHolding) -> HoldingOut:
    market = 0
    pnl = 0
    pnl_pct: float | None = None
    # Prefer FX-converted price; fall back to native if FX failed (assumes EUR).
    eur_price = h.last_price_eur if h.last_price_eur is not None else h.last_price
    if eur_price is not None:
        market = int(round(h.shares * eur_price * 100))
        pnl = market - (h.cost_basis_cents or 0)
        if h.cost_basis_cents and h.cost_basis_cents > 0:
            pnl_pct = round(pnl / h.cost_basis_cents * 100, 2)
    return HoldingOut(
        id=h.id,
        account_id=h.account_id,
        symbol=h.symbol,
        name=h.name,
        shares=h.shares,
        cost_basis_cents=h.cost_basis_cents,
        notes=h.notes,
        last_price=h.last_price,
        last_currency=h.last_currency,
        last_price_eur=h.last_price_eur,
        last_fx_rate=h.last_fx_rate,
        last_price_at=h.last_price_at,
        market_value_cents=market,
        unrealised_pnl_cents=pnl,
        unrealised_pnl_pct=pnl_pct,
    )


async def _refresh_quotes(db: Session, holdings: list[InvestmentHolding]) -> None:
    """Fetch live quotes + FX rates for all holdings and write them back."""
    if not holdings:
        return
    symbols = [h.symbol for h in holdings]
    quotes = await fetch_quotes(symbols)

    # Batch-fetch FX for every distinct non-EUR currency that came back.
    distinct_currencies = sorted({
        q["currency"] for q in quotes.values() if q.get("currency")
    })
    fx_rates = await fetch_fx_rates(distinct_currencies)

    now = datetime.utcnow()
    for h in holdings:
        q = quotes.get(h.symbol.upper())
        if q is None:
            continue
        h.last_price = q["price"]
        h.last_currency = q["currency"]
        h.last_price_at = now
        rate = fx_rates.get((q["currency"] or "EUR").upper())
        h.last_fx_rate = rate
        h.last_price_eur = q["price"] * rate if rate is not None else None
        if q.get("long_name") and not h.name:
            h.name = q["long_name"][:120]
    db.commit()


@router.get("/holdings", response_model=list[HoldingOut])
async def list_holdings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    holdings = (
        db.query(InvestmentHolding)
        .filter(InvestmentHolding.user_id == user.id)
        .order_by(InvestmentHolding.symbol.asc())
        .all()
    )
    await _refresh_quotes(db, holdings)
    return [_to_out(h) for h in holdings]


@router.post("/holdings", response_model=HoldingOut)
async def create_holding(
    data: HoldingIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_investment_account(db, user.id, data.account_id)
    sym = data.symbol.strip().upper()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol required")

    existing = (
        db.query(InvestmentHolding)
        .filter(
            InvestmentHolding.user_id == user.id,
            InvestmentHolding.account_id == data.account_id,
            InvestmentHolding.symbol == sym,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"You already have {sym} in this account — edit it instead",
        )

    h = InvestmentHolding(
        user_id=user.id,
        account_id=data.account_id,
        symbol=sym,
        shares=data.shares,
        cost_basis_cents=data.cost_basis_cents,
        notes=(data.notes or None),
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    await _refresh_quotes(db, [h])
    return _to_out(h)


@router.patch("/holdings/{holding_id}", response_model=HoldingOut)
async def update_holding(
    holding_id: int,
    data: HoldingPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    h = (
        db.query(InvestmentHolding)
        .filter(InvestmentHolding.id == holding_id, InvestmentHolding.user_id == user.id)
        .first()
    )
    if not h:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    if "symbol" in updates and updates["symbol"]:
        new_sym = updates["symbol"].strip().upper()
        if new_sym != h.symbol:
            invalidate_cache(h.symbol)
            h.symbol = new_sym
            h.name = None
            h.last_price = None
            h.last_currency = None
            h.last_price_at = None
        updates.pop("symbol")
    for k, v in updates.items():
        setattr(h, k, v)
    db.commit()
    db.refresh(h)
    await _refresh_quotes(db, [h])
    return _to_out(h)


@router.delete("/holdings/{holding_id}")
def delete_holding(
    holding_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    h = (
        db.query(InvestmentHolding)
        .filter(InvestmentHolding.id == holding_id, InvestmentHolding.user_id == user.id)
        .first()
    )
    if not h:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(h)
    db.commit()
    return {"ok": True}


@router.get("/quote/{symbol}", response_model=QuoteOut)
async def quote(symbol: str, user: User = Depends(get_current_user)):
    q = await fetch_quote(symbol)
    if q is None:
        raise HTTPException(status_code=404, detail=f"No price found for symbol {symbol!r}")
    return QuoteOut(**{k: q.get(k) for k in ("symbol", "price", "currency", "exchange", "long_name")})
