from __future__ import annotations

import hashlib
import io
import json
import re
import uuid
from datetime import date

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings
from ..deps import get_current_user, get_db, require_ai_user
import base64

from ..genai import canonicalize_merchants, enrich_transactions_stream, scan_receipt_image
from ..models import Account, Category, CsvImport, Transaction, User
from ..schemas import TransactionCreate, TransactionOut, TransactionUpdate, TransferCreate
from .accounts import normalize_iban

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _own_account(db: Session, user_id: int, account_id: int) -> Account:
    acc = db.query(Account).filter(Account.id == account_id, Account.user_id == user_id).first()
    if not acc:
        raise HTTPException(status_code=400, detail=f"Invalid account {account_id}")
    return acc


@router.get("", response_model=list[TransactionOut])
def list_transactions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    account_id: int | None = None,
    category_id: int | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    query = db.query(Transaction).filter(Transaction.user_id == user.id)
    if date_from:
        query = query.filter(Transaction.occurred_on >= date_from)
    if date_to:
        query = query.filter(Transaction.occurred_on <= date_to)
    if account_id:
        query = query.filter(Transaction.account_id == account_id)
    if category_id:
        query = query.filter(Transaction.category_id == category_id)
    if q:
        query = query.filter(Transaction.description.ilike(f"%{q}%"))
    return (
        query.order_by(Transaction.occurred_on.desc(), Transaction.id.desc())
        .offset(offset)
        .limit(min(limit, 500))
        .all()
    )


