from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ..models import (
    Account,
    Budget,
    CsvImport,
    InvestmentHolding,
    RecurringClassification,
    SavingsGoal,
    Transaction,
    User,
)
from ..schemas import AccountCreate, AccountOut, AccountUpdate

router = APIRouter(prefix="/accounts", tags=["accounts"])


def normalize_iban(iban: str | None) -> str | None:
    if not iban:
        return None
    stripped = "".join(str(iban).split()).upper()
    return stripped or None


def _to_out(acc: Account, balance_cents: int, holdings_value_cents: int = 0) -> AccountOut:
    return AccountOut(
        id=acc.id,
        name=acc.name,
        type=acc.type,
        iban=acc.iban,
        logo_url=acc.logo_url,
        opening_balance_cents=acc.opening_balance_cents,
        archived=acc.archived,
        is_asset=acc.is_asset,
        balance_cents=balance_cents + holdings_value_cents,
        holdings_value_cents=holdings_value_cents,
    )


def _holdings_value_map(db: Session, user_id: int) -> dict[int, int]:
    """For each investment account, sum shares × FX-converted price (EUR cents).

    Falls back to native price when FX failed (best-effort)."""
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


def _balance_map(db: Session, user_id: int) -> dict[int, int]:
    rows = (
        db.query(Transaction.account_id, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.user_id == user_id)
        .group_by(Transaction.account_id)
        .all()
    )
    return {acc_id: total for acc_id, total in rows}


@router.get("", response_model=list[AccountOut])
def list_accounts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    accounts = db.query(Account).filter(Account.user_id == user.id).order_by(Account.id).all()
    bmap = _balance_map(db, user.id)
    hmap = _holdings_value_map(db, user.id)
    return [
        _to_out(a, a.opening_balance_cents + bmap.get(a.id, 0), hmap.get(a.id, 0))
        for a in accounts
    ]


@router.post("", response_model=AccountOut)
def create_account(
    data: AccountCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    payload = data.model_dump()
    payload["iban"] = normalize_iban(payload.get("iban"))
    acc = Account(user_id=user.id, **payload)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return _to_out(acc, acc.opening_balance_cents)


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(
    account_id: int,
    data: AccountUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    acc = db.query(Account).filter(Account.id == account_id, Account.user_id == user.id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    if "iban" in updates:
        updates["iban"] = normalize_iban(updates["iban"])
    for k, v in updates.items():
        setattr(acc, k, v)
    db.commit()
    db.refresh(acc)
    bmap = _balance_map(db, user.id)
    hmap = _holdings_value_map(db, user.id)
    return _to_out(acc, acc.opening_balance_cents + bmap.get(acc.id, 0), hmap.get(acc.id, 0))


@router.delete("/{account_id}")
def delete_account(
    account_id: int,
    force: bool = Query(False, description="Cascade-delete attached transactions, holdings, etc."),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    acc = db.query(Account).filter(Account.id == account_id, Account.user_id == user.id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Not found")

    has_tx = db.query(Transaction).filter(Transaction.account_id == acc.id).first()
    if has_tx and not force:
        raise HTTPException(
            status_code=400,
            detail="Account has transactions. Pass ?force=true to also delete them.",
        )

    # If this account was the user's default for new transactions, clear it.
    if user.default_account_id == acc.id:
        user.default_account_id = None

    if force:
        # Refund-link cleanup: any transaction whose `refund_for_id` points
        # at a row we're about to delete must lose the link.
        deleted_tx_ids = [
            r[0]
            for r in db.query(Transaction.id)
            .filter(Transaction.account_id == acc.id)
            .all()
        ]
        if deleted_tx_ids:
            db.query(Transaction).filter(
                Transaction.refund_for_id.in_(deleted_tx_ids)
            ).update({Transaction.refund_for_id: None}, synchronize_session=False)

        db.execute(delete(Transaction).where(Transaction.account_id == acc.id))
        db.execute(delete(InvestmentHolding).where(InvestmentHolding.account_id == acc.id))
        db.execute(delete(CsvImport).where(CsvImport.account_id == acc.id))
        db.execute(
            delete(RecurringClassification).where(RecurringClassification.user_id == user.id)
        )
        # Detach savings goals; don't delete them — the goal is still meaningful
        # without an explicit account anchor.
        db.query(SavingsGoal).filter(SavingsGoal.account_id == acc.id).update(
            {SavingsGoal.account_id: None}, synchronize_session=False
        )
        # Budgets reference categories, not accounts — nothing to do there.
        _ = Budget  # silence unused-import lint when force=False at type time

    db.delete(acc)
    db.commit()
    return {"ok": True, "force": force}
