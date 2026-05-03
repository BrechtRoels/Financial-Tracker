"""Read/write helpers for the app_settings key-value table.

Admin-controlled runtime settings (e.g. which AI model to use). Falls back to
the env-driven `Settings` defaults when a key isn't present in the DB.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from .config import settings
from .models import AppSetting

CHAT_MODEL = "chat_model"
LLM_MODEL = "llm_model"
VISION_MODEL = "vision_model"

_FALLBACKS: dict[str, str] = {
    CHAT_MODEL: settings.genai_chat_model,
    LLM_MODEL: settings.genai_llm_model,
    VISION_MODEL: settings.genai_vision_model,
}


def get_setting(db: Session, key: str) -> str:
    row = db.get(AppSetting, key)
    if row and row.value:
        return row.value
    return _FALLBACKS.get(key, "")


def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    db.commit()


def _effective(key: str) -> str:
    """Open a short-lived session and read the effective model.

    Used by code paths (genai.llm_complete, build_agent) that don't have a
    request-scoped DB session handy.
    """
    from .db import SessionLocal

    with SessionLocal() as db:
        return get_setting(db, key)


def effective_chat_model() -> str:
    return _effective(CHAT_MODEL)


def effective_llm_model() -> str:
    return _effective(LLM_MODEL)


def effective_vision_model() -> str:
    return _effective(VISION_MODEL)