@router.post("", response_model=TransactionOut)
def create_transaction(
    data: TransactionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    _own_account(db, user.id, data.account_id)
    tx = Transaction(user_id=user.id, **data.model_dump())
    db.add(tx)
    db.commit()
    db.refresh(tx)
    return tx


@router.patch("/{tx_id}", response_model=TransactionOut)
def update_transaction(
    tx_id: int,
    data: TransactionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.user_id == user.id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Not found")
    updates = data.model_dump(exclude_unset=True)
    if "account_id" in updates:
        _own_account(db, user.id, updates["account_id"])

    # Transfers come in pairs: keep the partner row in sync for amount and date
    # so the two legs never drift. Account / category / merchant edits stay
    # local to the row the user clicked on.
    partner = None
    if tx.transfer_group_id:
        partner = (
            db.query(Transaction)
            .filter(
                Transaction.user_id == user.id,
                Transaction.transfer_group_id == tx.transfer_group_id,
                Transaction.id != tx.id,
            )
            .first()
        )

    for k, v in updates.items():
        setattr(tx, k, v)

    if partner:
        if "amount_cents" in updates:
            # Sign-flip: partner row mirrors this leg.
            partner.amount_cents = -int(updates["amount_cents"])
        if "occurred_on" in updates:
            partner.occurred_on = updates["occurred_on"]
        if "description" in updates:
            partner.description = updates["description"]

    db.commit()
    db.refresh(tx)
    return tx


@router.delete("/{tx_id}")
def delete_transaction(
    tx_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.user_id == user.id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Not found")
    if tx.transfer_group_id:
        db.query(Transaction).filter(
            Transaction.user_id == user.id, Transaction.transfer_group_id == tx.transfer_group_id
        ).delete()
    else:
        db.delete(tx)
    db.commit()
    return {"ok": True}


@router.post("/transfer", response_model=list[TransactionOut])
def create_transfer(
    data: TransferCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if data.from_account_id == data.to_account_id:
        raise HTTPException(status_code=400, detail="Accounts must differ")
    _own_account(db, user.id, data.from_account_id)
    _own_account(db, user.id, data.to_account_id)
    gid = str(uuid.uuid4())
    out_tx = Transaction(
        user_id=user.id,
        account_id=data.from_account_id,
        amount_cents=-data.amount_cents,
        occurred_on=data.occurred_on,
        description=data.description or "Transfer",
        transfer_group_id=gid,
    )
    in_tx = Transaction(
        user_id=user.id,
        account_id=data.to_account_id,
        amount_cents=data.amount_cents,
        occurred_on=data.occurred_on,
        description=data.description or "Transfer",
        transfer_group_id=gid,
    )
    db.add_all([out_tx, in_tx])
    db.commit()
    db.refresh(out_tx)
    db.refresh(in_tx)
    return [out_tx, in_tx]


def _parse_csv_bytes(content: bytes) -> pd.DataFrame:
    """Try KBC (semicolon + comma decimal) first, then generic English CSV.

    The KBC export uses CR line endings and emits one extra trailing field
    per data row compared to the header, so we force engine="python" and
    explicitly pad header names to match the data width.
    """

    def _read(sep: str, decimal: str, encoding: str) -> pd.DataFrame:
        text = content.decode(encoding, errors="replace")
        text = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
        lines = text.split("\n")
        header = lines[0].split(sep)
        data_cols = max((len(row.split(sep)) for row in lines[1:]), default=len(header))
        extra = max(0, data_cols - len(header))
        names = header + [f"_extra_{i}" for i in range(extra)]
        return pd.read_csv(
            io.StringIO(text),
            sep=sep,
            decimal=decimal,
            engine="python",
            header=0,
            names=names,
            skipinitialspace=True,
        )

    attempts = [
        (";", ",", "utf-8"),
        (";", ",", "latin-1"),
        (",", ".", "utf-8"),
        (",", ".", "latin-1"),
    ]
    last_err: Exception | None = None
    for sep, decimal, encoding in attempts:
        try:
            df = _read(sep, decimal, encoding)
            if len(df.columns) > 1 and len(df) > 0:
                return df
        except Exception as e:
            last_err = e
    raise HTTPException(status_code=400, detail=f"Could not parse CSV: {last_err}")


_MERCHANT_RE = re.compile(r"\bUUR\s+(.+?)\s+MET\b", re.IGNORECASE)

# Matches KBC-style location markers: "BE3500 HASSELT", "PT0016490031 LISBOA",
# "DE56651 NIEDERZISSEN", "AT6580 SANKT ANTON A". Two-letter country code,
# postcode (may contain hyphen), whitespace, then the city (caps + spaces).
_LOCATION_RE = re.compile(
    r"\b([A-Z]{2})\d[\dA-Z-]{3,}\s+([A-Z][A-Z .'-]{1,40}?)(?=(?:\s+MET\b|\s+KAARTHOUDER\b|\s+INFO VAN\b|\s{2,}|$))"
)


def _extract_location(text: str) -> tuple[str | None, str | None]:
    if not text:
        return None, None
    m = _LOCATION_RE.search(text)
    if not m:
        return None, None
    country = m.group(1)
    city = m.group(2).strip()
    # Title-case city while preserving short-form connectors
    city = " ".join(w.capitalize() for w in city.split())
    return city or None, country


# Strips the trailing "<CC><postcode> <CITY>" tail that lives at the end of
# KBC merchant strings, e.g. "ALBERT HEIJN 3024 BE9000 GENT" → "ALBERT HEIJN 3024".
_MERCHANT_TAIL_RE = re.compile(r"\s+[A-Z]{2}\d[\dA-Z-]{3,}\s+[A-Z][A-Z .'-]+$")

# Trailing branch / store codes: any 2-8 char alphanumeric token that contains
# at least one digit. Matches both pure-digit codes ("3024") and mixed codes
# ("656VX", "PGQK2", "NGBR1", "1J7VZ"). The lookahead is what filters out
# real words like "Parqu" or "Bv" (no digit → no match).
_BRANCH_TAIL_RE = re.compile(r"\s+(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{2,8}$")

# Common abbreviations → canonical brand name. Keys are lowercased exact matches.
_BRAND_ALIASES: dict[str, str] = {
    "ah": "Albert Heijn",
    "ah to go": "Albert Heijn",
    "pwc": "PwC",
    "ksv jabbeke": "KSV Jabbeke",
}


def _strip_branch_codes(name: str) -> str:
    """Strip trailing branch/store codes repeatedly (e.g. 'Albert Heijn 3024' → 'Albert Heijn').

    Only strips while the remainder still has at least one alphabetic word so
    we never end up with an empty merchant for names that ARE just codes.
    """
    while True:
        m = _BRANCH_TAIL_RE.search(name)
        if not m:
            break
        candidate = name[: m.start()].strip()
        if not candidate or not re.search(r"[A-Za-z]{2,}", candidate):
            break
        name = candidate
    return name


def _normalize_merchant(name: str) -> str | None:
    """Strip codes, apply known aliases, and Title-case."""
    if not name:
        return None
    name = name.strip()
    name = _strip_branch_codes(name)
    lowered = name.lower()
    if lowered in _BRAND_ALIASES:
        return _BRAND_ALIASES[lowered]
    return " ".join(w.capitalize() for w in name.split())[:120] or None


def _extract_merchant(omschrijving: str, counterparty_name: str | None) -> str | None:
    """Return a clean, canonical merchant/payee name in Title Case.

    KBC card payments encode the merchant in the description between
    "UUR " and " MET " — we trim the location tail off that. For
    transfers / overschrijvingen the counterparty name is the merchant.
    """
    cp = (counterparty_name or "").strip()
    if cp and cp.lower() != "nan":
        return _normalize_merchant(cp)

    if not omschrijving:
        return None
    m = _MERCHANT_RE.search(omschrijving)
    if not m:
        return None
    raw = m.group(1).strip()
    cleaned = _MERCHANT_TAIL_RE.sub("", raw).strip()
    if not cleaned:
        cleaned = raw
    return _normalize_merchant(cleaned)


def _kbc_description(row: pd.Series) -> str:
    """Build a compact, human-friendly description from KBC fields."""

    def clean(v) -> str:
        s = str(v or "").strip()
        return "" if s.lower() in {"", "nan"} else s

    parts: list[str] = []
    counterparty = clean(row.get("Naam tegenpartij"))
    if counterparty:
        parts.append(counterparty)
    for key in ("vrije mededeling", "gestructureerde mededeling"):
        val = clean(row.get(key))
        if val:
            parts.append(val)

    if not parts:
        omschrijving = clean(row.get("Omschrijving"))
        if omschrijving:
            # KBC card payments follow "BETALING VIA <card> <date> OM <time> UUR <MERCHANT> MET <cardinfo>"
            match = _MERCHANT_RE.search(omschrijving)
            if match:
                parts.append(match.group(1).strip()[:120])
            else:
                parts.append(omschrijving.split(" MET ")[0][:120])

    return " · ".join(parts)[:255]


def _parse_rows_from_df(
    df: pd.DataFrame,
    fmt: str,
) -> tuple[list[dict], int]:
    """Parse every CSV row into a normalised dict. No cross-row dedup — the
    caller handles file-level idempotency via CsvImport."""
    parsed_rows: list[dict] = []
    skipped = 0
    for idx, row in df.iterrows():
        try:
            if fmt == "kbc":
                occurred = pd.to_datetime(row["Datum"], dayfirst=True, errors="raise").date()
                amount = float(row["Bedrag"])
                raw_desc = str(row.get("Omschrijving") or "").strip()
                counterparty = str(row.get("Naam tegenpartij") or "").strip()
                if counterparty.lower() == "nan":
                    counterparty = ""
                cp_iban = normalize_iban(str(row.get("Rekening tegenpartij") or "").strip())
                if cp_iban and cp_iban.lower() == "nan":
                    cp_iban = None
                memo_parts = [
                    str(row.get(k) or "").strip()
                    for k in ("vrije mededeling", "gestructureerde mededeling")
                ]
                memo = " ".join(m for m in memo_parts if m and m.lower() != "nan")
                fallback_desc = _kbc_description(row)
                csv_category = ""
            else:
                occurred = pd.to_datetime(row["date"]).date()
                amount = float(row["amount"])
                raw_desc = str(row.get("description", "") or "")
                counterparty = ""
                cp_iban = None
                memo = ""
                fallback_desc = raw_desc[:255]
                csv_category = (
                    str(row.get("category", "") or "").strip() if "category" in df.columns else ""
                )
            if pd.isna(amount):
                skipped += 1
                continue
        except Exception:
            skipped += 1
            continue

        amount_cents = int(round(amount * 100))
        city, country = _extract_location(raw_desc)
        merchant = _extract_merchant(raw_desc, counterparty)
        # Keep import_hash per-row for traceability only (no longer used for dedup).
        sig_source = f"{idx}|{occurred.isoformat()}|{amount_cents}|{raw_desc[:200]}|{counterparty}"
        sig = hashlib.sha1(sig_source.encode("utf-8")).hexdigest()[:40]

        parsed_rows.append(
            {
                "occurred_on": occurred,
                "amount_cents": amount_cents,
                "amount": amount,
                "raw_description": raw_desc,
                "counterparty": counterparty,
                "counterparty_iban": cp_iban,
                "memo": memo,
                "fallback_desc": fallback_desc,
                "csv_category": csv_category,
                "import_hash": sig,
                "location_city": city,
                "location_country": country,
                "merchant": merchant,
            }
        )
    return parsed_rows, skipped


class RefundCandidateOut(BaseModel):
    id: int
    occurred_on: date
    amount_cents: int
    merchant: str | None
    description: str
    account_id: int
    category_id: int | None
    days_apart: int


class LinkRefundIn(BaseModel):
    expense_id: int


@router.get("/{tx_id}/refund-candidates", response_model=list[RefundCandidateOut])
def refund_candidates(
    tx_id: int,
    q: str | None = Query(None, description="Optional text filter on merchant / description."),
    all_expenses: bool = Query(
        False,
        description="When true, drop the date / amount-range heuristics so any expense can match — useful for friend paybacks where the original purchase was earlier.",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Find candidate expense transactions a positive (refund) row could offset.

    Default heuristic: amount within 50–150% of the refund, date within ±60 days.
    Same-merchant / same-counterparty matches rank higher but are no longer a
    hard filter — that way a friend repaying you (different "merchant" than the
    original purchase) can still find candidates. Pass `all_expenses=true` to
    drop the date and amount restrictions entirely; pass `q=...` to text-filter
    by merchant / description.
    """
    refund = (
        db.query(Transaction)
        .filter(Transaction.id == tx_id, Transaction.user_id == user.id)
        .first()
    )
    if not refund:
        raise HTTPException(status_code=404, detail="Not found")
    if refund.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Only positive transactions can be linked as refunds")

    target_abs = refund.amount_cents

    query = db.query(Transaction).filter(
        Transaction.user_id == user.id,
        Transaction.id != tx_id,
        Transaction.amount_cents < 0,
        Transaction.transfer_group_id.is_(None),
    )

    if not all_expenses:
        lo = int(target_abs * 0.5)
        hi = int(target_abs * 1.5)
        earliest = refund.occurred_on - timedelta(days=60)
        latest = refund.occurred_on + timedelta(days=60)
        query = query.filter(
            Transaction.occurred_on >= earliest,
            Transaction.occurred_on <= latest,
            (-Transaction.amount_cents).between(lo, hi),
        )

    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            (Transaction.merchant.ilike(like)) | (Transaction.description.ilike(like))
        )

    rows = query.order_by(Transaction.occurred_on.desc()).limit(50).all()

    out = [
        RefundCandidateOut(
            id=r.id,
            occurred_on=r.occurred_on,
            amount_cents=r.amount_cents,
            merchant=r.merchant,
            description=r.description or "",
            account_id=r.account_id,
            category_id=r.category_id,
            days_apart=abs((r.occurred_on - refund.occurred_on).days),
        )
        for r in rows
    ]

    # Rank: same-merchant / same-counterparty first, then closer in time, then closer in amount.
    def _rank(c: RefundCandidateOut) -> tuple:
        same_merchant = bool(refund.merchant and c.merchant and refund.merchant == c.merchant)
        return (
            0 if same_merchant else 1,
            c.days_apart,
            abs(abs(c.amount_cents) - target_abs),
        )

    out.sort(key=_rank)
    return out[:25]


@router.post("/{tx_id}/link-refund", response_model=TransactionOut)
def link_refund(
    tx_id: int,
    body: LinkRefundIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark `tx_id` as a refund of `expense_id`. Inherits the expense's category
    so net category totals reflect the refund (positive amount in the same
    category nets out the original expense)."""
    refund = (
        db.query(Transaction)
        .filter(Transaction.id == tx_id, Transaction.user_id == user.id)
        .first()
    )
    if not refund:
        raise HTTPException(status_code=404, detail="Refund tx not found")
    if refund.amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Only positive amounts can be linked as refunds")

    expense = (
        db.query(Transaction)
        .filter(Transaction.id == body.expense_id, Transaction.user_id == user.id)
        .first()
    )
    if not expense:
        raise HTTPException(status_code=404, detail="Expense tx not found")
    if expense.amount_cents >= 0:
        raise HTTPException(status_code=400, detail="Linked expense must be negative")

    refund.refund_for_id = expense.id
    if expense.category_id:
        refund.category_id = expense.category_id
    db.commit()
    db.refresh(refund)
    return refund


@router.post("/{tx_id}/unlink-refund", response_model=TransactionOut)
def unlink_refund(
    tx_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    refund = (
        db.query(Transaction)
        .filter(Transaction.id == tx_id, Transaction.user_id == user.id)
        .first()
    )
    if not refund:
        raise HTTPException(status_code=404, detail="Not found")
    refund.refund_for_id = None
    db.commit()
    db.refresh(refund)
    return refund


@router.post("/forget-imports")
def forget_imports(
    account_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear csv_imports records so the same file can be re-uploaded.

    If `account_id` is given, only clears that account's history; otherwise
    clears every CSV import record for the current user.
    """
    q = db.query(CsvImport).filter(CsvImport.user_id == user.id)
    if account_id is not None:
        q = q.filter(CsvImport.account_id == account_id)
    n = q.delete()
    db.commit()
    return {"forgotten": n}


class ScanReceiptOut(BaseModel):
    total_amount_cents: int | None = None
    currency: str | None = None
    occurred_on: date | None = None
    merchant: str | None = None
    description: str | None = None
    category_id: int | None = None
    confidence: float | None = None
    error: str | None = None


_ACCEPTED_IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


@router.post("/scan-receipt", response_model=ScanReceiptOut)
async def scan_receipt(
    file: UploadFile = File(...),
    user: User = Depends(require_ai_user),
    db: Session = Depends(get_db),
) -> ScanReceiptOut:
    """Take a receipt photo, return structured fields to prefill the add-tx form.

    Calls the cheapest vision model on the configured GenAI proxy. Falls back
    to all-null output (with `error`) on any AI failure — the UI just keeps the
    form empty in that case.
    """
    if not settings.genai_enabled:
        raise HTTPException(status_code=400, detail="AI is unavailable — set GENAI_API_KEY.")

    mime = (file.content_type or "").lower()
    if mime not in _ACCEPTED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {file.content_type or 'unknown'}",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image too large (max 8 MB).")

    data_url = f"data:{mime};base64,{base64.b64encode(raw).decode()}"

    cats = (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .all()
    )
    parsed = await scan_receipt_image(
        data_url,
        [{"name": c.name, "kind": c.kind} for c in cats],
    )

    if not parsed:
        return ScanReceiptOut(error="ai_failed")
    if "error" in parsed:
        return ScanReceiptOut(error=str(parsed["error"]))

    total = parsed.get("total_amount")
    cents: int | None = None
    if isinstance(total, (int, float)) and total > 0:
        cents = int(round(float(total) * 100))

    raw_date = parsed.get("date")
    occurred: date | None = None
    if isinstance(raw_date, str):
        try:
            occurred = date.fromisoformat(raw_date[:10])
        except ValueError:
            occurred = None

    cat_name = parsed.get("category")
    cat_id: int | None = None
    if isinstance(cat_name, str):
        match = next(
            (c for c in cats if c.name.lower() == cat_name.strip().lower()),
            None,
        )
        if match:
            cat_id = match.id

    merchant = parsed.get("merchant")
    if not isinstance(merchant, str) or not merchant.strip():
        merchant = None
    description = parsed.get("description")
    if not isinstance(description, str) or not description.strip():
        description = None
    currency = parsed.get("currency")
    if not isinstance(currency, str):
        currency = None
    confidence = parsed.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = None

    return ScanReceiptOut(
        total_amount_cents=cents,
        currency=currency,
        occurred_on=occurred,
        merchant=merchant.strip()[:120] if merchant else None,
        description=description.strip()[:240] if description else None,
        category_id=cat_id,
        confidence=float(confidence) if confidence is not None else None,
    )


@router.post("/import-csv")
async def import_csv(
    account_id: int = Form(...),
    use_ai: bool = Form(False),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own_account(db, user.id, account_id)
    content = await file.read()

    async def stream():
        def evt(stage: str, **data) -> str:
            return json.dumps({"stage": stage, **data}, default=str) + "\n"

        yield evt("parsing")

        try:
            df = _parse_csv_bytes(content)
        except HTTPException as e:
            yield evt("error", detail=str(e.detail))
            return

        cols = set(df.columns)
        if {"Datum", "Bedrag"}.issubset(cols):
            fmt = "kbc"
        elif {"date", "amount"}.issubset(cols):
            fmt = "generic"
        else:
            yield evt("error", detail=f"Unsupported CSV columns: {sorted(cols)}")
            return

        user_categories = db.query(Category).filter(Category.user_id == user.id).all()
        cat_by_lower = {c.name.lower(): c for c in user_categories}

        own_accounts = db.query(Account).filter(Account.user_id == user.id).all()
        iban_to_account_id: dict[str, int] = {
            a.iban: a.id for a in own_accounts if a.iban
        }
        own_account_iban = next((a.iban for a in own_accounts if a.id == account_id), None)

        # File-level duplicate check: exact same file content for the same
        # account was already imported? Refuse the re-import outright.
        content_hash = hashlib.sha256(content).hexdigest()
        prior_import = (
            db.query(CsvImport)
            .filter(
                CsvImport.user_id == user.id,
                CsvImport.account_id == account_id,
                CsvImport.content_hash == content_hash,
            )
            .first()
        )
        if prior_import:
            yield evt(
                "error",
                detail=(
                    f"This CSV file was already imported for this account on "
                    f"{prior_import.imported_at.date()} ({prior_import.row_count} rows). "
                    "Nothing to do."
                ),
            )
            return

        parsed_rows, skipped = _parse_rows_from_df(df, fmt)

        # Pre-compute which rows are transfers between own accounts so we can
        # (a) give them a deterministic description and (b) exclude them from
        # AI enrichment (saves tokens + avoids the AI leaking unrelated names
        # onto self-transfer rows).
        own_account_by_id = {a.id: a for a in own_accounts}
        importing_account = own_account_by_id.get(account_id)
        importing_account_name = importing_account.name if importing_account else "this account"

        def _transfer_description(r: dict) -> str | None:
            """Return a deterministic description iff this row is an own-account
            transfer, else None."""
            cp = r.get("counterparty_iban")
            if not cp:
                return None
            # Mirror row we created when the OTHER side was imported first.
            if own_account_iban and cp == own_account_iban:
                return f"Transfer · {importing_account_name}"
            # Row moving money to/from another owned account.
            other_id = iban_to_account_id.get(cp)
            if not other_id or other_id == account_id:
                return None
            other_name = own_account_by_id[other_id].name
            if r["amount_cents"] < 0:
                return f"Transfer → {other_name}"
            return f"Transfer ← {other_name}"

        transfer_flags = [_transfer_description(r) for r in parsed_rows]

        yield evt(
            "parsed",
            total=len(parsed_rows),
            duplicates=0,
            skipped=skipped,
            format=fmt,
        )

        enrichment: dict[int, dict] = {}
        if use_ai and parsed_rows:
            if not settings.genai_enabled:
                yield evt("ai_unavailable")
            elif not getattr(user, "ai_enabled", True):
                yield evt("ai_unavailable")
            else:
                categories_payload = [
                    {"name": c.name, "kind": c.kind} for c in user_categories
                ]
                # Only send non-transfer rows to the AI.
                prompt_rows = [
                    {
                        "i": i,
                        "raw_description": r["raw_description"],
                        "counterparty": r["counterparty"],
                        "memo": r["memo"],
                        "amount": r["amount"],
                    }
                    for i, r in enumerate(parsed_rows)
                    if transfer_flags[i] is None
                ]
                yield evt("ai_start", total=len(prompt_rows))
                if prompt_rows:
                    async for chunk in enrich_transactions_stream(prompt_rows, categories_payload):
                        enrichment.update(chunk["results"])
                        yield evt("ai_progress", done=chunk["done"], total=chunk["total"])
                else:
                    yield evt("ai_progress", done=0, total=0)

                # AI batch canonicalization of merchant names. Catches things
                # the deterministic regex misses ("AH 3120" / "Albert Heijn 3024"
                # both → "Albert Heijn"; chain abbreviations; casing variants).
                unique_merchants = sorted({
                    r["merchant"] for r in parsed_rows if r.get("merchant")
                })
                if unique_merchants:
                    yield evt("merchant_canonical_start", count=len(unique_merchants))
                    mapping = await canonicalize_merchants(unique_merchants)
                    if mapping:
                        normalised = 0
                        for r in parsed_rows:
                            m = r.get("merchant")
                            if m and m in mapping and mapping[m] != m:
                                r["merchant"] = mapping[m]
                                normalised += 1
                        yield evt(
                            "merchant_canonical_done",
                            normalised=normalised,
                            unique_in=len(unique_merchants),
                            unique_out=len(set(mapping.values())),
                        )
                    else:
                        yield evt("merchant_canonical_done", normalised=0)

        yield evt("saving", total=len(parsed_rows))
        count = 0
        transfers_detected = 0
        transfers_matched = 0
        for i, r in enumerate(parsed_rows):
            enr = enrichment.get(i, {})
            transfer_desc = transfer_flags[i]
            if transfer_desc is not None:
                # Always use our deterministic label for self-transfers.
                description = transfer_desc[:255]
            else:
                description = (enr.get("description") or r["fallback_desc"])[:255]
            cp_iban = r.get("counterparty_iban")

            # Is this row a transfer between own accounts?
            is_own_transfer = bool(
                cp_iban and cp_iban in iban_to_account_id and iban_to_account_id[cp_iban] != account_id
            )

            # Case A: this row IS a transfer, and a synthetic mirror was already
            # created on this account by a prior import of the OTHER side. Promote
            # it instead of creating a duplicate transfer pair. This is what
            # makes importing both sides (Checking CSV + Savings CSV) work.
            if is_own_transfer:
                existing_mirror = (
                    db.query(Transaction)
                    .filter(
                        Transaction.user_id == user.id,
                        Transaction.account_id == account_id,
                        Transaction.occurred_on == r["occurred_on"],
                        Transaction.amount_cents == r["amount_cents"],
                        Transaction.transfer_group_id.isnot(None),
                        Transaction.import_hash.like("paired-%"),
                    )
                    .first()
                )
                if existing_mirror:
                    existing_mirror.import_hash = r["import_hash"]
                    existing_mirror.description = description
                    existing_mirror.counterparty_iban = cp_iban
                    existing_mirror.counterparty_name = r.get("counterparty") or None
                    existing_mirror.merchant = r.get("merchant")
                    existing_mirror.location_city = r.get("location_city")
                    existing_mirror.location_country = r.get("location_country")
                    transfers_matched += 1
                    count += 1
                    continue

            # Case B: not a transfer or no existing mirror — create the row.
            transfer_group_id = None
            category_id: int | None = None
            if is_own_transfer:
                transfer_group_id = f"csv-{r['import_hash']}"
                transfers_detected += 1
            else:
                ai_cat = enr.get("category")
                if ai_cat:
                    cat = cat_by_lower.get(ai_cat.lower())
                    if cat:
                        category_id = cat.id
                if category_id is None and r["csv_category"]:
                    cat = cat_by_lower.get(r["csv_category"].lower())
                    if cat:
                        category_id = cat.id

            db.add(
                Transaction(
                    user_id=user.id,
                    account_id=account_id,
                    category_id=category_id,
                    amount_cents=r["amount_cents"],
                    occurred_on=r["occurred_on"],
                    description=description,
                    transfer_group_id=transfer_group_id,
                    counterparty_iban=cp_iban,
                    counterparty_name=r.get("counterparty") or None,
                    merchant=r.get("merchant"),
                    location_city=r.get("location_city"),
                    location_country=r.get("location_country"),
                    import_hash=r["import_hash"],
                )
            )
            count += 1

            if is_own_transfer:
                other_account_id = iban_to_account_id[cp_iban]
                paired_hash = f"paired-{transfer_group_id}"
                # Don't create a duplicate paired row if we already have one
                # (e.g. from a prior import run on the same account).
                exists = (
                    db.query(Transaction.id)
                    .filter(
                        Transaction.user_id == user.id,
                        Transaction.import_hash == paired_hash,
                    )
                    .first()
                )
                if not exists:
                    # Mirror description: if this row says "Transfer → Other",
                    # the mirror on the Other account should say
                    # "Transfer ← Importing". Easier: rebuild from the sides.
                    paired_amount = -r["amount_cents"]
                    if paired_amount < 0:
                        paired_desc = f"Transfer → {importing_account_name}"
                    else:
                        paired_desc = f"Transfer ← {importing_account_name}"
                    db.add(
                        Transaction(
                            user_id=user.id,
                            account_id=other_account_id,
                            category_id=None,
                            amount_cents=paired_amount,
                            occurred_on=r["occurred_on"],
                            description=paired_desc,
                            transfer_group_id=transfer_group_id,
                            counterparty_iban=own_account_iban,
                            counterparty_name=r.get("counterparty") or None,
                            import_hash=paired_hash,
                        )
                    )
        db.add(
            CsvImport(
                user_id=user.id,
                account_id=account_id,
                content_hash=content_hash,
                filename=(file.filename or None),
                row_count=count,
            )
        )
        db.commit()

        yield evt(
            "done",
            imported=count,
            duplicates=0,
            skipped=skipped,
            transfers_detected=transfers_detected,
            transfers_matched=transfers_matched,
            format=fmt,
            ai_enriched=bool(enrichment),
            ai_requested=use_ai,
            ai_available=settings.genai_enabled,
        )

    return StreamingResponse(stream(), media_type="application/x-ndjson")
