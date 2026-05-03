from __future__ import annotations

import math
import statistics
from calendar import monthrange
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import LIABILITY_TYPES, Account, InvestmentHolding, SavingsGoal, Transaction, User

router = APIRouter(prefix="/goals", tags=["goals"])


class GoalCreate(BaseModel):
    name: str
    target_cents: int
    target_date: date | None = None
    account_id: int | None = None


class GoalUpdate(BaseModel):
    name: str | None = None
    target_cents: int | None = None
    target_date: date | None = None
    account_id: int | None = None
    archived: bool | None = None


class GoalOut(BaseModel):
    id: int
    name: str
    target_cents: int
    target_date: date | None
    account_id: int | None
    archived: bool
    # computed
    current_cents: int
    progress_pct: float
    monthly_rate_cents: int
    required_monthly_cents: int | None  # what you'd need per month to hit the date
    eta_date: date | None
    on_track: bool
    status_reason: str | None


def _add_months(d: date, n: int) -> date:
    """Return the date n months after d, clamping day to the target month's length."""
    total = d.year * 12 + (d.month - 1) + n
    year, month = divmod(total, 12)
    month += 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def _holdings_value_per_account(db: Session, user_id: int) -> dict[int, int]:
    """Sum of (shares × FX-converted price) per investment account, in EUR cents."""
    rows = (
        db.query(InvestmentHolding)
        .filter(InvestmentHolding.user_id == user_id)
        .all()
    )
    out: dict[int, int] = {}
    for h in rows:
        eur_price = h.last_price_eur if h.last_price_eur is not None else h.last_price
        if eur_price is None:
            continue
        out[h.account_id] = out.get(h.account_id, 0) + int(round(h.shares * eur_price * 100))
    return out


def _current_net_worth(db: Session, user_id: int) -> int:
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    tx_totals = dict(
        db.query(
            Transaction.account_id,
            func.coalesce(func.sum(Transaction.amount_cents), 0),
        )
        .filter(Transaction.user_id == user_id)
        .group_by(Transaction.account_id)
        .all()
    )
    holdings = _holdings_value_per_account(db, user_id)
    assets = 0
    liab = 0
    for acc in accounts:
        bal = acc.opening_balance_cents + tx_totals.get(acc.id, 0) + holdings.get(acc.id, 0)
        if acc.type in LIABILITY_TYPES:
            liab += abs(bal)
        else:
            assets += bal
    return assets - liab


def _account_balance(db: Session, user_id: int, account_id: int) -> int:
    acc = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=400, detail=f"Unknown account {account_id}")
    total = (
        db.query(func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.account_id == account_id, Transaction.user_id == user_id)
        .scalar()
        or 0
    )
    holdings = _holdings_value_per_account(db, user_id).get(account_id, 0)
    return acc.opening_balance_cents + total + holdings


def _monthly_rate_cents(db: Session, user_id: int) -> int:
    """Median of the last 3 completed months' net cashflow (income − expenses,
    excluding transfers). Returns cents (int)."""
    today = date.today()
    rates: list[int] = []
    for back in range(1, 4):
        ref = _add_months(today.replace(day=1), -back)
        start = ref.replace(day=1)
        end = date(start.year, start.month, monthrange(start.year, start.month)[1])
        rows = (
            db.query(Transaction.amount_cents)
            .filter(
                Transaction.user_id == user_id,
                Transaction.transfer_group_id.is_(None),
                Transaction.occurred_on >= start,
                Transaction.occurred_on <= end,
            )
            .all()
        )
        if not rows:
            continue
        net = sum(r[0] for r in rows)
        rates.append(net)
    if not rates:
        return 0
    return int(statistics.median(rates))


def _project_eta(current: int, target: int, monthly_rate: int) -> date | None:
    if current >= target:
        return date.today()
    if monthly_rate <= 0:
        return None
    gap = target - current
    months_needed = math.ceil(gap / monthly_rate)
    return _add_months(date.today(), months_needed)


