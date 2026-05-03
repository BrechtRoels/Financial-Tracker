"""Pydantic-AI agent + streaming runner for the finance chat feature.

Design notes:
- The SQL tool uses a dedicated read-only SQLite connection so a malicious or
  buggy model can't mutate data.
- `render_chart` does not send data itself. It simply returns the validated
  spec; the outer streaming loop observes the tool call and re-emits the spec
  on the NDJSON wire.
- The agent is built lazily per-turn so its `deps` carry the current user id
  (for future multi-user scoping; today it's always 1 anyway).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, replace as dataclass_replace
from typing import Any, AsyncIterator, Literal
from urllib.parse import quote

import sqlparse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.profiles.openai import openai_model_profile
from pydantic_ai.providers.openai import OpenAIProvider
from sqlalchemy import create_engine, text

from .config import settings
from .db import SessionLocal
from .models import CustomTool

# Models exposed to the UI. Each entry is (id, display label, hint).
AVAILABLE_CHAT_MODELS: list[tuple[str, str, str]] = [
    ("openai.gpt-5.4-mini", "GPT-5.4 mini", "Fast and cheap — default"),
    ("openai.gpt-5.4-nano", "GPT-5.4 nano", "Cheapest; may be weaker at multi-step tool use"),
    ("bedrock.anthropic.claude-opus-4-6", "Claude Opus 4.6", "Strongest reasoning, slower & pricier"),
    ("bedrock.anthropic.claude-sonnet-4-5", "Claude Sonnet 4.5", "Balanced Claude — great for analysis"),
]

# ---------------------------------------------------------------------------
# Chart spec (shared contract with the frontend)
# ---------------------------------------------------------------------------


class ChartSpec(BaseModel):
    type: Literal["bar", "line", "area", "pie"]
    title: str = Field(max_length=120)
    x_key: str
    y_keys: list[str] = Field(min_length=1, max_length=6)
    data: list[dict[str, Any]] = Field(max_length=500)
    colors: list[str] | None = None
    stacked: bool = False
    y_format: Literal["eur", "number", "percent"] = "eur"


class ImageArtifact(BaseModel):
    title: str
    alt: str = ""
    png_b64: str  # raw base64 (no data:image prefix)


TOOL_KINDS = ("sql_rows", "sql_chart_png")


def render_chart_png(
    rows: list[dict[str, Any]],
    chart_type: Literal["bar", "line", "area", "pie"],
    x_column: str,
    y_columns: list[str],
    title: str,
) -> str:
    """Render a matplotlib chart from rows; return base64 PNG bytes."""
    import base64
    import io as _io

    import matplotlib  # noqa: E402

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt  # noqa: E402

    if not rows:
        raise ValueError("No data to render")
    xs = [r.get(x_column) for r in rows]

    fig, ax = plt.subplots(figsize=(8, 4.5), dpi=130)
    palette = ["#1E3A5F", "#2C5282", "#475569", "#64748B", "#94A3B8", "#CBD5E1"]

    if chart_type == "pie":
        y = y_columns[0]
        values = [float(r.get(y) or 0) for r in rows]
        ax.pie(values, labels=[str(x) for x in xs], autopct="%1.1f%%", colors=palette)
    elif chart_type == "bar":
        n = len(y_columns)
        import numpy as _np

        x_pos = _np.arange(len(xs))
        width = 0.8 / max(n, 1)
        for i, yk in enumerate(y_columns):
            vals = [float(r.get(yk) or 0) for r in rows]
            ax.bar(x_pos + i * width - (n - 1) * width / 2, vals, width, label=yk, color=palette[i % len(palette)])
        ax.set_xticks(x_pos)
        ax.set_xticklabels([str(x) for x in xs], rotation=30, ha="right")
        if n > 1:
            ax.legend()
    else:  # line or area
        for i, yk in enumerate(y_columns):
            vals = [float(r.get(yk) or 0) for r in rows]
            color = palette[i % len(palette)]
            ax.plot(xs, vals, marker="o", label=yk, color=color, linewidth=2)
            if chart_type == "area":
                ax.fill_between(range(len(xs)), vals, alpha=0.2, color=color)
        ax.tick_params(axis="x", rotation=30)
        if len(y_columns) > 1:
            ax.legend()

    ax.set_title(title, fontsize=12, loc="left", color="#0F172A")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()

    buf = _io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# ---------------------------------------------------------------------------
# Read-only SQLite engine reused across tool calls
# ---------------------------------------------------------------------------


def _readonly_engine():
    """Build a separate engine for the SQL chat tool.

    For plain SQLite we use `mode=ro` URI so writes are physically rejected.
    For libSQL/Turso (network DB) we don't have a read-only dialect, but
    `validate_sql()` already blocks anything that isn't a single SELECT/WITH
    statement, so we just return the main engine.
    """
    url = settings.database_url
    if url.startswith("sqlite+libsql"):
        # Reuse the main engine — write protection comes from validate_sql.
        from .db import engine as main_engine

        return main_engine
    if url.startswith("sqlite:///"):
        path = url.split("sqlite:///", 1)[1]
        ro_url = f"sqlite:///file:{quote(path, safe='/.-_')}?mode=ro&uri=true"
        return create_engine(ro_url, connect_args={"uri": True, "check_same_thread": False})
    # Non-SQLite (Postgres, etc.) — same fallback as libSQL.
    from .db import engine as main_engine

    return main_engine


_ro_engine = None


def get_ro_engine():
    global _ro_engine
    if _ro_engine is None:
        _ro_engine = _readonly_engine()
    return _ro_engine


_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|REPLACE|CREATE|TRUNCATE|REINDEX|VACUUM|PRAGMA)\b",
    re.I,
)


def validate_sql(sql: str) -> str:
    statements = [s for s in sqlparse.split(sql) if s.strip()]
    if len(statements) != 1:
        raise ValueError("Exactly one statement required")
    stmt = statements[0].strip().rstrip(";")
    if _FORBIDDEN.search(stmt):
        raise ValueError("Only SELECT / CTE queries are permitted")
    if not re.match(r"(?is)^\s*(select|with)\b", stmt):
        raise ValueError("Only SELECT / WITH queries are permitted")
    if not re.search(r"\bLIMIT\b", stmt, re.I):
        stmt = f"{stmt}\nLIMIT 500"
    return stmt


SCHEMA_TEXT = """Tables (SQLite):

