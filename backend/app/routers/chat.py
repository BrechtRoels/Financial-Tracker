from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from typing import Literal

from pydantic import BaseModel
from sqlalchemy.orm import Session

import re

from ..chat import (
    AVAILABLE_CHAT_MODELS,
    SCHEMA_TEXT,
    history_to_model_messages,
    run_chat_stream,
    validate_sql,
)
from ..config import settings
from ..deps import get_current_user, get_db, require_ai_user
from ..genai import llm_complete
from ..models import ChatMessage, ChatSession, CustomTool, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class SessionOut(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    tool_name: str | None = None
    tool_args: dict | None = None
    tool_result: Any = None
    chart_spec: dict | None = None
    images: Any = None
    created_at: str


class StreamRequest(BaseModel):
    message: str
    model: str | None = None


class ModelOut(BaseModel):
    id: str
    label: str
    hint: str


@router.get("/models", response_model=list[ModelOut])
def list_models(user: User = Depends(get_current_user)):
    return [
        ModelOut(id=mid, label=label, hint=hint)
        for (mid, label, hint) in AVAILABLE_CHAT_MODELS
    ]


@router.get("/config")
def chat_config(user: User = Depends(get_current_user)):
    return {
        "default_model": settings.genai_chat_model,
        "enabled": settings.genai_enabled,
    }


# ---------------------------------------------------------------------------
# Custom tools (saved SQL queries the agent can invoke by name)
# ---------------------------------------------------------------------------

_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,58}[a-z0-9]$")


class CustomToolParameter(BaseModel):
    name: str
    type: str = "string"
    description: str = ""


class ChartConfig(BaseModel):
    chart_type: Literal["bar", "line", "area", "pie"]
    x_column: str
    y_columns: list[str]
    title: str = ""


class CustomToolOut(BaseModel):
    id: int
    name: str
    description: str
    kind: Literal["sql_rows", "sql_chart_png"] = "sql_rows"
    sql_template: str
    parameters: list[CustomToolParameter]
    config: ChartConfig | None = None
    created_at: str


class CustomToolUpsert(BaseModel):
    name: str
    description: str
    kind: Literal["sql_rows", "sql_chart_png"] = "sql_rows"
    sql_template: str
    parameters: list[CustomToolParameter] = []
    config: ChartConfig | None = None


class DraftToolRequest(BaseModel):
    prompt: str
    model: str | None = None


def _tool_to_out(t: CustomTool) -> CustomToolOut:
    try:
        params = json.loads(t.parameters_json or "[]")
    except Exception:
        params = []
    try:
        cfg = json.loads(t.config_json) if t.config_json else None
    except Exception:
        cfg = None
    return CustomToolOut(
        id=t.id,
        name=t.name,
        description=t.description,
        kind=getattr(t, "kind", None) or "sql_rows",
        sql_template=t.sql_template,
        parameters=[CustomToolParameter(**p) for p in params],
        config=ChartConfig(**cfg) if cfg else None,
        created_at=t.created_at.isoformat(),
    )


def _validate_tool_payload(payload: CustomToolUpsert) -> None:
    if not _NAME_RE.match(payload.name):
        raise HTTPException(
            status_code=400,
            detail="Name must be snake_case, 3-60 chars, starting with a letter",
        )
    # Ensure SQL is a valid SELECT (raises ValueError if not)
    try:
        validate_sql(payload.sql_template)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"SQL rejected: {e}")
    # Parameter names referenced in template must match declared params
    referenced = set(re.findall(r":([a-zA-Z_][a-zA-Z0-9_]*)", payload.sql_template))
    declared = {p.name for p in payload.parameters}
    missing = referenced - declared
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"SQL references undeclared parameters: {sorted(missing)}",
        )
    if payload.kind == "sql_chart_png":
        if not payload.config:
            raise HTTPException(
                status_code=400,
                detail="Chart tools require a 'config' with chart_type, x_column and y_columns",
            )
        if not payload.config.y_columns:
            raise HTTPException(status_code=400, detail="config.y_columns cannot be empty")


@router.get("/tools", response_model=list[CustomToolOut])
def list_tools(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(CustomTool)
        .filter(CustomTool.user_id == user.id)
        .order_by(CustomTool.name.asc())
        .all()
    )
    return [_tool_to_out(t) for t in rows]


