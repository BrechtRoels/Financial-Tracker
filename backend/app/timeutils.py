"""Calendar helpers that respect the user's `month_start_day`.

For the default (1) the windows match calendar months. For paycheck-anchored
users (e.g. start_day=27) the financial month begins on the 27th and ends
the day before next month's 27th — so May 2026 with start_day=27 covers
Apr 27 → May 26 inclusive.
"""

from __future__ import annotations

from datetime import date, timedelta


def _safe_day(year: int, month: int, day: int) -> date:
    """Clamp `day` to the last day of the month (Feb 29/30 etc.)."""
    next_month = date(year + (month == 12), (month % 12) + 1, 1)
    last = next_month - timedelta(days=1)
    return date(year, month, min(day, last.day))


def month_window(today: date, start_day: int) -> tuple[date, date]:
    """Return [start, end] inclusive for the financial month containing `today`.

    `start_day` is clamped to 1..28.
    """
    start_day = max(1, min(28, int(start_day or 1)))
    if today.day >= start_day:
        start = _safe_day(today.year, today.month, start_day)
    else:
        prev_year = today.year - (today.month == 1)
        prev_month = 12 if today.month == 1 else today.month - 1
        start = _safe_day(prev_year, prev_month, start_day)
    next_year = start.year + (start.month == 12)
    next_month = 1 if start.month == 12 else start.month + 1
    next_start = _safe_day(next_year, next_month, start_day)
    end = next_start - timedelta(days=1)
    return start, end


def month_anchor(d: date, start_day: int) -> date:
    """The financial-month-start date for the window that contains `d`.

    Useful as a stable key when grouping by month.
    """
    return month_window(d, start_day)[0]