accounts(id, user_id, name, type, iban, opening_balance_cents INT, archived BOOL, created_at)
  - type ∈ cash|checking|savings|investment|credit_card|loan|other
  - liabilities are credit_card and loan; everything else is an asset
  - balance = opening_balance_cents + SUM(transactions.amount_cents WHERE account_id = accounts.id)

categories(id, user_id, name, kind, color, icon)
  - kind ∈ income|expense

transactions(id, user_id, account_id, category_id, amount_cents INT, occurred_on DATE,
             description, transfer_group_id, counterparty_iban, counterparty_name,
             import_hash, created_at)
  - amount_cents is SIGNED: negative = expense / outflow, positive = income / inflow
  - IMPORTANT: transfer_group_id IS NOT NULL means this row is a transfer between the
    user's own accounts — exclude these from spending or income aggregates.
  - category_id is nullable (transfers, uncategorized imports)

budgets(id, user_id, category_id, month DATE, amount_cents INT)
  - month is the first day of the month

Guidance:
- All monetary values are integer cents; divide by 100.0 for EUR.
- For spending totals: SUM(-amount_cents) WHERE amount_cents < 0 AND transfer_group_id IS NULL.
- For income totals: SUM(amount_cents) WHERE amount_cents > 0 AND transfer_group_id IS NULL.
- To group by month: strftime('%Y-%m', occurred_on).
- This is a single-user DB; user_id = 1 in every row.
"""


# ---------------------------------------------------------------------------
# Agent deps + builder
# ---------------------------------------------------------------------------


@dataclass
class AgentDeps:
    user_id: int
    charts: list[ChartSpec]  # populated by render_chart; observed by the runner
    images: list[ImageArtifact]  # populated by sql_chart_png saved queries
    tool_calls: list[dict[str, Any]]  # shadow log for streaming events


BASE_SYSTEM_PROMPT = f"""You are a personal-finance analyst assistant for a single-user EUR app.