@router.post("/tools", response_model=CustomToolOut)
def create_tool(
    payload: CustomToolUpsert,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_tool_payload(payload)
    existing = (
        db.query(CustomTool)
        .filter(CustomTool.user_id == user.id, CustomTool.name == payload.name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="Name already in use")
    t = CustomTool(
        user_id=user.id,
        name=payload.name,
        description=payload.description[:500],
        kind=payload.kind,
        sql_template=payload.sql_template,
        parameters_json=json.dumps([p.model_dump() for p in payload.parameters]),
        config_json=json.dumps(payload.config.model_dump()) if payload.config else None,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _tool_to_out(t)


@router.patch("/tools/{tool_id}", response_model=CustomToolOut)
def update_tool(
    tool_id: int,
    payload: CustomToolUpsert,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = (
        db.query(CustomTool)
        .filter(CustomTool.id == tool_id, CustomTool.user_id == user.id)
        .first()
    )
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    _validate_tool_payload(payload)
    conflict = (
        db.query(CustomTool)
        .filter(
            CustomTool.user_id == user.id,
            CustomTool.name == payload.name,
            CustomTool.id != tool_id,
        )
        .first()
    )
    if conflict:
        raise HTTPException(status_code=400, detail="Name already in use")
    t.name = payload.name
    t.description = payload.description[:500]
    t.kind = payload.kind
    t.sql_template = payload.sql_template
    t.parameters_json = json.dumps([p.model_dump() for p in payload.parameters])
    t.config_json = json.dumps(payload.config.model_dump()) if payload.config else None
    db.commit()
    db.refresh(t)
    return _tool_to_out(t)


@router.delete("/tools/{tool_id}")
def delete_tool(
    tool_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    t = (
        db.query(CustomTool)
        .filter(CustomTool.id == tool_id, CustomTool.user_id == user.id)
        .first()
    )
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(t)
    db.commit()
    return {"ok": True}


_DRAFT_PROMPT = """You design parameterised SQL tools for a personal-finance assistant.

The user describes in plain language what kind of data / chart a new tool
should return. Decide whether the output is better as rows (kind "sql_rows")
or as a PNG chart (kind "sql_chart_png"). If the user mentions chart, graph,
plot, visualise, png, image, or a specific chart type (bar/line/pie/area) →
choose "sql_chart_png".

Produce a JSON object with these fields (and nothing else):

{{
  "name": "snake_case_identifier",         // 3-60 chars, starts with a letter
  "description": "short description",
  "kind": "sql_rows" | "sql_chart_png",
  "sql_template": "SELECT ...",            // a single SELECT or WITH statement
  "parameters": [                          // zero or more
    {{"name": "param_name", "type": "string|number|date", "description": "..."}}
  ],
  "config": null | {{                      // required iff kind == "sql_chart_png"
    "chart_type": "bar" | "line" | "area" | "pie",
    "x_column": "column_name",             // a column returned by sql_template
    "y_columns": ["column_name", ...],     // one or more numeric columns
    "title": "Short chart title"
  }}
}}

Rules:
- SQL must be read-only (SELECT / WITH CTE only). No INSERT/UPDATE/DELETE/DROP.
- Reference parameters via sqlalchemy named placeholders (":param_name").
- All parameters referenced in the SQL MUST appear in "parameters" exactly once.
- Use the schema below. Always exclude transfers from income/expense aggregates
  (transfer_group_id IS NULL). amount_cents is signed (negative = expense).
- Include a LIMIT 500 in the query.
- For chart tools, the SELECT must return at minimum the x_column and each
  y_column. Aliases are fine as long as they match.
- Output ONLY the JSON object, no markdown fences, no prose.

{schema}

User request:
{prompt}
"""


def _parse_draft_json(text: str) -> dict:
    s = text.strip()
    if s.startswith("```"):
        s = s.strip("`").strip()
        if s.lower().startswith("json"):
            s = s[4:].lstrip()
    m = re.search(r"\{[\s\S]*\}", s)
    if m:
        s = m.group(0)
    return json.loads(s)


@router.post("/tools/draft", response_model=CustomToolUpsert)
async def draft_tool(
    body: DraftToolRequest,
    user: User = Depends(require_ai_user),
):
    if not settings.genai_enabled:
        raise HTTPException(status_code=400, detail="AI is unavailable")
    prompt_text = _DRAFT_PROMPT.format(schema=SCHEMA_TEXT, prompt=body.prompt.strip())
    text = await llm_complete(prompt_text, model=body.model or settings.genai_chat_model)
    try:
        draft = _parse_draft_json(text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not parse AI draft: {e}")
    try:
        return CustomToolUpsert(**draft)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI draft invalid: {e}")


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user.id)
        .order_by(ChatSession.updated_at.desc())
        .all()
    )
    return [
        SessionOut(
            id=s.id,
            title=s.title,
            created_at=s.created_at.isoformat(),
            updated_at=s.updated_at.isoformat(),
        )
        for s in rows
    ]


@router.post("/sessions", response_model=SessionOut)
def create_session(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    s = ChatSession(user_id=user.id, title="New chat")
    db.add(s)
    db.commit()
    db.refresh(s)
    return SessionOut(
        id=s.id,
        title=s.title,
        created_at=s.created_at.isoformat(),
        updated_at=s.updated_at.isoformat(),
    )


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    s = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Not found")
    db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
    db.delete(s)
    db.commit()
    return {"ok": True}


def _to_message_out(m: ChatMessage) -> MessageOut:
    return MessageOut(
        id=m.id,
        role=m.role,
        content=m.content or "",
        tool_name=m.tool_name,
        tool_args=json.loads(m.tool_args_json) if m.tool_args_json else None,
        tool_result=json.loads(m.tool_result_json) if m.tool_result_json else None,
        chart_spec=json.loads(m.chart_spec_json) if m.chart_spec_json else None,
        images=json.loads(m.images_json) if getattr(m, "images_json", None) else None,
        created_at=m.created_at.isoformat(),
    )


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
def list_messages(
    session_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    s = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Not found")
    rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.id.asc())
        .all()
    )
    return [_to_message_out(m) for m in rows]


@router.post("/sessions/{session_id}/stream")
async def stream_chat(
    session_id: int,
    body: StreamRequest,
    user: User = Depends(require_ai_user),
    db: Session = Depends(get_db),
):
    if not settings.genai_enabled:
        raise HTTPException(
            status_code=400,
            detail="Chat is unavailable — set GENAI_API_KEY in the backend .env",
        )
    s = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    user_message = body.message.strip()
    if not user_message:
        raise HTTPException(status_code=400, detail="Empty message")

    # Persist the user's message immediately and load prior history for context.
    user_msg = ChatMessage(session_id=session_id, role="user", content=user_message)
    db.add(user_msg)
    if s.title in ("New chat", "") or not s.title:
        s.title = user_message[:60]
    db.commit()
    db.refresh(user_msg)

    prior_rows = (
        db.query(ChatMessage)
        .filter(
            ChatMessage.session_id == session_id,
            ChatMessage.id < user_msg.id,
            ChatMessage.role.in_(["user", "assistant"]),
        )
        .order_by(ChatMessage.id.asc())
        .all()
    )
    history = history_to_model_messages(
        [{"role": r.role, "content": r.content or ""} for r in prior_rows]
    )

    async def gen():
        final_text = ""
        charts: list[dict] = []
        images: list[dict] = []
        tool_calls: list[dict] = []
        try:
            async for stage, payload in run_chat_stream(
                user_message, history, user.id, model_name=body.model
            ):
                if stage == "final":
                    final_text = payload.get("text", "")
                    charts = payload.get("charts", [])
                    images = payload.get("images", [])
                    tool_calls = payload.get("tool_calls", [])
                else:
                    yield payload  # already a newline-terminated JSON event
        except Exception as e:
            logger.exception("chat stream failed")
            yield json.dumps({"stage": "error", "detail": str(e)}, default=str) + "\n"
            return

        # Persist the assistant's turn
        assistant = ChatMessage(
            session_id=session_id,
            role="assistant",
            content=final_text,
            tool_result_json=json.dumps(tool_calls) if tool_calls else None,
            chart_spec_json=json.dumps(charts) if charts else None,
            images_json=json.dumps(images) if images else None,
        )
        db.add(assistant)
        db.commit()
        db.refresh(assistant)
        yield json.dumps({"stage": "done", "message_id": assistant.id}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson")
