"""Tiny Nominatim-backed geocoder with persistent cache.

Nominatim (OpenStreetMap) is free and requires only a polite User-Agent header
plus a 1 req/sec rate limit. Each (country, city) pair is geocoded once and
the result is stored in `geocode_cache`; subsequent calls are instant.

A precomputed seed of common Belgian cities saves the very first round-trip.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from .models import GeocodeCache

logger = logging.getLogger(__name__)

_USER_AGENT = "FinancialTracker/0.1 (personal-use; contact@local)"
_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# Hardcoded coords for cities that occur most often in KBC exports — saves
# Nominatim calls on the first import and works offline.
_SEED: dict[tuple[str | None, str], tuple[float, float]] = {
    ("BE", "GENT"): (51.0543, 3.7174),
    ("BE", "BRUSSELS"): (50.8503, 4.3517),
    ("BE", "BRUXELLES"): (50.8503, 4.3517),
    ("BE", "ANTWERPEN"): (51.2194, 4.4025),
    ("BE", "JABBEKE"): (51.1933, 3.0936),
    ("BE", "OOSTKAMP"): (51.1453, 3.2536),
    ("BE", "ZEDELGEM"): (51.1583, 3.1675),
    ("BE", "ZAVENTEM"): (50.8853, 4.4717),
    ("BE", "MOLENBEEK-SAI"): (50.8556, 4.3352),
    ("BE", "MOLENBEEK"): (50.8556, 4.3352),
    ("BE", "MACHELEN"): (50.8961, 4.4358),
    ("BE", "DIEGEM"): (50.8911, 4.4506),
    ("BE", "WOLUWE"): (50.8417, 4.4275),
    ("BE", "HASSELT"): (50.9307, 5.3325),
    ("BE", "ETTELGEM"): (51.1672, 2.9889),
    ("BE", "DE HAAN"): (51.2783, 3.0367),
    ("BE", "RUMST"): (51.0844, 4.4147),
    ("BE", "ELSENE"): (50.8275, 4.3725),
    ("BE", "OOSTENDE"): (51.2194, 2.9111),
    ("BE", "AMSTERDAM"): (52.3676, 4.9041),  # safety
    ("PT", "LISBOA"): (38.7223, -9.1393),
    ("DE", "NIEDERZISSEN"): (50.5039, 7.2406),
    ("DE", "PFORZHEIM"): (48.8898, 8.6976),
    ("AT", "SANKT ANTON A"): (47.1296, 10.2649),
    ("AT", "ST. ANTON"): (47.1296, 10.2649),
    ("NL", "WAALWIJK"): (51.6886, 5.0689),
    ("NL", "AMSTERDAM"): (52.3676, 4.9041),
    ("LU", "LUXEMBOURG"): (49.6116, 6.1319),
}

_inflight_lock = asyncio.Lock()


def _key(country: str | None, city: str) -> tuple[str | None, str]:
    return ((country or None), (city or "").upper().strip())


async def _nominatim_lookup(city: str, country: str | None) -> tuple[float, float] | None:
    params: dict[str, str] = {"city": city, "format": "json", "limit": "1"}
    if country:
        params["countrycodes"] = country.lower()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                _NOMINATIM_URL,
                params=params,
                headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            )
        if resp.status_code != 200:
            logger.info("Nominatim %s/%s -> HTTP %s", country, city, resp.status_code)
            return None
        rows = resp.json()
    except Exception as e:
        logger.warning("Nominatim lookup %s/%s failed: %s", country, city, e)
        return None
    if not rows:
        return None
    try:
        return float(rows[0]["lat"]), float(rows[0]["lon"])
    except (KeyError, ValueError, TypeError):
        return None


async def geocode_pairs(
    db: Session,
    pairs: list[tuple[str, str | None]],
) -> dict[tuple[str | None, str], tuple[float, float] | None]:
    """Resolve a batch of (city, country) pairs, hitting cache + seed first."""
    out: dict[tuple[str | None, str], tuple[float, float] | None] = {}
    if not pairs:
        return out

    unique = sorted({_key(country, city) for city, country in pairs})

    # Pull existing cached rows in one query
    cached_rows = db.query(GeocodeCache).filter(
        # SQLite supports tuple IN via OR-chain; loop is cleaner
    ).all()
    cached_map: dict[tuple[str | None, str], GeocodeCache] = {
        ((r.country or None), (r.city or "").upper().strip()): r for r in cached_rows
    }

    misses: list[tuple[str | None, str]] = []
    for k in unique:
        if k in _SEED:
            out[k] = _SEED[k]
            continue
        row = cached_map.get(k)
        if row is not None:
            if row.lat is not None and row.lon is not None:
                out[k] = (row.lat, row.lon)
            else:
                out[k] = None  # known miss
            continue
        misses.append(k)

    # Geocode misses serially (Nominatim allows ~1 req/s).
    async with _inflight_lock:
        for country, city in misses:
            coords = await _nominatim_lookup(city, country)
            row = GeocodeCache(
                city=city,
                country=country,
                lat=coords[0] if coords else None,
                lon=coords[1] if coords else None,
                fetched_at=datetime.utcnow(),
            )
            db.add(row)
            out[(country, city)] = coords
            await asyncio.sleep(1.05)  # be polite
        db.commit()

    return out