Answer the user's questions about their accounts, transactions, budgets, and categories.

You have these tools:
  - `list_tables` — returns the DB schema.
  - `sql_query` — run a read-only SELECT against SQLite. Returns rows as JSON.
  - `render_chart` — emit a chart to the UI. Prefer this when the user asks for
     a graph, trend, breakdown, or explicitly says "show" / "chart" / "plot".
  - `run_saved_query` — invoke one of the user's saved custom queries by name.
     Use this whenever a saved query already answers the question; it's faster
     and the user can tune the SQL directly.

Rules:
- Always ground numeric claims in a `sql_query` or `run_saved_query` result.
- When rendering a chart, first query the data, then call `render_chart` with
  the exact rows. Include a concise summary of the chart's insight.
- amount_cents is signed; for expense totals use SUM(-amount_cents) WHERE
  amount_cents < 0 AND transfer_group_id IS NULL.
- Format EUR as "€1,234.56" (2 decimals) in the summary.
- If the user refines an earlier answer ("now group by week", "add last year"),
  reuse the prior SQL structure and adjust filters/grouping.
- Refuse any request that would modify data; you only have read access.

{SCHEMA_TEXT}
"""


def _load_custom_tools(user_id: int) -> list[dict]:
    db = SessionLocal()
    try:
        rows = (
            db.query(CustomTool)
            .filter(CustomTool.user_id == user_id)
            .order_by(CustomTool.name.asc())
            .all()
        )
        out = []
        for t in rows:
            try:
                params = json.loads(t.parameters_json or "[]")
            except Exception:
                params = []
            try:
                config = json.loads(t.config_json) if t.config_json else None
            except Exception:
                config = None
            out.append(
                {
                    "id": t.id,
                    "name": t.name,
                    "description": t.description,
                    "kind": getattr(t, "kind", None) or "sql_rows",
                    "sql_template": t.sql_template,
                    "parameters": params,
                    "config": config,
                }
            )
        return out
    finally:
        db.close()


def _build_system_prompt(custom_tools: list[dict]) -> str:
    if not custom_tools:
        return BASE_SYSTEM_PROMPT
    lines = ["", "Available saved queries (call via run_saved_query):"]
    for t in custom_tools:
        params = t.get("parameters") or []
        sig = ", ".join(f"{p['name']}: {p.get('type', 'string')}" for p in params) or "(no args)"
        kind_tag = "image" if t.get("kind") == "sql_chart_png" else "rows"
        lines.append(
            f"  - {t['name']}({sig}) → {kind_tag} — {t['description']}"
        )
    lines.append("")
    lines.append(
        "When a saved query is of type 'image', calling it automatically attaches "
        "the PNG chart to your reply; you do NOT need to also call render_chart for "
        "the same data. Summarise the chart in text."
    )
    return BASE_SYSTEM_PROMPT + "\n".join(lines)


def _run_saved_query(
    user_id: int, name: str, args: dict[str, Any] | None
) -> tuple[str, list[dict[str, Any]] | ImageArtifact]:
    """Return (kind, payload). kind ∈ {'sql_rows', 'sql_chart_png'}."""
    db = SessionLocal()
    try:
        tool = (
            db.query(CustomTool)
            .filter(CustomTool.user_id == user_id, CustomTool.name == name)
            .first()
        )
        if not tool:
            raise ValueError(f"Saved query '{name}' not found")
        kind = getattr(tool, "kind", None) or "sql_rows"
        try:
            declared = json.loads(tool.parameters_json or "[]")
        except Exception:
            declared = []
        try:
            config = json.loads(tool.config_json) if tool.config_json else None
        except Exception:
            config = None
        provided = dict(args or {})
        bind = {}
        for p in declared:
            pname = p["name"]
            if pname not in provided:
                raise ValueError(f"Missing parameter: {pname}")
            bind[pname] = provided[pname]
        safe = validate_sql(tool.sql_template)
    finally:
        db.close()

    with get_ro_engine().connect() as conn:
        rows = conn.execute(text(safe), bind).mappings().all()
    records: list[dict[str, Any]] = []
    for r in rows:
        item: dict[str, Any] = {}
        for k, v in dict(r).items():
            item[k] = v.isoformat() if hasattr(v, "isoformat") else v
        records.append(item)

    if kind == "sql_chart_png":
        if not config:
            raise ValueError(f"Tool '{name}' has no chart config")
        chart_type = config.get("chart_type", "bar")
        x_column = config.get("x_column")
        y_columns = config.get("y_columns") or []
        title = config.get("title") or name
        if not x_column or not y_columns:
            raise ValueError(f"Tool '{name}' config missing x_column / y_columns")
        png_b64 = render_chart_png(records, chart_type, x_column, y_columns, title)
        return "sql_chart_png", ImageArtifact(title=title, alt=title, png_b64=png_b64)

    return "sql_rows", records


def build_agent(
    model_name: str | None = None, user_id: int = 1
) -> Agent[AgentDeps, str]:
    if not settings.genai_enabled:
        raise RuntimeError("GENAI_API_KEY is not set")
    from .app_settings import effective_chat_model

    resolved = model_name or effective_chat_model()
    valid = {m[0] for m in AVAILABLE_CHAT_MODELS}
    if resolved not in valid:
        raise ValueError(f"Unsupported model: {resolved}")

    client = AsyncOpenAI(
        base_url=f"{settings.genai_base_url}/v1",
        api_key=settings.genai_api_key,
        default_headers={"api-key": settings.genai_api_key},
    )
    profile = openai_model_profile(resolved)
    # LiteLLM proxy rejects encrypted_content include for these models.
    profile = dataclass_replace(
        profile,
        openai_supports_encrypted_reasoning_content=False,
        openai_supports_reasoning=False,
        supports_thinking=False,
    )
    model = OpenAIResponsesModel(
        resolved, provider=OpenAIProvider(openai_client=client), profile=profile
    )
    custom_tools = _load_custom_tools(user_id)
    agent = Agent(
        model,
        deps_type=AgentDeps,
        system_prompt=_build_system_prompt(custom_tools),
    )

    @agent.tool_plain
    def list_tables() -> str:
        """Return a description of the available tables and columns."""
        return SCHEMA_TEXT

    @agent.tool
    def sql_query(ctx: RunContext[AgentDeps], sql: str) -> list[dict[str, Any]]:
        """Run a read-only SELECT and return up to 500 rows as a list of dicts."""
        safe = validate_sql(sql)
        with get_ro_engine().connect() as conn:
            rows = conn.execute(text(safe)).mappings().all()
        # Normalise dates/times to ISO strings for JSON safety
        out: list[dict[str, Any]] = []
        for r in rows:
            item: dict[str, Any] = {}
            for k, v in dict(r).items():
                item[k] = v.isoformat() if hasattr(v, "isoformat") else v
            out.append(item)
        ctx.deps.tool_calls.append({"tool": "sql_query", "sql": safe, "rows": len(out)})
        return out

    @agent.tool
    def render_chart(ctx: RunContext[AgentDeps], spec: ChartSpec) -> dict[str, Any]:
        """Display a chart to the user. Call once per chart. Returns acknowledgement."""
        ctx.deps.charts.append(spec)
        ctx.deps.tool_calls.append({"tool": "render_chart", "title": spec.title, "type": spec.type})
        return {"ok": True, "rendered": True, "title": spec.title}

    @agent.tool
    def run_saved_query(
        ctx: RunContext[AgentDeps],
        name: str,
        args: dict[str, Any] | None = None,
    ) -> Any:
        """Run one of the user's named saved queries.

        `name` must match a saved query exactly. `args` supplies values for
        every declared parameter (see the list in the system prompt). For
        image-kind saved queries the PNG is attached to the reply automatically;
        this tool returns a short acknowledgement in that case.
        """
        kind, payload = _run_saved_query(ctx.deps.user_id, name, args)
        if kind == "sql_chart_png":
            assert isinstance(payload, ImageArtifact)
            ctx.deps.images.append(payload)
            ctx.deps.tool_calls.append(
                {"tool": "run_saved_query", "name": name, "kind": "image", "title": payload.title}
            )
            return {"kind": "image", "attached": True, "title": payload.title}
        assert isinstance(payload, list)
        ctx.deps.tool_calls.append(
            {"tool": "run_saved_query", "name": name, "rows": len(payload)}
        )
        return payload

    return agent


# ---------------------------------------------------------------------------
# Streaming runner
# ---------------------------------------------------------------------------


def _evt(stage: str, **kw: Any) -> str:
    return json.dumps({"stage": stage, **kw}, default=str) + "\n"


def history_to_model_messages(
    rows: list[dict[str, Any]],
) -> list[ModelMessage]:
    """Convert persisted chat messages into Pydantic-AI ModelMessages."""
    messages: list[ModelMessage] = []
    for row in rows:
        role = row["role"]
        if role == "user":
            messages.append(ModelRequest(parts=[UserPromptPart(content=row["content"])]))
        elif role == "assistant":
            content = row.get("content") or ""
            if content:
                messages.append(ModelResponse(parts=[TextPart(content=content)]))
    return messages


def _tool_call_preview(part: ToolCallPart) -> dict[str, Any]:
    try:
        args = part.args_as_dict()
    except Exception:
        raw = part.args
        if isinstance(raw, str):
            try:
                args = json.loads(raw)
            except Exception:
                args = {"_raw": raw[:400]}
        elif isinstance(raw, dict):
            args = raw
        else:
            args = {}
    if part.tool_name == "sql_query" and "sql" in args:
        args = {"sql": str(args["sql"])[:400]}
    elif part.tool_name == "render_chart" and "spec" in args:
        s = args["spec"]
        if isinstance(s, dict):
            args = {
                "spec": {
                    k: v for k, v in s.items() if k in {"type", "title", "x_key", "y_keys"}
                }
            }
    return args


async def run_chat_stream(
    user_message: str,
    history: list[ModelMessage],
    user_id: int,
    model_name: str | None = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Run the agent, yielding (event_stage, payload) tuples.

    payload for "final" is a dict; for everything else it's a pre-formatted
    NDJSON line (str) ready to be written to the wire.
    """
    agent = build_agent(model_name, user_id=user_id)
    deps = AgentDeps(user_id=user_id, charts=[], images=[], tool_calls=[])

    yield "thinking", _evt("thinking")
    emitted_chart_ids: set[int] = set()
    emitted_image_ids: set[int] = set()

    async with agent.iter(user_message, message_history=history, deps=deps) as run:
        async for node in run:
            node_name = type(node).__name__
            if node_name == "CallToolsNode":
                response = getattr(node, "model_response", None)
                if response is None:
                    continue
                for part in response.parts:
                    if isinstance(part, ToolCallPart):
                        yield "tool_call", _evt(
                            "tool_call",
                            tool=part.tool_name,
                            args=_tool_call_preview(part),
                        )
                    elif isinstance(part, TextPart):
                        if part.content:
                            yield "text_delta", _evt("text_delta", text=part.content)
            elif node_name == "ModelRequestNode":
                request = getattr(node, "request", None)
                if request is None:
                    continue
                for part in request.parts:
                    if isinstance(part, ToolReturnPart):
                        size = None
                        content = part.content
                        if isinstance(content, list):
                            size = len(content)
                        yield "tool_result", _evt(
                            "tool_result", tool=part.tool_name, ok=True, rows=size
                        )
            # After any node, flush newly rendered charts + images
            for i, chart in enumerate(deps.charts):
                if i not in emitted_chart_ids:
                    emitted_chart_ids.add(i)
                    yield "chart", _evt("chart", chart=chart.model_dump())
            for i, img in enumerate(deps.images):
                if i not in emitted_image_ids:
                    emitted_image_ids.add(i)
                    yield "image", _evt("image", image=img.model_dump())

        result = run.result
        final_text = ""
        if result is not None:
            final_text = result.output if isinstance(result.output, str) else str(result.output)

    yield "final", {
        "text": final_text,
        "charts": [c.model_dump() for c in deps.charts],
        "images": [i.model_dump() for i in deps.images],
        "tool_calls": deps.tool_calls,
    }
