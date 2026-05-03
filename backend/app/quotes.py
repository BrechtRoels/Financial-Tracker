"""Yahoo Finance quote fetcher with a small in-memory TTL cache.

Uses the yfinance library because Yahoo aggressively rate-limits direct
calls without their cookie/crumb handshake. Quotes are cached for 5 minutes
to keep the dashboard snappy and respect Yahoo's limits.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import yfinance as yf

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 5 * 60
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = asyncio.Lock()


def _quote_blocking(sym: str) -> dict[str, Any] | None:
    """Synchronous Yahoo lookup. Runs in a thread via asyncio.to_thread."""
    try:
        ticker = yf.Ticker(sym)
        fi = ticker.fast_info
        price = fi.last_price
    except Exception as e:
        logger.info("yfinance lookup %s failed: %s", sym, e)
        return None
    if price is None:
        return None
    try:
        currency = fi.currency or "USD"
    except Exception:
        currency = "USD"
    try:
        exchange = fi.exchange or ""
    except Exception:
        exchange = ""
    long_name = sym
    try:
        info = ticker.info or {}
        long_name = info.get("longName") or info.get("shortName") or sym
    except Exception:
        pass
    return {
        "symbol": sym,
        "price": float(price),
        "currency": currency,
        "exchange": exchange,
        "long_name": long_name,
        "fetched_at": time.time(),
    }


async def fetch_quote(symbol: str) -> dict[str, Any] | None:
    sym = (symbol or "").strip().upper()
    if not sym:
        return None

    async with _cache_lock:
        cached = _cache.get(sym)
        if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]

    result = await asyncio.to_thread(_quote_blocking, sym)
    if result is None:
        return None

    async with _cache_lock:
        _cache[sym] = (time.time(), result)
    return result


def _fx_blocking(currency: str) -> float | None:
    """Yahoo FX ticker convention: '<CCY>EUR=X' returns 1 unit of CCY → EUR."""
    sym = f"{currency.upper()}EUR=X"
    try:
        ticker = yf.Ticker(sym)
        rate = ticker.fast_info.last_price
    except Exception as e:
        logger.info("yfinance FX %s failed: %s", sym, e)
        return None
    if rate is None or rate <= 0:
        return None
    return float(rate)


async def fetch_fx_to_eur(currency: str) -> float | None:
    """Return the multiplier to convert 1 unit of `currency` into EUR.

    EUR returns 1.0. Cached for 5 min like quotes.
    """
    code = (currency or "").strip().upper()
    if not code or code == "EUR":
        return 1.0

    cache_key = f"FX:{code}"
    async with _cache_lock:
        cached = _cache.get(cache_key)
        if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
            return cached[1]["rate"]

    rate = await asyncio.to_thread(_fx_blocking, code)
    if rate is None:
        return None
    async with _cache_lock:
        _cache[cache_key] = (time.time(), {"rate": rate})
    return rate


async def fetch_fx_rates(currencies: list[str]) -> dict[str, float]:
    unique = sorted({(c or "").strip().upper() for c in currencies if c})
    out: dict[str, float] = {}
    for c in unique:
        if c == "EUR":
            out[c] = 1.0
            continue
        rate = await fetch_fx_to_eur(c)
        if rate is not None:
            out[c] = rate
    return out


async def fetch_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    unique = sorted({(s or "").strip().upper() for s in symbols if s})
    results = await asyncio.gather(*(fetch_quote(s) for s in unique))
    return {s: r for s, r in zip(unique, results) if r is not None}


def invalidate_cache(symbol: str | None = None) -> None:
    if symbol is None:
        _cache.clear()
    else:
        _cache.pop(symbol.strip().upper(), None)
