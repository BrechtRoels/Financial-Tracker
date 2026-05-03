from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import Budget, Transaction, User
from ..schemas import BudgetOut, BudgetUpsert

router = APIRouter(prefix="/budgets", tags=["budgets"])


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _month_end(d: date) -> date:
    if d.month == 12:
        return date(d.year, 12, 31)
    return date(d.year, d.month + 1, 1).fromordinal(date(d.year, d.month + 1, 1).toordinal() - 1)


@router.get("", response_model=list[BudgetOut])
def list_budgets(
    month: date = Query(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    m = _month_start(month)
    budgets = db.query(Budget).filter(Budget.user_id == user.id, Budget.month == m).all()
    start, end = m, _month_end(m)
    spent_rows = (
        db.query(Transaction.category_id, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(
            Transaction.user_id == user.id,
            Transaction.occurred_on >= start,
            Transaction.occurred_on <= end,
            Transaction.amount_cents < 0,
        )
        .group_by(Transaction.category_id)
        .all()
    )
    spent_map = {cid: -total for cid, total in spent_rows}
    return [
        BudgetOut(
            id=b.id,
            category_id=b.category_id,
            month=b.month,
            amount_cents=b.amount_cents,
            spent_cents=spent_map.get(b.category_id, 0),
        )
        for b in budgets
    ]


@router.post("", response_model=BudgetOut)
def upsert_budget(
    data: BudgetUpsert, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    m = _month_start(data.month)
    existing = (
        db.query(Budget)
        .filter(
            and_(
                Budget.user_id == user.id,
                Budget.category_id == data.category_id,
                Budget.month == m,
            )
        )
        .first()
    )
    if existing:
        existing.amount_cents = data.amount_cents
        db.commit()
        db.refresh(existing)
        return BudgetOut(
            id=existing.id,
            category_id=existing.category_id,
            month=existing.month,
            amount_cents=existing.amount_cents,
        )
    b = Budget(user_id=user.id, category_id=data.category_id, month=m, amount_cents=data.amount_cents)
    db.add(b)
    db.commit()
    db.refresh(b)
    return BudgetOut(id=b.id, category_id=b.category_id, month=b.month, amount_cents=b.amount_cents)


@router.delete("/{budget_id}")
def delete_budget(
    budget_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    b = db.query(Budget).filter(Budget.id == budget_id, Budget.user_id == user.id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(b)
    db.commit()
    return {"ok": True}