def _to_out(db: Session, g: SavingsGoal) -> GoalOut:
    if g.account_id is not None:
        current = _account_balance(db, g.user_id, g.account_id)
    else:
        current = _current_net_worth(db, g.user_id)
    pct = 0.0
    if g.target_cents > 0:
        pct = max(0.0, min(1.0, current / g.target_cents))
    monthly_rate = _monthly_rate_cents(db, g.user_id)
    eta = _project_eta(current, g.target_cents, monthly_rate)
    gap = g.target_cents - current

    # Required monthly contribution to hit the target_date (only meaningful if
    # target_date is set and not already reached).
    required_monthly: int | None = None
    if g.target_date and gap > 0 and g.target_date >= date.today():
        months_left = (
            (g.target_date.year - date.today().year) * 12
            + (g.target_date.month - date.today().month)
        )
        if months_left <= 0:
            months_left = 1
        required_monthly = int(math.ceil(gap / months_left))

    if g.target_date is None:
        on_track = True
    else:
        on_track = eta is not None and eta <= g.target_date

    # Deterministic, human-readable explanation
    reason: str | None = None
    if current >= g.target_cents:
        reason = "Goal reached — congrats."
    elif g.target_date is None:
        if monthly_rate <= 0:
            reason = (
                "No deadline set, but you haven't been saving lately "
                f"(median net cashflow over the last 3 months is €{monthly_rate / 100:,.0f}/mo). "
                "Without inflows the goal can't progress."
            )
        elif eta:
            reason = (
                f"At your current pace of €{monthly_rate / 100:,.0f}/mo you'll reach "
                f"€{g.target_cents / 100:,.0f} around {eta.strftime('%b %Y')}."
            )
    else:
        if monthly_rate <= 0:
            reason = (
                f"You're €{gap / 100:,.0f} short, but your recent savings rate is "
                f"€{monthly_rate / 100:,.0f}/mo. At this rate the deadline ({g.target_date.strftime('%b %Y')}) "
                "is unreachable — increase income or cut spending to start saving again."
            )
        elif on_track:
            reason = (
                f"On track. Saving €{monthly_rate / 100:,.0f}/mo, you'll hit the target around "
                f"{eta.strftime('%b %Y') if eta else g.target_date.strftime('%b %Y')}."
            )
        else:
            late_eta = eta.strftime("%b %Y") if eta else "later than your deadline"
            need = required_monthly or 0
            extra = max(0, need - monthly_rate)
            reason = (
                f"Off track: at your current pace of €{monthly_rate / 100:,.0f}/mo "
                f"you'll only reach the goal around {late_eta}, past your deadline of "
                f"{g.target_date.strftime('%b %Y')}. To make it on time you'd need to save "
                f"€{need / 100:,.0f}/mo "
                + (f"(€{extra / 100:,.0f} more than today)." if extra > 0 else "(more than today).")
            )

    return GoalOut(
        id=g.id,
        name=g.name,
        target_cents=g.target_cents,
        target_date=g.target_date,
        account_id=g.account_id,
        archived=g.archived,
        current_cents=current,
        progress_pct=round(pct, 4),
        monthly_rate_cents=monthly_rate,
        required_monthly_cents=required_monthly,
        eta_date=eta,
        on_track=on_track,
        status_reason=reason,
    )


@router.get("", response_model=list[GoalOut])
def list_goals(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    rows = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.user_id == user.id, SavingsGoal.archived.is_(False))
        .order_by(SavingsGoal.id.asc())
        .all()
    )
    return [_to_out(db, g) for g in rows]


def _validate_account(db: Session, user_id: int, account_id: int | None) -> None:
    if account_id is None:
        return
    acc = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user_id)
        .first()
    )
    if not acc:
        raise HTTPException(status_code=400, detail=f"Invalid account {account_id}")


@router.post("", response_model=GoalOut)
def create_goal(
    data: GoalCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if data.target_cents <= 0:
        raise HTTPException(status_code=400, detail="target_cents must be positive")
    _validate_account(db, user.id, data.account_id)
    g = SavingsGoal(
        user_id=user.id,
        name=data.name[:80],
        target_cents=data.target_cents,
        target_date=data.target_date,
        account_id=data.account_id,
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return _to_out(db, g)


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(
    goal_id: int,
    data: GoalUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    g = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == user.id)
        .first()
    )
    if not g:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    if "account_id" in updates:
        _validate_account(db, user.id, updates["account_id"])
    if "target_cents" in updates and updates["target_cents"] is not None and updates["target_cents"] <= 0:
        raise HTTPException(status_code=400, detail="target_cents must be positive")
    if "name" in updates and updates["name"] is not None:
        updates["name"] = updates["name"][:80]
    for k, v in updates.items():
        setattr(g, k, v)
    db.commit()
    db.refresh(g)
    return _to_out(db, g)


@router.delete("/{goal_id}")
def delete_goal(
    goal_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    g = (
        db.query(SavingsGoal)
        .filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == user.id)
        .first()
    )
    if not g:
        raise HTTPException(status_code=404, detail="Not found")
    g.archived = True
    db.commit()
    return {"ok": True}
