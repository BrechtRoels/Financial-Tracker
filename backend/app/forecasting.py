"""Damped Holt linear exponential smoothing + confidence band.

Pure Python, no numpy. ~50 lines of model + grid search. Fast enough for
series up to a few hundred points (fraction of a ms).
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class HoltFit:
    alpha: float
    beta: float
    phi: float
    level: float
    trend: float
    fitted: list[float]  # one-step-ahead predictions aligned with y
    residuals: list[float]
    sigma: float  # stdev of residuals
    sse: float


def _run_holt(ys: list[float], alpha: float, beta: float, phi: float) -> HoltFit:
    n = len(ys)
    if n < 2:
        return HoltFit(
            alpha=alpha,
            beta=beta,
            phi=phi,
            level=ys[0] if ys else 0.0,
            trend=0.0,
            fitted=[],
            residuals=[],
            sigma=0.0,
            sse=0.0,
        )

    level = ys[0]
    trend = ys[1] - ys[0]
    fitted: list[float] = []
    residuals: list[float] = []
    sse = 0.0

    for t in range(n):
        # One-step-ahead prediction made before seeing y_t
        if t == 0:
            y_hat = level
        else:
            y_hat = level + phi * trend
        fitted.append(y_hat)
        err = ys[t] - y_hat
        residuals.append(err)
        sse += err * err

        # Update level and trend using the actual y_t
        new_level = alpha * ys[t] + (1.0 - alpha) * (level + phi * trend)
        new_trend = beta * (new_level - level) + (1.0 - beta) * phi * trend
        level, trend = new_level, new_trend

    # Residual stdev (Bessel-corrected). Guard tiny series.
    if n > 1:
        mean_r = sum(residuals) / n
        var = sum((r - mean_r) ** 2 for r in residuals) / (n - 1)
        sigma = math.sqrt(var) if var > 0 else 0.0
    else:
        sigma = 0.0

    return HoltFit(
        alpha=alpha,
        beta=beta,
        phi=phi,
        level=level,
        trend=trend,
        fitted=fitted,
        residuals=residuals,
        sigma=sigma,
        sse=sse,
    )


def fit_damped_holt(ys: list[float]) -> HoltFit:
    """Grid-search α, β, φ minimising in-sample one-step-ahead SSE."""
    if len(ys) < 3:
        # degenerate: return a flat model that still has valid fields
        return _run_holt(ys or [0.0], alpha=0.5, beta=0.1, phi=1.0)

    best: HoltFit | None = None
    alphas = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    betas = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9]
    phis = [0.85, 0.9, 0.95, 0.98, 1.0]
    for a in alphas:
        for b in betas:
            for p in phis:
                fit = _run_holt(ys, a, b, p)
                if best is None or fit.sse < best.sse:
                    best = fit
    assert best is not None
    return best


def forecast_path(fit: HoltFit, horizon: int) -> list[float]:
    """h-step point forecasts under damped Holt: level + (φ + φ² + … + φ^h)·trend."""
    phi = fit.phi
    out: list[float] = []
    damp_sum = 0.0
    for h in range(1, horizon + 1):
        damp_sum += phi**h
        out.append(fit.level + damp_sum * fit.trend)
    return out


def band(fit: HoltFit, horizon: int, z: float = 1.28) -> list[tuple[float, float]]:
    """Per-step (lower, upper) offsets relative to zero; widens with sqrt(h)."""
    bands: list[tuple[float, float]] = []
    sigma = fit.sigma
    for h in range(1, horizon + 1):
        spread = z * sigma * math.sqrt(h)
        bands.append((-spread, spread))
    return bands


def rmse(fit: HoltFit) -> float:
    if not fit.residuals:
        return 0.0
    return math.sqrt(fit.sse / len(fit.residuals))
