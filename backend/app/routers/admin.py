"""Admin-only endpoints: runtime model selection + per-user AI toggle.

Mounted at /admin. Every endpoint requires the caller to be flagged
`is_admin=True`. The seeded `Admin` account exists for this; ordinary users
created via /auth/setup are non-admin by default.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from .. import app_settings as app_settings_helpers
from ..app_settings import CHAT_MODEL, LLM_MODEL, VISION_MODEL, get_setting, set_setting
from ..chat import AVAILABLE_CHAT_MODELS
from ..config import settings
from ..deps import get_db, require_admin
from ..models import User

router = APIRouter(prefix="/admin", tags=["admin"])


class AdminSettingsOut(BaseModel):
    chat_model: str
    llm_model: str
    vision_model: str
    available_models: list[dict]


class AdminSettingsIn(BaseModel):
    chat_model: str | None = None
    llm_model: str | None = None
    vision_model: str | None = None


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    is_admin: bool
    ai_enabled: bool
    created_at: datetime


class AdminUserUpdate(BaseModel):
    ai_enabled: bool | None = None


def _settings_payload(db: Session) -> AdminSettingsOut:
    return AdminSettingsOut(
        chat_model=get_setting(db, CHAT_MODEL),
        llm_model=get_setting(db, LLM_MODEL),
        vision_model=get_setting(db, VISION_MODEL),
        available_models=[
            {"id": mid, "label": label, "hint": hint}
            for (mid, label, hint) in AVAILABLE_CHAT_MODELS
        ],
    )


@router.get("/settings", response_model=AdminSettingsOut)
def admin_get_settings(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminSettingsOut:
    return _settings_payload(db)


@router.patch("/settings", response_model=AdminSettingsOut)
def admin_update_settings(
    body: AdminSettingsIn,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminSettingsOut:
    valid_ids = {m[0] for m in AVAILABLE_CHAT_MODELS}
    if body.chat_model is not None:
        if body.chat_model and body.chat_model not in valid_ids:
            raise HTTPException(400, f"Unknown model: {body.chat_model}")
        set_setting(db, CHAT_MODEL, body.chat_model or settings.genai_chat_model)
    if body.llm_model is not None:
        if body.llm_model and body.llm_model not in valid_ids:
            raise HTTPException(400, f"Unknown model: {body.llm_model}")
        set_setting(db, LLM_MODEL, body.llm_model or settings.genai_llm_model)
    if body.vision_model is not None:
        if body.vision_model and body.vision_model not in valid_ids:
            raise HTTPException(400, f"Unknown model: {body.vision_model}")
        set_setting(db, VISION_MODEL, body.vision_model or settings.genai_vision_model)
    return _settings_payload(db)


@router.get("/users", response_model=list[AdminUserOut])
def admin_list_users(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    return db.query(User).order_by(User.id.asc()).all()


@router.patch("/users/{user_id}", response_model=AdminUserOut)
def admin_update_user(
    user_id: int,
    body: AdminUserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target.is_admin and target.id == admin.id and body.ai_enabled is False:
        # Admin can disable AI for themselves — fine; not a guard. We DO refuse
        # to flip is_admin off on the last admin, but is_admin is read-only here.
        pass
    if body.ai_enabled is not None:
        target.ai_enabled = bool(body.ai_enabled)
    db.commit()
    db.refresh(target)
    return target


# Re-export helpers under the router module for convenience in tests.
__all__ = ["router", "app_settings_helpers"]
