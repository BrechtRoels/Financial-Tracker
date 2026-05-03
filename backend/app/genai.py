from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import httpx

from .config import settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
RETRY_BACKOFF = [1, 3, 8]


def _extract_text(data: dict) -> str:
    if "output" in data:
        for item in data["output"]:
            if item.get("type") == "message":
                for c in item.get("content", []):
                    if c.get("type") == "output_text":
                        return c["text"]
    if "choices" in data:
        return data["choices"][0]["message"]["content"]
    if "response" in data:
        return data["response"]
    return str(data)


async def llm_complete(prompt: str, model: str | None = None) -> str:
    model = model or settings.genai_llm_model
    headers = {"api-key": settings.genai_api_key, "Content-Type": "application/json"}
    params = {"api-version": settings.genai_api_version} if settings.genai_api_version else {}
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{settings.genai_base_url}/v1/responses",
                    headers=headers,
                    params=params,
                    json={"model": model, "input": prompt},
                )
                resp.raise_for_status()
                return _extract_text(resp.json())
        except (
            httpx.TimeoutException,
            httpx.ReadError,
            httpx.WriteError,
            httpx.ConnectError,
            OSError,
        ) as e:
            last_err = e
            if attempt < MAX_RETRIES - 1:
                await asyncio.sleep(RETRY_BACKOFF[attempt])
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500 and attempt < MAX_RETRIES - 1:
                last_err = e
                await asyncio.sleep(RETRY_BACKOFF[attempt])
            else:
                raise
    assert last_err is not None
    raise last_err


_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]")


def _parse_array(text: str) -> list[dict]:
    s = text.strip()
    if s.startswith("```"):
        s = s.strip("`").strip()
        if s.lower().startswith("json"):
            s = s[4:].lstrip()
    m = _JSON_ARRAY_RE.search(s)
    if m:
        s = m.group(0)
    return json.loads(s)


def _build_prompt(rows: list[dict[str, Any]], categories: list[dict[str, str]]) -> str:
    cat_list = "\n".join(f"- {c['name']} ({c['kind']})" for c in categories)
    tx_json = json.dumps(
        [
            {
                "i": r["i"],
                "desc": (r.get("raw_description") or "")[:260],
                "cp": r.get("counterparty") or "",
                "memo": r.get("memo") or "",
                "amt": r["amount"],
            }
            for r in rows
        ],
        ensure_ascii=False,
    )
    return f"""You clean and classify Belgian (KBC) bank transactions for a personal finance tracker.

For each transaction, return:
- "i": the id exactly as given
- "description": a short human-readable description (max 60 chars).
  * If "cp" (counterparty) is present, use that person's/company's name in Title Case. Strip tokens like "P2P MOBILE", "Wero", "OM <time>", card numbers, "INSTANTOVERSCHRIJVING NAAR/VAN", "BANKIER BEGUNSTIGDE", IBANs, BICs, references.
  * For card payments (no counterparty), extract only the merchant from the verbose "desc" (e.g. "BETALING VIA DEBIT MASTERCARD 02-03-2026 OM 22.04 UUR EUROSTARS LISBOA PARQU PT1050-121 LISBOA MET ..." → "Eurostars Lisboa").
  * No dates, no times, no card numbers, no city/country codes if possible.
- "category": the best-matching category NAME from the list below, or null if nothing clearly fits.
  * Positive "amt" → use an income category. Negative → expense.
  * If the transaction looks like a transfer between own accounts (e.g. counterparty name is the user themselves), return null for category.

Categories:
{cat_list}

Transactions (JSON array):
{tx_json}

Output ONLY a JSON array with objects {{"i": int, "description": str, "category": str|null}}. No prose. No markdown. No code fences."""


