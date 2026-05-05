from __future__ import annotations

import json
import statistics
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Literal

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..deps import get_current_user, get_db
from ..forecasting import band, fit_damped_holt, forecast_path, rmse
from ..genai import llm_complete
from ..geocode import geocode_pairs
from ..models import (
    LIABILITY_TYPES,
    Account,
    Category,
    InvestmentHolding,
    RecurringClassification,
    Transaction,
    User,
)
from ..schemas import NetWorthPoint, SpendingByCategory, SummaryOut
from ..timeutils import month_window

router = APIRouter(prefix="/stats", tags=["stats"])


def _month_bounds(m: date, start_day: int = 1) -> tuple[date, date]:
    """Financial-month window. With start_day=1 == calendar month."""
    if start_day and start_day != 1:
        return month_window(m, start_day)
    start = m.replace(day=1)
    end = date(start.year, start.month, monthrange(start.year, start.month)[1])
    return start, end


@router.get("/summary", response_model=SummaryOut)
def summary(
    month: date = Query(default_factory=date.today),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    start, end = _month_bounds(month, getattr(user, "month_start_day", 1) or 1)
    q = db.query(Transaction).filter(
        Transaction.user_id == user.id,
        Transaction.occurred_on >= start,
        Transaction.occurred_on <= end,
        Transaction.transfer_group_id.is_(None),
    )
    income = sum(t.amount_cents for t in q if t.amount_cents > 0)
    expenses = -sum(t.amount_cents for t in q if t.amount_cents < 0)
    net = income - expenses
    savings_rate = (net / income) if income > 0 else 0.0

    cat_rows = (
        db.query(
            Category.id,
            Category.name,
            Category.color,
            func.coalesce(func.sum(Transaction.amount_cents), 0),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user.id,
            Transaction.occurred_on >= start,
            Transaction.occurred_on <= end,
            Transaction.amount_cents < 0,
        )
        .group_by(Category.id)
        .order_by(func.sum(Transaction.amount_cents).asc())
        .limit(5)
        .all()
    )
    top = [
        {"id": cid, "name": name, "color": color, "amount_cents": -amt}
        for cid, name, color, amt in cat_rows
    ]

    # Average monthly expenses across all months that have at least one
    # non-transfer transaction. Expenses only — negative amounts, sign flipped.
    month_expr = func.strftime("%Y-%m", Transaction.occurred_on)
    month_rows = (
        db.query(
            month_expr.label("ym"),
            func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"),
        )
        .filter(
            Transaction.user_id == user.id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
        )
        .group_by("ym")
        .all()
    )
    months_sampled = len(month_rows)
    avg_monthly_expenses = (
        int(round(sum(r.spent for r in month_rows) / months_sampled)) if months_sampled else 0
    )

    return SummaryOut(
        month=start,
        income_cents=income,
        expenses_cents=expenses,
        net_cents=net,
        savings_rate=round(savings_rate, 4),
        top_categories=top,
        avg_monthly_expenses_cents=avg_monthly_expenses,
        months_sampled=months_sampled,
    )


class BucketBreakdown(BaseModel):
    need_cents: int
    want_cents: int
    save_cents: int
    untagged_cents: int
    income_cents: int
    target_need_pct: int = 50
    target_want_pct: int = 30
    target_save_pct: int = 20
    period_start: date
    period_end: date


@router.get("/buckets", response_model=BucketBreakdown)
def buckets(
    month: date = Query(default_factory=date.today),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """50/30/20 split for the current financial month.

    Sums non-transfer expense transactions by their category's `bucket`
    (need / want / save). Income is reported separately so the frontend can
    compute "save = income − expenses" if no category is tagged save.
    """
    start, end = _month_bounds(month, getattr(user, "month_start_day", 1) or 1)

    rows = (
        db.query(Category.bucket, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .outerjoin(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user.id,
            Transaction.occurred_on >= start,
            Transaction.occurred_on <= end,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
        )
        .group_by(Category.bucket)
        .all()
    )

    bucket_totals = {"need": 0, "want": 0, "save": 0, None: 0}
    for bucket, amt in rows:
        bucket_totals[bucket] = bucket_totals.get(bucket, 0) + (-int(amt))

    # Untagged expenses also include transactions with NULL category_id.
    untagged_no_cat = (
        db.query(func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(
            Transaction.user_id == user.id,
            Transaction.occurred_on >= start,
            Transaction.occurred_on <= end,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.category_id.is_(None),
        )
        .scalar()
        or 0
    )
    bucket_totals[None] = bucket_totals.get(None, 0) + (-int(untagged_no_cat))

    income_total = (
        db.query(func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(
            Transaction.user_id == user.id,
            Transaction.occurred_on >= start,
            Transaction.occurred_on <= end,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents > 0,
        )
        .scalar()
        or 0
    )

    return BucketBreakdown(
        need_cents=bucket_totals["need"],
        want_cents=bucket_totals["want"],
        save_cents=bucket_totals["save"],
        untagged_cents=bucket_totals[None],
        income_cents=int(income_total),
        period_start=start,
        period_end=end,
    )


@router.get("/spending-by-category", response_model=list[SpendingByCategory])
def spending_by_category(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(
            Category.id,
            Category.name,
            Category.color,
            func.coalesce(func.sum(Transaction.amount_cents), 0),
        )
        .outerjoin(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user.id,
            Transaction.occurred_on >= date_from,
            Transaction.occurred_on <= date_to,
            Transaction.amount_cents < 0,
        )
        .group_by(Category.id)
        .all()
    )
    return [
        SpendingByCategory(
            category_id=cid, category_name=name, color=color or "#E8E8E8", amount_cents=-amt
        )
        for cid, name, color, amt in rows
        if amt < 0
    ]


def _holdings_value_eur_cents(db: Session, user_id: int) -> int:
    """Sum the current EUR-equivalent market value of all holdings for a user.

    Used as a constant offset when historical net-worth points are computed —
    we don't have historical prices so we attribute today's holdings value to
    every point. Approximate but matches the live current balance shown
    elsewhere on the dashboard."""
    rows = (
        db.query(InvestmentHolding)
        .filter(InvestmentHolding.user_id == user_id)
        .all()
    )
    total = 0
    for h in rows:
        eur_price = h.last_price_eur if h.last_price_eur is not None else h.last_price
        if eur_price is None:
            continue
        total += int(round(h.shares * eur_price * 100))
    return total


def _compute_net_worth_series(
    db: Session,
    user_id: int,
    date_from: date,
    date_to: date,
    granularity: Literal["daily", "weekly", "monthly"] = "weekly",
) -> list[NetWorthPoint]:
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    if not accounts:
        return []
    holdings_value = _holdings_value_eur_cents(db, user_id)

    per_account: dict[int, list[tuple[date, int]]] = {a.id: [] for a in accounts}
    for account_id, occurred_on, amount_cents in (
        db.query(Transaction.account_id, Transaction.occurred_on, Transaction.amount_cents)
        .filter(Transaction.user_id == user_id, Transaction.occurred_on <= date_to)
        .order_by(Transaction.occurred_on.asc())
        .all()
    ):
        per_account[account_id].append((occurred_on, amount_cents))

    cursors = {a.id: 0 for a in accounts}
    running = {a.id: a.opening_balance_cents for a in accounts}

    def _advance_to(target: date) -> tuple[int, int]:
        for acc in accounts:
            items = per_account[acc.id]
            p = cursors[acc.id]
            while p < len(items) and items[p][0] <= target:
                running[acc.id] += items[p][1]
                p += 1
            cursors[acc.id] = p
        assets_total = 0
        liab_total = 0
        for acc in accounts:
            bal = running[acc.id]
            if acc.type in LIABILITY_TYPES:
                liab_total += abs(bal)
            else:
                assets_total += bal
        return assets_total, liab_total

    points: list[NetWorthPoint] = []

    def _emit(d: date) -> NetWorthPoint:
        assets_total, liab_total = _advance_to(d)
        # Holdings sit on top of cash assets — same constant offset for every
        # historical point because we don't track historical share prices.
        assets_total += holdings_value
        return NetWorthPoint(
            date=d,
            assets_cents=assets_total,
            liabilities_cents=liab_total,
            net_worth_cents=assets_total - liab_total,
        )

    if granularity == "monthly":
        cursor = date_from.replace(day=1)
        while cursor <= date_to:
            month_end = date(cursor.year, cursor.month, monthrange(cursor.year, cursor.month)[1])
            cutoff = min(month_end, date_to)
            points.append(_emit(cutoff))
            cursor = cursor + relativedelta(months=1)
        return points

    if granularity == "weekly":
        # ISO week end = Sunday. Snap date_from forward to the next Sunday, then step 7 days.
        first = date_from + timedelta(days=(6 - date_from.weekday()))
        if first > date_to:
            first = date_to
        cursor = first
        step = timedelta(days=7)
        while cursor <= date_to:
            points.append(_emit(cursor))
            if cursor == date_to:
                break
            cursor += step
            if cursor > date_to:
                cursor = date_to
        return points

    # daily
    cursor = date_from
    step = timedelta(days=1)
    while cursor <= date_to:
        points.append(_emit(cursor))
        cursor += step
    return points


class DataRangeOut(BaseModel):
    earliest_transaction: date | None
    latest_transaction: date | None


@router.get("/data-range", response_model=DataRangeOut)
def data_range(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    earliest = (
        db.query(func.min(Transaction.occurred_on))
        .filter(Transaction.user_id == user.id)
        .scalar()
    )
    latest = (
        db.query(func.max(Transaction.occurred_on))
        .filter(Transaction.user_id == user.id)
        .scalar()
    )
    return DataRangeOut(earliest_transaction=earliest, latest_transaction=latest)


@router.get("/net-worth", response_model=list[NetWorthPoint])
def net_worth_series(
    date_from: date = Query(..., alias="from"),
    date_to: date = Query(..., alias="to"),
    granularity: Literal["daily", "weekly", "monthly"] = Query("weekly"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _compute_net_worth_series(db, user.id, date_from, date_to, granularity)


class NetWorthForecastPoint(BaseModel):
    date: date
    point_cents: int
    lower_cents: int
    upper_cents: int


class NetWorthForecastParams(BaseModel):
    method: Literal["damped_holt"]
    alpha: float
    beta: float
    phi: float
    sigma_cents: int
    rmse_cents: int
    weekly_drag_cents: int
    weeks_used: int


class NetWorthForecastOut(BaseModel):
    history: list[NetWorthPoint]
    forecast: list[NetWorthForecastPoint]
    params: NetWorthForecastParams


@router.get("/net-worth/forecast", response_model=NetWorthForecastOut)
def net_worth_forecast(
    weeks: int = Query(26, ge=1, le=104),
    lookback_weeks: int = Query(52, ge=4, le=260),
    include_subscription_drag: bool = Query(True),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    history_from = today - timedelta(days=lookback_weeks * 7)
    history = _compute_net_worth_series(db, user.id, history_from, today, "weekly")

    if not history:
        return NetWorthForecastOut(
            history=[],
            forecast=[],
            params=NetWorthForecastParams(
                method="damped_holt",
                alpha=0.5,
                beta=0.1,
                phi=1.0,
                sigma_cents=0,
                rmse_cents=0,
                weekly_drag_cents=0,
                weeks_used=0,
            ),
        )

    ys = [p.net_worth_cents / 100.0 for p in history]
    fit = fit_damped_holt(ys)
    path = forecast_path(fit, weeks)
    bands_offsets = band(fit, weeks)

    # Known-drag adjustment from detected subscriptions
    weekly_drag = 0.0
    if include_subscription_drag:
        recurring_items = _compute_recurring(
            db, user.id, lookback_days=180, min_occurrences=3, include_ignored=False
        )
        subs = [
            i for i in recurring_items
            if i.classification == "subscription" and i.monthly_equivalent_cents < 0
        ]
        monthly_sub_cents = sum(i.monthly_equivalent_cents for i in subs)
        weekly_drag = monthly_sub_cents / 100.0 / 4.33  # EUR per week (negative)

    last_date = history[-1].date
    forecast_points: list[NetWorthForecastPoint] = []
    for h in range(1, weeks + 1):
        fdate = last_date + timedelta(days=7 * h)
        point_eur = path[h - 1] + h * weekly_drag
        lo, hi = bands_offsets[h - 1]
        forecast_points.append(
            NetWorthForecastPoint(
                date=fdate,
                point_cents=int(round(point_eur * 100)),
                lower_cents=int(round((point_eur + lo) * 100)),
                upper_cents=int(round((point_eur + hi) * 100)),
            )
        )

    return NetWorthForecastOut(
        history=history,
        forecast=forecast_points,
        params=NetWorthForecastParams(
            method="damped_holt",
            alpha=fit.alpha,
            beta=fit.beta,
            phi=fit.phi,
            sigma_cents=int(round(fit.sigma * 100)),
            rmse_cents=int(round(rmse(fit) * 100)),
            weekly_drag_cents=int(round(weekly_drag * 100)),
            weeks_used=len(history),
        ),
    )


class RecurringItem(BaseModel):
    key: str
    label: str
    cadence: Literal["weekly", "monthly", "yearly"]
    classification: Literal["subscription", "regular", "ignore"]
    is_user_set: bool
    count: int
    avg_amount_cents: int
    monthly_equivalent_cents: int
    last_seen: date
    next_expected: date


class ClassifyRequest(BaseModel):
    key: str
    classification: Literal["subscription", "regular", "ignore"] | None


_CADENCE_FACTORS = {"weekly": 4.33, "monthly": 1.0, "yearly": 1.0 / 12}


def _classify_cadence(median_days: float) -> str | None:
    if 6 <= median_days <= 9:
        return "weekly"
    if 25 <= median_days <= 35:
        return "monthly"
    if 355 <= median_days <= 380:
        return "yearly"
    return None


def _default_classification(cadence: str) -> str:
    # Auto-rule: monthly & yearly cadences are subscriptions; weekly is
    # "regular" (habit spending like daily lunches).
    return "subscription" if cadence in ("monthly", "yearly") else "regular"


def _compute_recurring(
    db: Session,
    user_id: int,
    lookback_days: int,
    min_occurrences: int,
    include_ignored: bool,
) -> list[RecurringItem]:
    today = date.today()
    since = today - timedelta(days=lookback_days)

    overrides = {
        row.key: row.classification
        for row in db.query(RecurringClassification).filter(
            RecurringClassification.user_id == user_id
        )
    }

    rows = (
        db.query(
            Transaction.amount_cents,
            Transaction.occurred_on,
            Transaction.description,
            Transaction.counterparty_name,
        )
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.occurred_on >= since,
        )
        .all()
    )

    groups: dict[tuple[int, str], list[tuple[int, date]]] = {}
    for amount, occurred_on, desc, cp in rows:
        if amount is None or occurred_on is None:
            continue
        label_src = (cp or desc or "").strip()
        if not label_src:
            continue
        norm = label_src.lower()[:40].strip()
        if not norm:
            continue
        sign = 1 if amount > 0 else -1
        groups.setdefault((sign, norm), []).append((int(amount), occurred_on))

    items: list[RecurringItem] = []
    for (sign, norm), events in groups.items():
        if len(events) < min_occurrences:
            continue
        events.sort(key=lambda e: e[1])
        dates = [e[1] for e in events]
        intervals = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
        median_days = statistics.median(intervals)
        cadence = _classify_cadence(median_days)
        if cadence is None:
            continue
        amounts = [e[0] for e in events]
        avg_amount = int(round(sum(amounts) / len(amounts)))
        monthly_equiv = int(round(avg_amount * _CADENCE_FACTORS[cadence]))
        last_seen = dates[-1]
        next_expected = last_seen + timedelta(days=int(round(median_days)))
        # Use the most recent real label (casing) rather than the lowercased key.
        display = None
        for e, d in zip(events, dates):
            if d == last_seen:
                # re-derive original from raw description/counterparty
                pass
        # Simpler: derive from the last event's source by re-fetching? Keep normalised (title-cased) instead.
        user_cls = overrides.get(norm)
        classification = user_cls or _default_classification(cadence)
        if classification == "ignore" and not include_ignored:
            continue
        items.append(
            RecurringItem(
                key=norm,
                label=norm.title(),
                cadence=cadence,
                classification=classification,
                is_user_set=user_cls is not None,
                count=len(events),
                avg_amount_cents=avg_amount,
                monthly_equivalent_cents=monthly_equiv,
                last_seen=last_seen,
                next_expected=next_expected,
            )
        )

    items.sort(key=lambda i: abs(i.monthly_equivalent_cents), reverse=True)
    return items[:40]


@router.get("/recurring", response_model=list[RecurringItem])
def recurring(
    lookback_days: int = Query(180, ge=30, le=720),
    min_occurrences: int = Query(3, ge=2, le=20),
    include_ignored: bool = Query(False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _compute_recurring(db, user.id, lookback_days, min_occurrences, include_ignored)


class LocationItem(BaseModel):
    city: str
    country: str | None
    label: str
    count: int
    total_spent_cents: int  # positive number = money spent there
    last_visit: date
    lat: float | None = None
    lon: float | None = None


@router.get("/locations", response_model=list[LocationItem])
async def locations(
    lookback_days: int = Query(365, ge=30, le=1095),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    since = today - timedelta(days=lookback_days)

    rows = (
        db.query(
            Transaction.location_city,
            Transaction.location_country,
            Transaction.amount_cents,
            Transaction.occurred_on,
        )
        .filter(
            Transaction.user_id == user.id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= since,
            Transaction.location_city.isnot(None),
        )
        .all()
    )

    bucket: dict[tuple[str, str | None], dict] = {}
    for city, country, amt, d in rows:
        key = (city, country)
        b = bucket.setdefault(
            key,
            {"city": city, "country": country, "count": 0, "total": 0, "last": d},
        )
        b["count"] += 1
        b["total"] += -(amt or 0)
        if d and (b["last"] is None or d > b["last"]):
            b["last"] = d

    # Geocode all unique (city, country) pairs (cached in geocode_cache table).
    pairs = [(b["city"], b["country"]) for b in bucket.values()]
    coords_map = await geocode_pairs(db, pairs)

    items = []
    for b in bucket.values():
        coords = coords_map.get((b["country"] or None, (b["city"] or "").upper().strip()))
        items.append(
            LocationItem(
                city=b["city"],
                country=b["country"],
                label=f"{b['city']}, {b['country']}" if b["country"] else b["city"],
                count=b["count"],
                total_spent_cents=b["total"],
                last_visit=b["last"],
                lat=coords[0] if coords else None,
                lon=coords[1] if coords else None,
            )
        )
    items.sort(key=lambda x: x.count, reverse=True)
    return items[:25]


class MerchantMonthly(BaseModel):
    month: str
    amount_cents: int


class MerchantSummary(BaseModel):
    merchant: str
    total_cents: int
    transactions: int
    avg_cents: int
    last_seen: date
    first_seen: date
    top_category: str | None
    monthly: list[MerchantMonthly]  # last 12 months, oldest → newest


@router.get("/merchants", response_model=list[MerchantSummary])
def merchants(
    months: int = Query(12, ge=1, le=36),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    # earliest month to include
    start = today.replace(day=1)
    for _ in range(months - 1):
        if start.month == 1:
            start = start.replace(year=start.year - 1, month=12)
        else:
            start = start.replace(month=start.month - 1)
    earliest = start

    rows = (
        db.query(
            Transaction.merchant,
            Transaction.amount_cents,
            Transaction.occurred_on,
            Transaction.category_id,
        )
        .filter(
            Transaction.user_id == user.id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.merchant.isnot(None),
            Transaction.occurred_on >= earliest,
        )
        .all()
    )

    cat_names = {
        c.id: c.name for c in db.query(Category).filter(Category.user_id == user.id).all()
    }

    by_merchant: dict[str, dict] = {}
    for merch, amt, occurred, cat_id in rows:
        if not merch:
            continue
        b = by_merchant.setdefault(
            merch,
            {
                "total": 0,
                "n": 0,
                "first": occurred,
                "last": occurred,
                "monthly": {},
                "cat_counts": {},
            },
        )
        b["total"] += -int(amt)
        b["n"] += 1
        if occurred < b["first"]:
            b["first"] = occurred
        if occurred > b["last"]:
            b["last"] = occurred
        ym = occurred.strftime("%Y-%m")
        b["monthly"][ym] = b["monthly"].get(ym, 0) + -int(amt)
        if cat_id:
            b["cat_counts"][cat_id] = b["cat_counts"].get(cat_id, 0) + 1

    # Build the full month-axis so empty months show as 0 in the trend chart.
    month_axis: list[str] = []
    cur = earliest
    for _ in range(months):
        month_axis.append(cur.strftime("%Y-%m"))
        if cur.month == 12:
            cur = cur.replace(year=cur.year + 1, month=1)
        else:
            cur = cur.replace(month=cur.month + 1)

    out: list[MerchantSummary] = []
    for merch, b in by_merchant.items():
        top_cat_id = (
            max(b["cat_counts"], key=b["cat_counts"].get) if b["cat_counts"] else None
        )
        out.append(
            MerchantSummary(
                merchant=merch,
                total_cents=b["total"],
                transactions=b["n"],
                avg_cents=int(round(b["total"] / b["n"])) if b["n"] else 0,
                first_seen=b["first"],
                last_seen=b["last"],
                top_category=cat_names.get(top_cat_id) if top_cat_id else None,
                monthly=[
                    MerchantMonthly(month=ym, amount_cents=b["monthly"].get(ym, 0))
                    for ym in month_axis
                ],
            )
        )

    out.sort(key=lambda m: m.total_cents, reverse=True)
    return out


@router.post("/recurring/classify")
def classify_recurring(
    body: ClassifyRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    key = (body.key or "").strip().lower()
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    existing = (
        db.query(RecurringClassification)
        .filter(RecurringClassification.user_id == user.id, RecurringClassification.key == key)
        .first()
    )
    if body.classification is None:
        if existing:
            db.delete(existing)
            db.commit()
        return {"ok": True, "cleared": True}
    if existing:
        existing.classification = body.classification
    else:
        db.add(
            RecurringClassification(
                user_id=user.id, key=key, classification=body.classification
            )
        )
    db.commit()
    return {"ok": True, "classification": body.classification}


@router.get("/net-worth/current")
def current_net_worth(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    today = date.today()
    accounts = db.query(Account).filter(Account.user_id == user.id).all()
    tx_totals = dict(
        db.query(Transaction.account_id, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.user_id == user.id, Transaction.occurred_on <= today)
        .group_by(Transaction.account_id)
        .all()
    )
    assets = liab = 0
    for acc in accounts:
        bal = acc.opening_balance_cents + tx_totals.get(acc.id, 0)
        if acc.type in LIABILITY_TYPES:
            liab += abs(bal)
        else:
            assets += bal
    holdings_value = _holdings_value_eur_cents(db, user.id)
    assets += holdings_value
    return {
        "date": today,
        "assets_cents": assets,
        "liabilities_cents": liab,
        "net_worth_cents": assets - liab,
        "holdings_value_cents": holdings_value,
    }


# ---------------------------------------------------------------------------
# AI dashboard summary
# ---------------------------------------------------------------------------


class AiSummaryOut(BaseModel):
    summary: str
    generated_at: date
    model: str


def _build_dashboard_context(db: Session, user_id: int) -> dict:
    today = date.today()

    # Accounts
    accounts = db.query(Account).filter(Account.user_id == user_id).all()
    tx_totals = dict(
        db.query(Transaction.account_id, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.user_id == user_id)
        .group_by(Transaction.account_id)
        .all()
    )
    assets = liab = 0
    account_rows = []
    for acc in accounts:
        bal = acc.opening_balance_cents + tx_totals.get(acc.id, 0)
        is_liab = acc.type in LIABILITY_TYPES
        if is_liab:
            liab += abs(bal)
        else:
            assets += bal
        account_rows.append(
            {
                "name": acc.name,
                "type": acc.type,
                "balance_eur": round(bal / 100, 2),
                "is_asset": not is_liab,
            }
        )

    # Current month summary
    month_start = today.replace(day=1)
    month_end = date(today.year, today.month, monthrange(today.year, today.month)[1])
    month_rows = (
        db.query(Transaction.amount_cents)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.occurred_on >= month_start,
            Transaction.occurred_on <= month_end,
        )
        .all()
    )
    month_income = sum(r[0] for r in month_rows if r[0] > 0)
    month_expenses = -sum(r[0] for r in month_rows if r[0] < 0)

    # Average monthly expenses across all months
    month_expr = func.strftime("%Y-%m", Transaction.occurred_on)
    all_month_rows = (
        db.query(month_expr.label("ym"), func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"))
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
        )
        .group_by("ym")
        .all()
    )
    months_sampled = len(all_month_rows)
    avg_monthly_expenses = (
        round((sum(r.spent for r in all_month_rows) / months_sampled) / 100, 2) if months_sampled else 0
    )

    # Top expense categories (last 90 days)
    since = today - timedelta(days=90)
    cat_rows = (
        db.query(
            Category.name,
            func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= since,
        )
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount_cents).asc())
        .limit(8)
        .all()
    )
    top_categories_90d = [
        {"name": name, "spent_eur": round(spent / 100, 2)} for name, spent in cat_rows
    ]

    # Recurring: subscriptions + regular
    recurring_items = _compute_recurring(db, user_id, 180, 3, include_ignored=False)
    subs = [
        {
            "label": i.label,
            "cadence": i.cadence,
            "monthly_eur": round(i.monthly_equivalent_cents / 100, 2),
        }
        for i in recurring_items
        if i.classification == "subscription" and i.monthly_equivalent_cents < 0
    ]
    regular = [
        {
            "label": i.label,
            "cadence": i.cadence,
            "monthly_eur": round(i.monthly_equivalent_cents / 100, 2),
        }
        for i in recurring_items
        if i.classification == "regular" and i.monthly_equivalent_cents < 0
    ]

    # Locations (top 5 by visits, last year)
    loc_rows = (
        db.query(
            Transaction.location_city,
            Transaction.location_country,
            func.count("*").label("count"),
            func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"),
        )
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.location_city.isnot(None),
        )
        .group_by(Transaction.location_city, Transaction.location_country)
        .order_by(func.count("*").desc())
        .limit(5)
        .all()
    )
    top_locations = [
        {"city": c, "country": co, "visits": cnt, "spent_eur": round(spent / 100, 2)}
        for c, co, cnt, spent in loc_rows
    ]

    # Forecast
    try:
        history_from = today - timedelta(days=52 * 7)
        history = _compute_net_worth_series(db, user_id, history_from, today, "weekly")
        if len(history) >= 3:
            ys = [p.net_worth_cents / 100.0 for p in history]
            fit = fit_damped_holt(ys)
            path = forecast_path(fit, 26)
            bands = band(fit, 26)
            fc_26 = round(path[-1], 2)
            fc_low = round(path[-1] + bands[-1][0], 2)
            fc_high = round(path[-1] + bands[-1][1], 2)
        else:
            fc_26 = fc_low = fc_high = None
    except Exception:
        fc_26 = fc_low = fc_high = None

    return {
        "today": today.isoformat(),
        "net_worth_eur": round((assets - liab) / 100, 2),
        "assets_eur": round(assets / 100, 2),
        "liabilities_eur": round(liab / 100, 2),
        "accounts": account_rows,
        "this_month": {
            "income_eur": round(month_income / 100, 2),
            "expenses_eur": round(month_expenses / 100, 2),
            "net_eur": round((month_income - month_expenses) / 100, 2),
        },
        "avg_monthly_expenses_eur": avg_monthly_expenses,
        "months_sampled": months_sampled,
        "top_categories_last_90d": top_categories_90d,
        "subscriptions": subs,
        "regular_recurring": regular,
        "top_locations_last_year": top_locations,
        "forecast_6m": {
            "point_eur": fc_26,
            "band_eur": [fc_low, fc_high] if fc_26 is not None else None,
        },
    }


_SUMMARY_PROMPT = """You are a friendly personal-finance analyst writing an elaborate weekly briefing for one user. You have been given a structured snapshot of their finances.

Write a narrative summary in Markdown (~350–550 words) addressed to the user in second person ("you"). Structure it as short sections with `##` headings:

1. **## Where you stand** — net worth right now, how assets and liabilities break down, and what that means in plain language. Call out the biggest-balance account.
2. **## This month so far** — income vs. expenses for this calendar month, how they compare to your 3-month average expense, and whether the month is trending net-positive or net-negative.
3. **## Where your money is going** — top 3-5 expense categories over the last 90 days with EUR figures, plus a quick read on whether any category looks outsized.
4. **## Subscriptions & regular spend** — list detected subscriptions (if any) with monthly cost; call out the weekly "regular spend" (e.g. lunch spots) with their monthly equivalent. If there are none, say so plainly rather than inventing.
5. **## Places** — one or two sentences on where you've been shopping most (cities, countries) if data exists.
6. **## Six-month outlook** — cite the forecast point and band; explain in one sentence what "band" means (uncertainty). If the band straddles zero or suggests slow growth, call that out honestly.
7. **## One suggestion** — a single concrete, non-generic action the user could take based on the data above. No cliché advice.

Rules:
- Cite exact EUR figures from the snapshot, formatted as "€1,234.56".
- Never invent numbers. If a section has no data, write a short honest line instead of padding.
- No JSON or code blocks. No disclaimers longer than a single sentence.
- Keep tone warm but specific.

Snapshot:
```json
{snapshot}
```
"""


@router.post("/ai-summary", response_model=AiSummaryOut)
async def ai_summary(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not settings.genai_enabled:
        raise HTTPException(
            status_code=400, detail="AI is unavailable — set GENAI_API_KEY in the backend .env"
        )
    context = _build_dashboard_context(db, user.id)
    prompt = _SUMMARY_PROMPT.format(snapshot=json.dumps(context, ensure_ascii=False, indent=2))
    text = await llm_complete(prompt, model=settings.genai_chat_model)
    return AiSummaryOut(
        summary=text.strip(),
        generated_at=date.today(),
        model=settings.genai_chat_model,
    )


# ---------------------------------------------------------------------------
# AI expense report — focused on a specific month, more detail than the dashboard summary
# ---------------------------------------------------------------------------


def _build_expense_report_context(db: Session, user_id: int, month: str) -> dict:
    """Rich expense-focused snapshot for a single month."""
    m_start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    m_end = date(m_start.year, m_start.month, monthrange(m_start.year, m_start.month)[1])
    days_in_month = monthrange(m_start.year, m_start.month)[1]

    # Aggregate income/expenses for this month and the prior one
    def _month_agg(start: date, end: date) -> dict:
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
        income = sum(r[0] for r in rows if r[0] > 0)
        expenses = -sum(r[0] for r in rows if r[0] < 0)
        return {"income": income, "expenses": expenses, "count": len(rows)}

    this_m = _month_agg(m_start, m_end)
    prev_start = (m_start.replace(day=1) - timedelta(days=1)).replace(day=1)
    prev_end = date(prev_start.year, prev_start.month, monthrange(prev_start.year, prev_start.month)[1])
    prev_m = _month_agg(prev_start, prev_end)

    # Categories in the target month
    cat_rows = (
        db.query(
            Category.name,
            func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"),
            func.count("*").label("n"),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= m_start,
            Transaction.occurred_on <= m_end,
        )
        .group_by(Category.name)
        .order_by(func.sum(Transaction.amount_cents).asc())
        .limit(12)
        .all()
    )
    # And same categories in prior month for delta
    prev_cat_rows = dict(
        db.query(
            Category.name,
            func.coalesce(func.sum(-Transaction.amount_cents), 0),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= prev_start,
            Transaction.occurred_on <= prev_end,
        )
        .group_by(Category.name)
        .all()
    )
    categories_breakdown = []
    for name, spent, n in cat_rows:
        prev = int(prev_cat_rows.get(name, 0))
        delta_pct = round(((spent - prev) / prev * 100), 1) if prev > 0 else None
        categories_breakdown.append(
            {
                "name": name,
                "spent_eur": round(spent / 100, 2),
                "transactions": n,
                "prev_month_eur": round(prev / 100, 2),
                "delta_pct": delta_pct,
            }
        )
    uncategorised = (
        db.query(func.coalesce(func.sum(-Transaction.amount_cents), 0))
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.category_id.is_(None),
            Transaction.occurred_on >= m_start,
            Transaction.occurred_on <= m_end,
        )
        .scalar()
        or 0
    )

    # Top merchants
    merchant_rows = (
        db.query(
            Transaction.merchant,
            func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"),
            func.count("*").label("n"),
        )
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.merchant.isnot(None),
            Transaction.occurred_on >= m_start,
            Transaction.occurred_on <= m_end,
        )
        .group_by(Transaction.merchant)
        .order_by(func.sum(Transaction.amount_cents).asc())
        .limit(10)
        .all()
    )
    top_merchants = [
        {"name": name, "spent_eur": round(spent / 100, 2), "transactions": n}
        for name, spent, n in merchant_rows
    ]

    # Largest single expenses
    big_rows = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= m_start,
            Transaction.occurred_on <= m_end,
        )
        .order_by(Transaction.amount_cents.asc())
        .limit(5)
        .all()
    )
    biggest_single = [
        {
            "date": t.occurred_on.isoformat(),
            "amount_eur": round(-t.amount_cents / 100, 2),
            "merchant": t.merchant,
            "description": t.description,
        }
        for t in big_rows
    ]

    # Subscriptions / regular recurring (using existing detector)
    recurring_items = _compute_recurring(db, user_id, 180, 3, include_ignored=False)
    subs = [
        {
            "label": i.label,
            "cadence": i.cadence,
            "monthly_eur": round(i.monthly_equivalent_cents / 100, 2),
        }
        for i in recurring_items
        if i.classification == "subscription" and i.monthly_equivalent_cents < 0
    ]
    regular = [
        {
            "label": i.label,
            "cadence": i.cadence,
            "monthly_eur": round(i.monthly_equivalent_cents / 100, 2),
        }
        for i in recurring_items
        if i.classification == "regular" and i.monthly_equivalent_cents < 0
    ]

    # Locations during the target month
    loc_rows = (
        db.query(
            Transaction.location_city,
            Transaction.location_country,
            func.count("*").label("n"),
            func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"),
        )
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.location_city.isnot(None),
            Transaction.occurred_on >= m_start,
            Transaction.occurred_on <= m_end,
        )
        .group_by(Transaction.location_city, Transaction.location_country)
        .order_by(func.sum(Transaction.amount_cents).asc())
        .limit(8)
        .all()
    )
    locations = [
        {"city": c, "country": co, "visits": n, "spent_eur": round(spent / 100, 2)}
        for c, co, n, spent in loc_rows
    ]

    # Money invested (transfers into investment accounts during month)
    inv_acc_ids = [
        a.id for a in db.query(Account).filter(
            Account.user_id == user_id, Account.type == "investment"
        ).all()
    ]
    invested = 0
    if inv_acc_ids:
        invested = int(
            db.query(func.coalesce(func.sum(Transaction.amount_cents), 0))
            .filter(
                Transaction.user_id == user_id,
                Transaction.account_id.in_(inv_acc_ids),
                Transaction.transfer_group_id.isnot(None),
                Transaction.amount_cents > 0,
                Transaction.occurred_on >= m_start,
                Transaction.occurred_on <= m_end,
            )
            .scalar()
            or 0
        )

    return {
        "month": month,
        "month_label": m_start.strftime("%B %Y"),
        "days_in_month": days_in_month,
        "totals": {
            "income_eur": round(this_m["income"] / 100, 2),
            "expenses_eur": round(this_m["expenses"] / 100, 2),
            "net_eur": round((this_m["income"] - this_m["expenses"]) / 100, 2),
            "transaction_count": this_m["count"],
        },
        "previous_month": {
            "label": prev_start.strftime("%B %Y"),
            "income_eur": round(prev_m["income"] / 100, 2),
            "expenses_eur": round(prev_m["expenses"] / 100, 2),
        },
        "categories": categories_breakdown,
        "uncategorised_eur": round(uncategorised / 100, 2),
        "top_merchants": top_merchants,
        "biggest_single_expenses": biggest_single,
        "subscriptions": subs,
        "regular_recurring": regular,
        "locations": locations,
        "invested_into_investment_accounts_eur": round(invested / 100, 2),
    }


_EXPENSE_REPORT_PROMPT = """You are a senior financial analyst writing a detailed monthly expense report for a single user. The audience is the user themselves.

Write in Markdown, ~500–750 words. Use second person ("you"). Be specific and grounded. Cite exact EUR figures from the snapshot, formatted as "€1,234.56". Do NOT invent any numbers or merchants the snapshot doesn't contain.

Structure with these `##` sections in this order:

1. **## Executive summary** — 2-3 sentence verdict on the month: total spent, headline trend vs prior month, whether you ran net-positive.
2. **## By the numbers** — a small markdown table with Income / Expenses / Net / # Transactions, and a one-line comparison to the prior month.
3. **## Where the money went** — a markdown table of the top categories with €amount, # transactions, and % change vs prior month. Mention the uncategorised total if it's material.
4. **## Top merchants** — markdown table of the top merchants with €amount and # visits.
5. **## Notable single expenses** — bullet list of the largest individual transactions.
6. **## Recurring spend** — short paragraph describing detected subscriptions and regular weekly spend with their monthly equivalents. If empty, say so plainly.
7. **## Travel & places** (only if `locations` is non-empty) — one short paragraph on cities/countries you spent in.
8. **## Investing** (only if `invested_into_investment_accounts_eur > 0`) — one sentence on how much you moved into investment accounts, framed as part of your savings.
9. **## Recommendations** — 3-5 actionable, NON-generic bullets grounded in the numbers above. No clichés like "make a budget".

Style rules:
- Use Markdown tables with proper headers and pipe formatting.
- Round percentages to whole numbers; round EUR to 2 decimals.
- Sound calm and analytical, never alarmist or preachy.
- If a section has nothing meaningful, say so in one short line rather than padding.

Snapshot:
```json
{snapshot}
```
"""


class ExpenseReportOut(BaseModel):
    month: str
    report: str
    generated_at: date
    model: str


@router.post("/ai-expense-report", response_model=ExpenseReportOut)
async def ai_expense_report(
    month: str | None = Query(None, description="YYYY-MM; defaults to current month"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not settings.genai_enabled:
        raise HTTPException(
            status_code=400, detail="AI is unavailable — set GENAI_API_KEY in the backend .env"
        )
    today = date.today()
    target = month or today.strftime("%Y-%m")
    try:
        datetime.strptime(target, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")

    context = _build_expense_report_context(db, user.id, target)
    prompt = _EXPENSE_REPORT_PROMPT.format(
        snapshot=json.dumps(context, ensure_ascii=False, indent=2)
    )
    text = await llm_complete(prompt, model=settings.genai_chat_model)
    return ExpenseReportOut(
        month=target,
        report=text.strip(),
        generated_at=date.today(),
        model=settings.genai_chat_model,
    )


# ---------------------------------------------------------------------------
# Spending-by-month + insights
# ---------------------------------------------------------------------------


class TopCategory(BaseModel):
    name: str
    amount_cents: int


class MonthlySpending(BaseModel):
    month: str  # YYYY-MM
    income_cents: int
    expenses_cents: int
    net_cents: int
    top_category: TopCategory | None


def _month_iter(start_year: int, start_month: int, n: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    y, m = start_year, start_month
    for _ in range(n):
        out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


@router.get("/spending-by-month", response_model=list[MonthlySpending])
def spending_by_month(
    months: int = Query(12, ge=1, le=36),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    # Last `months` calendar months ending in the current month, ordered oldest→newest.
    start = today.replace(day=1)
    for _ in range(months - 1):
        if start.month == 1:
            start = start.replace(year=start.year - 1, month=12)
        else:
            start = start.replace(month=start.month - 1)
    earliest = date(start.year, start.month, 1)

    # Aggregate per-month income and expenses
    rows = (
        db.query(
            func.strftime("%Y-%m", Transaction.occurred_on).label("ym"),
            Transaction.amount_cents,
        )
        .filter(
            Transaction.user_id == user.id,
            Transaction.transfer_group_id.is_(None),
            Transaction.occurred_on >= earliest,
        )
        .all()
    )
    agg: dict[str, dict[str, int]] = {}
    for ym, amt in rows:
        b = agg.setdefault(ym, {"income": 0, "expenses": 0})
        if amt > 0:
            b["income"] += amt
        elif amt < 0:
            b["expenses"] += -amt

    # Top expense category per month
    top_rows = (
        db.query(
            func.strftime("%Y-%m", Transaction.occurred_on).label("ym"),
            Category.name,
            func.coalesce(func.sum(-Transaction.amount_cents), 0).label("spent"),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user.id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= earliest,
        )
        .group_by("ym", Category.name)
        .all()
    )
    top_per_month: dict[str, tuple[str, int]] = {}
    for ym, name, spent in top_rows:
        cur = top_per_month.get(ym)
        if cur is None or spent > cur[1]:
            top_per_month[ym] = (name, int(spent))

    out: list[MonthlySpending] = []
    for y, m in _month_iter(start.year, start.month, months):
        ym = f"{y:04d}-{m:02d}"
        b = agg.get(ym, {"income": 0, "expenses": 0})
        top = top_per_month.get(ym)
        out.append(
            MonthlySpending(
                month=ym,
                income_cents=b["income"],
                expenses_cents=b["expenses"],
                net_cents=b["income"] - b["expenses"],
                top_category=TopCategory(name=top[0], amount_cents=top[1]) if top else None,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Insights — deterministic, rule-based observations
# ---------------------------------------------------------------------------


class Insight(BaseModel):
    kind: str
    severity: Literal["good", "neutral", "warn"]
    headline: str
    message: str
    value: float | None = None  # raw numeric (e.g. percent, EUR) for client-side use


@router.get("/insights", response_model=list[Insight])
def insights(
    month: str | None = Query(None, description="YYYY-MM; defaults to current month"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    out: list[Insight] = []

    monthly = spending_by_month(months=12, user=user, db=db)  # reuse aggregator
    by_ym = {m.month: m for m in monthly}
    target_ym = (month or today.strftime("%Y-%m"))
    this_month = by_ym.get(target_ym)
    is_current_month = target_ym == today.strftime("%Y-%m")
    target_label = (
        "this month"
        if is_current_month
        else datetime.strptime(target_ym, "%Y-%m").strftime("%B %Y").lower()
    )

    completed = [m for m in monthly if m.month < target_ym][-12:]

    # 1. month_over_month
    if this_month and len(completed) >= 1:
        last = completed[-1]
        diff = this_month.expenses_cents - last.expenses_cents
        pct = (diff / last.expenses_cents * 100) if last.expenses_cents > 0 else None
        sev = "neutral"
        if pct is not None:
            sev = "warn" if pct > 10 else "good" if pct < -10 else "neutral"
        out.append(
            Insight(
                kind="month_over_month",
                severity=sev,
                headline=(
                    "—" if pct is None else f"{'+' if pct >= 0 else ''}{pct:.0f}% vs prior month"
                ),
                message=(
                    f"{target_label.capitalize()}: €{this_month.expenses_cents/100:,.0f} expenses vs "
                    f"€{last.expenses_cents/100:,.0f} the month before."
                ),
                value=pct,
            )
        )

    # 2. vs 3-month median
    if this_month and len(completed) >= 3:
        last3 = [m.expenses_cents for m in completed[-3:]]
        median3 = statistics.median(last3)
        if median3 > 0:
            pct = (this_month.expenses_cents - median3) / median3 * 100
            sev = "warn" if pct > 15 else "good" if pct < -15 else "neutral"
            out.append(
                Insight(
                    kind="vs_3m_median",
                    severity=sev,
                    headline=f"{'+' if pct >= 0 else ''}{pct:.0f}% vs 3-month median",
                    message=(
                        f"Median of the prior 3 months: €{median3/100:,.0f}; "
                        f"{target_label}: €{this_month.expenses_cents/100:,.0f}."
                    ),
                    value=pct,
                )
            )

    # 3. pace projection — only meaningful for the current month
    if this_month and is_current_month:
        days_in_month = monthrange(today.year, today.month)[1]
        days_elapsed = today.day
        if days_elapsed >= 1:
            projected = this_month.expenses_cents / days_elapsed * days_in_month
            avg_complete = (
                statistics.median([m.expenses_cents for m in completed[-3:]])
                if len(completed) >= 1
                else None
            )
            sev = "neutral"
            if avg_complete:
                sev = "warn" if projected > avg_complete * 1.15 else "good" if projected < avg_complete * 0.85 else "neutral"
            out.append(
                Insight(
                    kind="pace_projection",
                    severity=sev,
                    headline=f"On pace for ~€{projected/100:,.0f}",
                    message=(
                        f"At day {days_elapsed} of {days_in_month}, you've spent "
                        f"€{this_month.expenses_cents/100:,.0f}. Linear projection "
                        f"to month-end: €{projected/100:,.0f}."
                    ),
                    value=projected / 100,
                )
            )

    # 3b. invested this month — money you sent to investment accounts is filtered
    # out of the spending aggregates above (transfer_group_id IS NOT NULL), so
    # surface it explicitly.
    investment_accounts = (
        db.query(Account)
        .filter(Account.user_id == user.id, Account.type == "investment")
        .all()
    )
    if investment_accounts and this_month:
        m_start = datetime.strptime(target_ym, "%Y-%m").date().replace(day=1)
        m_end = date(m_start.year, m_start.month, monthrange(m_start.year, m_start.month)[1])
        invested_total = (
            db.query(func.coalesce(func.sum(Transaction.amount_cents), 0))
            .filter(
                Transaction.user_id == user.id,
                Transaction.account_id.in_([a.id for a in investment_accounts]),
                Transaction.transfer_group_id.isnot(None),
                Transaction.amount_cents > 0,
                Transaction.occurred_on >= m_start,
                Transaction.occurred_on <= m_end,
            )
            .scalar()
            or 0
        )
        if invested_total > 0:
            out.append(
                Insight(
                    kind="invested_this_month",
                    severity="good",
                    headline=f"Invested €{invested_total/100:,.0f}",
                    message=(
                        f"You moved €{invested_total/100:,.0f} into your investment "
                        f"account{'s' if len(investment_accounts) > 1 else ''} "
                        f"({', '.join(a.name for a in investment_accounts)}) {target_label}."
                    ),
                    value=invested_total / 100,
                )
            )

    # 4. top category trend (last 30 vs prior 30)
    cutoff_recent = today - timedelta(days=30)
    cutoff_older = today - timedelta(days=60)
    cat_rows = (
        db.query(
            Category.name,
            func.coalesce(
                func.sum(
                    func.iif(Transaction.occurred_on >= cutoff_recent, -Transaction.amount_cents, 0)
                ),
                0,
            ).label("recent"),
            func.coalesce(
                func.sum(
                    func.iif(
                        Transaction.occurred_on < cutoff_recent,
                        -Transaction.amount_cents,
                        0,
                    )
                ),
                0,
            ).label("older"),
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user.id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= cutoff_older,
        )
        .group_by(Category.name)
        .all()
    )
    if cat_rows:
        # pick the largest category in the recent window
        cat_rows.sort(key=lambda r: r.recent, reverse=True)
        top = cat_rows[0]
        if top.recent > 0:
            pct = ((top.recent - top.older) / top.older * 100) if top.older > 0 else None
            sev = "neutral"
            if pct is not None:
                sev = "warn" if pct > 25 else "good" if pct < -25 else "neutral"
            out.append(
                Insight(
                    kind="top_category_trend",
                    severity=sev,
                    headline=(
                        f"{top.name}: €{top.recent/100:,.0f}"
                        + ("" if pct is None else f" ({'+' if pct >= 0 else ''}{pct:.0f}%)")
                    ),
                    message=(
                        f"{top.name} is your top expense category in the last 30 days "
                        f"(€{top.recent/100:,.0f})"
                        + (
                            f"; that's "
                            f"€{top.older/100:,.0f} in the 30 days before."
                            if top.older > 0
                            else "; no spend in the prior 30 days."
                        )
                    ),
                    value=pct,
                )
            )

    # 5. subscription share
    recurring_items = _compute_recurring(db, user.id, 180, 3, include_ignored=False)
    sub_monthly = sum(
        i.monthly_equivalent_cents for i in recurring_items
        if i.classification == "subscription" and i.monthly_equivalent_cents < 0
    )
    if sub_monthly < 0 and len(completed) >= 1:
        last = completed[-1]
        share = abs(sub_monthly) / last.expenses_cents * 100 if last.expenses_cents > 0 else 0
        sev = "warn" if share > 25 else "neutral"
        out.append(
            Insight(
                kind="subscription_share",
                severity=sev,
                headline=f"€{abs(sub_monthly)/100:,.0f}/mo in subscriptions",
                message=(
                    f"Detected subscriptions account for ~{share:.0f}% of last month's "
                    f"€{last.expenses_cents/100:,.0f} in expenses."
                ),
                value=share,
            )
        )

    # 6. savings rate trend (median of last 3 completed months' net cashflow)
    if len(completed) >= 3:
        nets = [m.net_cents for m in completed[-3:]]
        incomes = [m.income_cents for m in completed[-3:]]
        # rate = net/income per month, median across 3
        rates = [
            (n / i) if i > 0 else 0.0
            for n, i in zip(nets, incomes)
        ]
        rate3 = statistics.median(rates)
        sev = "good" if rate3 >= 0.2 else "warn" if rate3 < 0 else "neutral"
        out.append(
            Insight(
                kind="savings_rate_trend",
                severity=sev,
                headline=f"3-month savings rate: {rate3*100:.0f}%",
                message=(
                    f"Median of the last 3 completed months' net cashflow / income."
                ),
                value=rate3 * 100,
            )
        )

    # 7. Net-worth attribution (saving vs market gains)
    if this_month:
        cashflow_cents = this_month.income_cents - this_month.expenses_cents
        # Investment market gains = current holdings value − cost basis paid into them.
        # Approx for "this month": delta in shares × current price minus cost basis
        # is hard without historical prices. Pragmatic fallback: assume the cashflow
        # is the "saved" portion and treat any *additional* growth in net worth this
        # month over cashflow as market gains. We don't have a "net worth at month
        # start" snapshot, so we infer: market_delta = total_holdings_value_cents
        # minus sum_of_holding_cost_basis. That's lifetime PnL though. For "this
        # month", we report the cashflow component plainly and the *current*
        # unrealised PnL across all holdings as the market component the user
        # has accumulated.
        holdings_rows = (
            db.query(InvestmentHolding)
            .filter(InvestmentHolding.user_id == user.id)
            .all()
        )
        market_pnl = 0
        cost_basis = 0
        for h in holdings_rows:
            eur_price = h.last_price_eur if h.last_price_eur is not None else h.last_price
            if eur_price is None:
                continue
            market_value = int(round(h.shares * eur_price * 100))
            market_pnl += market_value - (h.cost_basis_cents or 0)
            cost_basis += h.cost_basis_cents or 0
        sev = "good" if cashflow_cents >= 0 else "warn"
        if holdings_rows:
            out.append(
                Insight(
                    kind="net_worth_attribution",
                    severity=sev,
                    headline=(
                        f"Saved €{cashflow_cents / 100:,.0f} {target_label} · "
                        f"market PnL €{market_pnl / 100:+,.0f}"
                    ),
                    message=(
                        f"Operational savings (income − expenses, excl. transfers): "
                        f"€{cashflow_cents / 100:,.0f}. Unrealised market gains across "
                        f"all holdings: €{market_pnl / 100:+,.0f} on a €{cost_basis / 100:,.0f} cost basis."
                    ),
                    value=cashflow_cents / 100,
                )
            )

    # 8. Subscription velocity — new subscriptions detected in the last 90 days
    recurring_now = _compute_recurring(db, user.id, 180, 3, include_ignored=False)
    subs_now = [
        i for i in recurring_now
        if i.classification == "subscription" and i.monthly_equivalent_cents < 0
    ]
    if subs_now:
        cutoff = today - timedelta(days=90)
        # "new" = first_seen falls within the last 90 days. Need first_seen per key.
        first_seen_rows = (
            db.query(
                func.lower(
                    func.coalesce(Transaction.counterparty_name, Transaction.description)
                ).label("key"),
                func.min(Transaction.occurred_on).label("first_seen"),
            )
            .filter(
                Transaction.user_id == user.id,
                Transaction.transfer_group_id.is_(None),
                Transaction.amount_cents < 0,
            )
            .group_by("key")
            .all()
        )
        first_seen_map = {(r.key or "")[:40].strip(): r.first_seen for r in first_seen_rows}
        new_subs = []
        for s in subs_now:
            fs = first_seen_map.get(s.key)
            if fs and fs >= cutoff:
                new_subs.append(s)
        if new_subs:
            total_new_monthly = sum(i.monthly_equivalent_cents for i in new_subs)
            sev = "warn" if abs(total_new_monthly) >= 2000 else "neutral"  # ≥€20/mo
            sample = ", ".join(s.label for s in new_subs[:3])
            out.append(
                Insight(
                    kind="subscription_velocity",
                    severity=sev,
                    headline=f"+{len(new_subs)} new subscription{'s' if len(new_subs) != 1 else ''} in 90d",
                    message=(
                        f"Recently picked up: {sample}"
                        f"{'…' if len(new_subs) > 3 else ''}. Combined €{abs(total_new_monthly) / 100:,.0f}/mo."
                    ),
                    value=len(new_subs),
                )
            )

    # 9. Weekday vs weekend pattern (last 60 days, expenses only, excluding transfers)
    weekend_window_start = today - timedelta(days=60)
    pattern_rows = (
        db.query(Transaction.occurred_on, Transaction.amount_cents)
        .filter(
            Transaction.user_id == user.id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= weekend_window_start,
        )
        .all()
    )
    if pattern_rows:
        weekday_total = 0
        weekend_total = 0
        weekday_days: set[date] = set()
        weekend_days: set[date] = set()
        for d, amt in pattern_rows:
            if d.weekday() >= 5:  # Sat/Sun
                weekend_total += -amt
                weekend_days.add(d)
            else:
                weekday_total += -amt
                weekday_days.add(d)
        weekday_avg = weekday_total / len(weekday_days) if weekday_days else 0
        weekend_avg = weekend_total / len(weekend_days) if weekend_days else 0
        if weekday_avg > 0 and weekend_avg > 0:
            ratio = weekend_avg / weekday_avg
            if ratio >= 1.4:
                sev = "warn" if ratio >= 2 else "neutral"
                out.append(
                    Insight(
                        kind="weekend_pattern",
                        severity=sev,
                        headline=f"Weekends cost {ratio:.1f}× weekdays",
                        message=(
                            f"Past 60 days: €{weekend_avg / 100:,.0f}/Sat-Sun avg vs "
                            f"€{weekday_avg / 100:,.0f}/Mon-Fri avg. Concentrated leisure spend."
                        ),
                        value=ratio,
                    )
                )
            elif ratio <= 0.7:
                out.append(
                    Insight(
                        kind="weekend_pattern",
                        severity="good",
                        headline=f"Weekdays cost {1 / ratio:.1f}× weekends",
                        message=(
                            f"Past 60 days: €{weekday_avg / 100:,.0f}/weekday vs "
                            f"€{weekend_avg / 100:,.0f}/weekend day. Quiet weekends."
                        ),
                        value=ratio,
                    )
                )

    return out


# ---------------------------------------------------------------------------
# Cash runway + anomaly feed
# ---------------------------------------------------------------------------


_LIQUID_TYPES = {"cash", "checking", "savings", "meal_vouchers"}


class AccountRunway(BaseModel):
    account_id: int
    name: str
    type: str
    logo_url: str | None
    balance_cents: int
    runway_months: float | None


class RunwayOut(BaseModel):
    median_monthly_expense_cents: int
    months_sampled: int
    total_liquid_cents: int
    total_runway_months: float | None
    accounts: list[AccountRunway]
    severity: Literal["good", "warn", "danger", "neutral"]


def _median_monthly_expense_cents(db: Session, user_id: int) -> tuple[int, int]:
    """Median of the last 3 *completed* months' total expenses.

    Returns (median_cents, months_sampled). 0,0 if no history exists.
    """
    today = date.today()
    completed = []
    for back in range(1, 4):
        # walk back month-by-month from current
        ref_month = today.replace(day=1)
        for _ in range(back):
            if ref_month.month == 1:
                ref_month = ref_month.replace(year=ref_month.year - 1, month=12)
            else:
                ref_month = ref_month.replace(month=ref_month.month - 1)
        m_start = ref_month
        m_end = date(m_start.year, m_start.month, monthrange(m_start.year, m_start.month)[1])
        spent = (
            db.query(func.coalesce(func.sum(-Transaction.amount_cents), 0))
            .filter(
                Transaction.user_id == user_id,
                Transaction.transfer_group_id.is_(None),
                Transaction.amount_cents < 0,
                Transaction.occurred_on >= m_start,
                Transaction.occurred_on <= m_end,
            )
            .scalar()
            or 0
        )
        if spent > 0:
            completed.append(int(spent))
    if not completed:
        return 0, 0
    return int(statistics.median(completed)), len(completed)


@router.get("/runway", response_model=RunwayOut)
def runway(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    median, months_sampled = _median_monthly_expense_cents(db, user.id)

    accounts = (
        db.query(Account)
        .filter(
            Account.user_id == user.id,
            Account.archived.is_(False),
            Account.type.in_(_LIQUID_TYPES),
        )
        .order_by(Account.id.asc())
        .all()
    )
    tx_totals = dict(
        db.query(Transaction.account_id, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.user_id == user.id)
        .group_by(Transaction.account_id)
        .all()
    )

    accs: list[AccountRunway] = []
    total_liquid = 0
    for a in accounts:
        bal = a.opening_balance_cents + tx_totals.get(a.id, 0)
        total_liquid += bal
        runway_m: float | None = None
        if median > 0:
            runway_m = round(bal / median, 2)
        accs.append(
            AccountRunway(
                account_id=a.id,
                name=a.name,
                type=a.type,
                logo_url=a.logo_url,
                balance_cents=bal,
                runway_months=runway_m,
            )
        )

    total_runway = round(total_liquid / median, 2) if median > 0 else None
    severity: Literal["good", "warn", "danger", "neutral"]
    if total_runway is None:
        severity = "neutral"
    elif total_runway < 1:
        severity = "danger"
    elif total_runway < 3:
        severity = "warn"
    elif total_runway >= 6:
        severity = "good"
    else:
        severity = "neutral"

    return RunwayOut(
        median_monthly_expense_cents=median,
        months_sampled=months_sampled,
        total_liquid_cents=total_liquid,
        total_runway_months=total_runway,
        accounts=accs,
        severity=severity,
    )


# --- anomalies ---


class Anomaly(BaseModel):
    kind: Literal[
        "category_zscore",
        "new_merchant_large",
        "recurring_jump",
        "refund_candidate",
    ]
    severity: Literal["good", "warn", "danger", "neutral"]
    headline: str
    message: str
    transaction_id: int | None = None
    occurred_on: date | None = None
    value: float | None = None


def _start_of_iso_week(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _detect_category_zscore(db: Session, user_id: int) -> list[Anomaly]:
    today = date.today()
    this_week_start = _start_of_iso_week(today)
    earliest = this_week_start - timedelta(days=7 * 8)  # 8 weeks back

    rows = (
        db.query(
            Category.name,
            Transaction.occurred_on,
            Transaction.amount_cents,
        )
        .join(Transaction, Transaction.category_id == Category.id)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.occurred_on >= earliest,
        )
        .all()
    )

    # bucket per (category, week_start)
    buckets: dict[tuple[str, date], int] = {}
    for name, occurred_on, amt in rows:
        wstart = _start_of_iso_week(occurred_on)
        key = (name, wstart)
        buckets[key] = buckets.get(key, 0) + (-amt)

    # group by category
    by_cat: dict[str, dict[date, int]] = {}
    for (name, wstart), total in buckets.items():
        by_cat.setdefault(name, {})[wstart] = total

    out: list[Anomaly] = []
    for name, weeks in by_cat.items():
        history = [
            spent
            for wstart, spent in weeks.items()
            if wstart < this_week_start and spent > 0
        ]
        this_week_spent = weeks.get(this_week_start, 0)
        if len(history) < 4 or this_week_spent <= 0:
            continue
        try:
            mean = statistics.mean(history)
            stdev = statistics.stdev(history) if len(history) >= 2 else 0
        except statistics.StatisticsError:
            continue
        if stdev <= 0:
            continue
        z = (this_week_spent - mean) / stdev
        if z < 2:
            continue
        sev = "danger" if z >= 3 else "warn"
        out.append(
            Anomaly(
                kind="category_zscore",
                severity=sev,
                headline=f"{name} +{z:.1f}σ above normal",
                message=(
                    f"€{this_week_spent / 100:,.0f} this week vs typical "
                    f"€{mean / 100:,.0f} (σ €{stdev / 100:,.0f})."
                ),
                value=round(z, 2),
            )
        )
    return out


def _detect_new_merchant_large(db: Session, user_id: int) -> list[Anomaly]:
    today = date.today()
    recent_window_start = today - timedelta(days=14)
    history_window_start = today - timedelta(days=180)

    # All non-transfer transactions in the recent window with a merchant + ≥30 EUR
    recent = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.transfer_group_id.is_(None),
            Transaction.amount_cents < 0,
            Transaction.merchant.isnot(None),
            Transaction.occurred_on >= recent_window_start,
            Transaction.amount_cents <= -3000,  # ≥ €30
        )
        .order_by(Transaction.occurred_on.desc())
        .all()
    )
    if not recent:
        return []

    # For each candidate, check whether its merchant occurred at all in the
    # 180-14 = ~166-day prior window.
    out: list[Anomaly] = []
    seen_merchants: set[str] = set()
    for tx in recent:
        if not tx.merchant or tx.merchant in seen_merchants:
            continue
        prior_count = (
            db.query(func.count("*"))
            .filter(
                Transaction.user_id == user_id,
                Transaction.transfer_group_id.is_(None),
                Transaction.merchant == tx.merchant,
                Transaction.occurred_on >= history_window_start,
                Transaction.occurred_on < recent_window_start,
            )
            .scalar()
            or 0
        )
        if prior_count > 0:
            continue
        seen_merchants.add(tx.merchant)
        amt_eur = -tx.amount_cents / 100
        sev = "warn" if amt_eur >= 100 else "neutral"
        out.append(
            Anomaly(
                kind="new_merchant_large",
                severity=sev,
                headline=f"New merchant: {tx.merchant}",
                message=(
                    f"€{amt_eur:,.0f} on {tx.occurred_on.isoformat()} — first time at this merchant."
                ),
                transaction_id=tx.id,
                occurred_on=tx.occurred_on,
                value=amt_eur,
            )
        )
    return out


def _detect_recurring_jump(db: Session, user_id: int) -> list[Anomaly]:
    items = _compute_recurring(db, user_id, lookback_days=180, min_occurrences=3, include_ignored=False)
    out: list[Anomaly] = []
    for it in items:
        if it.classification == "ignore":
            continue
        # Find the most recent transaction in the same group key
        key = it.key
        rows = (
            db.query(Transaction)
            .filter(
                Transaction.user_id == user_id,
                Transaction.transfer_group_id.is_(None),
            )
            .all()
        )
        latest_amt = None
        latest_tx = None
        for tx in rows:
            label_src = (tx.counterparty_name or tx.description or "")
            norm = (label_src.strip().lower())[:40].strip()
            if norm != key:
                continue
            if latest_tx is None or tx.occurred_on > latest_tx.occurred_on:
                latest_tx = tx
                latest_amt = tx.amount_cents
        if latest_amt is None or it.avg_amount_cents == 0:
            continue
        avg = it.avg_amount_cents
        if abs(latest_amt) < 300:  # < €3, ignore noise
            continue
        delta_ratio = (latest_amt - avg) / abs(avg)
        if abs(delta_ratio) <= 0.4:
            continue
        sev = "warn" if delta_ratio < 0 else "good"  # negative = bigger expense; positive = smaller (good)
        # Note: amounts are negative for expenses, so latest < avg means bigger expense
        bigger = latest_amt < avg
        sev = "warn" if bigger else "good"
        sign = "+" if delta_ratio >= 0 else ""
        out.append(
            Anomaly(
                kind="recurring_jump",
                severity=sev,
                headline=f"{it.label} {'increased' if bigger else 'decreased'}",
                message=(
                    f"€{abs(latest_amt) / 100:,.2f} latest vs avg €{abs(avg) / 100:,.2f} "
                    f"({sign}{delta_ratio * 100:.0f}%)."
                ),
                transaction_id=latest_tx.id if latest_tx else None,
                occurred_on=latest_tx.occurred_on if latest_tx else None,
                value=round(delta_ratio * 100, 1),
            )
        )
    return out


def _detect_refund_candidates(db: Session, user_id: int) -> list[Anomaly]:
    """Surface positive (inflow) transactions that look like refunds and aren't
    yet linked to an expense. The user can accept the link from the UI."""
    today = date.today()
    since = today - timedelta(days=60)
    rows = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == user_id,
            Transaction.amount_cents > 0,
            Transaction.transfer_group_id.is_(None),
            Transaction.refund_for_id.is_(None),
            Transaction.occurred_on >= since,
        )
        .all()
    )

    out: list[Anomaly] = []
    for tx in rows:
        # Look for a matching prior expense (same merchant or counterparty, ±60d, 50-150% magnitude)
        target_abs = tx.amount_cents
        lo = int(target_abs * 0.5)
        hi = int(target_abs * 1.5)
        q = (
            db.query(Transaction.id)
            .filter(
                Transaction.user_id == user_id,
                Transaction.id != tx.id,
                Transaction.amount_cents < 0,
                Transaction.transfer_group_id.is_(None),
                Transaction.occurred_on >= tx.occurred_on - timedelta(days=60),
                Transaction.occurred_on <= tx.occurred_on + timedelta(days=60),
                (-Transaction.amount_cents).between(lo, hi),
            )
        )
        if tx.merchant:
            q = q.filter(Transaction.merchant == tx.merchant)
        elif tx.counterparty_name:
            q = q.filter(Transaction.counterparty_name == tx.counterparty_name)
        else:
            continue  # nothing to match against
        match_count = q.count()
        if match_count == 0:
            continue
        out.append(
            Anomaly(
                kind="refund_candidate",
                severity="good",
                headline=(
                    f"Possible refund: {tx.merchant or tx.counterparty_name or 'inflow'} "
                    f"€{tx.amount_cents / 100:,.2f}"
                ),
                message=(
                    f"Looks like a refund of an earlier expense "
                    f"({match_count} matching{'es' if match_count != 1 else ''} within ±60d). "
                    "Link it so it nets out in your category totals."
                ),
                transaction_id=tx.id,
                occurred_on=tx.occurred_on,
                value=tx.amount_cents / 100,
            )
        )
    return out


_SEV_ORDER = {"danger": 0, "warn": 1, "good": 2, "neutral": 3}


@router.get("/anomalies", response_model=list[Anomaly])
def anomalies(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items: list[Anomaly] = []
    items.extend(_detect_category_zscore(db, user.id))
    items.extend(_detect_new_merchant_large(db, user.id))
    items.extend(_detect_recurring_jump(db, user.id))
    items.extend(_detect_refund_candidates(db, user.id))
    items.sort(
        key=lambda a: (
            _SEV_ORDER.get(a.severity, 99),
            -(a.occurred_on.toordinal() if a.occurred_on else 0),
        )
    )
    return items[:12]