def _apply_response(
    parsed: list[Any], valid_categories: set[str]
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for item in parsed:
        if not isinstance(item, dict):
            continue
        i = item.get("i")
        if not isinstance(i, int):
            continue
        cat = item.get("category")
        if cat and cat not in valid_categories:
            cat = None
        desc = str(item.get("description") or "").strip()[:200]
        out[i] = {"description": desc or None, "category": cat}
    return out


async def enrich_transactions_stream(
    rows: list[dict[str, Any]], categories: list[dict[str, str]], chunk_size: int = 20
):
    """Async generator yielding progress as rows are enriched.

    Yields dicts: {"done": int, "total": int, "results": dict[int, dict]}
    Sequential chunks so clients see incremental progress. Silently yields
    empty results on LLM failure (logs a warning).
    """
    if not rows or not settings.genai_enabled:
        return

    total = len(rows)
    valid = {c["name"] for c in categories}
    chunks = [rows[i : i + chunk_size] for i in range(0, total, chunk_size)]
    done = 0

    for chunk in chunks:
        prompt = _build_prompt(chunk, categories)
        chunk_result: dict[int, dict[str, Any]] = {}
        try:
            text = await llm_complete(prompt)
            chunk_result = _apply_response(_parse_array(text), valid)
        except Exception as e:
            logger.warning("LLM enrichment failed for %d rows: %s", len(chunk), e)
        done += len(chunk)
        yield {"done": done, "total": total, "results": chunk_result}


async def enrich_transactions(
    rows: list[dict[str, Any]], categories: list[dict[str, str]]
) -> dict[int, dict[str, Any]]:
    """Non-streaming convenience wrapper that collects all chunk results."""
    merged: dict[int, dict[str, Any]] = {}
    async for evt in enrich_transactions_stream(rows, categories):
        merged.update(evt["results"])
    return merged


_CANONICAL_PROMPT = """You normalise merchant names extracted from bank transactions.

Group entries that refer to the SAME brand or business and return a JSON object
mapping each input string to its canonical brand name. Rules:
- Strip store / branch numbers ("Albert Heijn 3024" → "Albert Heijn").
- Unify abbreviations and casing variants ("AH" → "Albert Heijn", "Pwc" → "PwC").
- Strip city/postal-code tails leaked into the name.
- Keep the canonical name in Title Case unless the brand is conventionally
  styled otherwise (e.g. "PwC", "iDEAL", "ING").
- If a name is already canonical, map it to itself.
- Do NOT invent brands. If unsure, return the input unchanged.

Inputs: {names_json}

Output ONLY a JSON object {{"input": "Canonical", ...}}. No prose.
"""


_RECEIPT_PROMPT = """You read a photo of a receipt or invoice and extract structured fields.

Return ONE JSON object — no prose, no markdown, no code fences — with:
- "total_amount": float — the final total paid, in the receipt's currency. Always a positive number.
- "currency": 3-letter ISO code ("EUR", "USD", "GBP"). Best guess from the receipt; default "EUR".
- "date": ISO YYYY-MM-DD if visible, else null.
- "merchant": short brand / shop name (e.g. "Albert Heijn", not the legal entity or street address). null if unreadable.
- "category": one of the category names from the list below, or null if nothing clearly fits.
- "description": short human-readable summary of the purchase (e.g. "Weekly groceries", "Lunch with Tom"). null if not enough info.
- "confidence": 0.0–1.0, how confident you are in `total_amount`.

If the image is unreadable or clearly not a receipt, return:
{"error": "not_a_receipt"}

Available categories:
{categories}

Output strictly the JSON object. Nothing else.
"""


async def scan_receipt_image(
    image_b64_data_url: str,
    categories: list[dict[str, str]],
) -> dict[str, Any]:
    """Send a base64 image data URL to the vision model and parse the JSON.

    `categories` is a list of {"name": ..., "kind": "expense"|"income"} dicts —
    the model is told to pick one or return null. Returns {} on failure so
    callers can fall back to an empty form.
    """
    if not settings.genai_enabled:
        return {}
    cat_lines = "\n".join(f"- {c['name']}" for c in categories if c.get("kind") == "expense")
    prompt = _RECEIPT_PROMPT.replace("{categories}", cat_lines or "(none)")

    headers = {"api-key": settings.genai_api_key, "Content-Type": "application/json"}
    params = {"api-version": settings.genai_api_version} if settings.genai_api_version else {}
    payload = {
        "model": settings.genai_vision_model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_b64_data_url},
                ],
            }
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{settings.genai_base_url}/v1/responses",
                headers=headers,
                params=params,
                json=payload,
            )
            resp.raise_for_status()
            text = _extract_text(resp.json())
    except Exception as e:
        logger.warning("Receipt scan failed: %s", e)
        return {}

    try:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`").strip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].lstrip()
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            cleaned = m.group(0)
        parsed = json.loads(cleaned)
    except Exception as e:
        logger.warning("Could not parse receipt JSON: %s", e)
        return {}

    if not isinstance(parsed, dict):
        return {}
    return parsed


async def canonicalize_merchants(names: list[str]) -> dict[str, str]:
    """Single LLM call. Maps each input string → canonical brand. Returns
    {} if AI is disabled or the LLM returns garbage."""
    if not names or not settings.genai_enabled:
        return {}
    unique = sorted({n for n in names if n})
    if not unique:
        return {}
    prompt = _CANONICAL_PROMPT.format(names_json=json.dumps(unique, ensure_ascii=False))
    try:
        text = await llm_complete(prompt)
    except Exception as e:
        logger.warning("Merchant canonicalization failed: %s", e)
        return {}
    try:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`").strip()
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].lstrip()
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            cleaned = m.group(0)
        parsed = json.loads(cleaned)
    except Exception as e:
        logger.warning("Could not parse canonicalize_merchants JSON: %s", e)
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in parsed.items():
        if isinstance(k, str) and isinstance(v, str) and v.strip():
            out[k] = v.strip()[:120]
    return out
