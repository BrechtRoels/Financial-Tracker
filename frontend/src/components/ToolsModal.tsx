import { useEffect, useState } from "react";
import Modal from "./Modal";
import {
  CustomTool,
  CustomToolUpsert,
  createTool,
  deleteTool,
  draftTool,
  listTools,
  updateTool,
} from "../api/chat";

type Props = {
  open: boolean;
  onClose: () => void;
  model?: string;
  onToolsChanged?: () => void;
};

type Draft = CustomToolUpsert & { id?: number };

const emptyDraft: Draft = {
  name: "",
  description: "",
  kind: "sql_rows",
  sql_template: "",
  parameters: [],
  config: null,
};

const defaultChartConfig = {
  chart_type: "bar" as const,
  x_column: "",
  y_columns: [] as string[],
  title: "",
};

export default function ToolsModal({ open, onClose, model, onToolsChanged }: Props) {
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [nl, setNl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      refresh();
      setEditing(null);
      setErr(null);
    }
  }, [open]);

  async function refresh() {
    try {
      setTools(await listTools());
    } catch {
      setTools([]);
    }
  }

  async function startDraft() {
    if (!nl.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const draft = await draftTool(nl.trim(), model);
      setEditing({ ...draft });
      setNl("");
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setErr(null);
    try {
      if (editing.id) await updateTool(editing.id, editing);
      else await createTool(editing);
      setEditing(null);
      await refresh();
      onToolsChanged?.();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this tool?")) return;
    await deleteTool(id);
    await refresh();
    onToolsChanged?.();
  }

  function addParam() {
    if (!editing) return;
    setEditing({
      ...editing,
      parameters: [...editing.parameters, { name: "", type: "string", description: "" }],
    });
  }

  function updateParam(i: number, patch: Partial<{ name: string; type: string; description: string }>) {
    if (!editing) return;
    const next = [...editing.parameters];
    next[i] = { ...next[i], ...patch };
    setEditing({ ...editing, parameters: next });
  }

  function removeParam(i: number) {
    if (!editing) return;
    const next = [...editing.parameters];
    next.splice(i, 1);
    setEditing({ ...editing, parameters: next });
  }

  return (
    <Modal open={open} onClose={onClose} title="Custom agent tools">
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-auto">
        {!editing && (
          <>
            <div className="rounded-xl border border-line p-3 bg-brand-50/50">
              <div className="label mb-1">Create a new tool</div>
              <textarea
                className="input min-h-[70px]"
                placeholder="Describe what the tool should return, e.g. &quot;My total spending in a given month, split by category.&quot;"
                value={nl}
                onChange={(e) => setNl(e.target.value)}
                disabled={busy}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  className="btn-primary text-xs"
                  onClick={startDraft}
                  disabled={busy || !nl.trim()}
                >
                  {busy ? "Drafting…" : "Generate draft with AI"}
                </button>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => setEditing({ ...emptyDraft })}
                  disabled={busy}
                >
                  Start from scratch
                </button>
              </div>
              {err && <div className="mt-2 text-xs text-neg">{err}</div>}
            </div>

            <div>
              <div className="label mb-2">Your tools ({tools.length})</div>
              {tools.length === 0 && (
                <div className="text-xs text-subink py-4 text-center">
                  No custom tools yet. Create one above.
                </div>
              )}
              <div className="flex flex-col gap-2">
                {tools.map((t) => (
                  <div key={t.id} className="rounded-lg border border-line p-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{t.name}</span>
                        <span className="chip bg-brand-50 border border-line text-[10px] px-1.5 py-0.5">
                          {t.kind === "sql_chart_png" ? "PNG chart" : "rows"}
                        </span>
                      </div>
                      <div className="text-xs text-subink">{t.description}</div>
                      {t.parameters.length > 0 && (
                        <div className="mt-1 text-[11px] text-subink">
                          params: {t.parameters.map((p) => p.name).join(", ")}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        className="btn-ghost text-xs"
                        onClick={() =>
                          setEditing({
                            id: t.id,
                            name: t.name,
                            description: t.description,
                            kind: t.kind,
                            sql_template: t.sql_template,
                            parameters: t.parameters,
                            config: t.config ?? null,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button className="btn-ghost text-xs text-neg" onClick={() => remove(t.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {editing && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">
                {editing.id ? "Edit tool" : "New tool"}
              </div>
              <button className="text-xs text-subink" onClick={() => setEditing(null)}>
                ← Back
              </button>
            </div>

            <div>
              <div className="label mb-1">Name (snake_case)</div>
              <input
                className="input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="monthly_spending"
              />
            </div>
            <div>
              <div className="label mb-1">Description</div>
              <input
                className="input"
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="Total expenses in a given month, grouped by category."
              />
            </div>

            <div>
              <div className="label mb-1">Output kind</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEditing({ ...editing, kind: "sql_rows", config: null })}
                  className={`rounded-lg border px-3 py-2 text-xs text-left transition ${
                    editing.kind === "sql_rows"
                      ? "border-brand-accent bg-brand-50"
                      : "border-line"
                  }`}
                >
                  <div className="font-medium text-ink">Rows</div>
                  <div className="text-subink">Return data the agent reads.</div>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      kind: "sql_chart_png",
                      config: editing.config ?? { ...defaultChartConfig, title: editing.name || "" },
                    })
                  }
                  className={`rounded-lg border px-3 py-2 text-xs text-left transition ${
                    editing.kind === "sql_chart_png"
                      ? "border-brand-accent bg-brand-50"
                      : "border-line"
                  }`}
                >
                  <div className="font-medium text-ink">PNG chart</div>
                  <div className="text-subink">Render a chart image the agent attaches.</div>
                </button>
              </div>
            </div>

            {editing.kind === "sql_chart_png" && (
              <div className="rounded-lg border border-line p-3 bg-brand-50/40 flex flex-col gap-2">
                <div className="label">Chart config</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[11px] text-subink mb-1">Chart type</div>
                    <select
                      className="input text-sm"
                      value={editing.config?.chart_type ?? "bar"}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          config: {
                            ...(editing.config ?? defaultChartConfig),
                            chart_type: e.target.value as any,
                          },
                        })
                      }
                    >
                      <option value="bar">Bar</option>
                      <option value="line">Line</option>
                      <option value="area">Area</option>
                      <option value="pie">Pie</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-[11px] text-subink mb-1">Title</div>
                    <input
                      className="input text-sm"
                      value={editing.config?.title ?? ""}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          config: {
                            ...(editing.config ?? defaultChartConfig),
                            title: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-subink mb-1">X column (must be a column returned by the SELECT)</div>
                  <input
                    className="input text-sm"
                    value={editing.config?.x_column ?? ""}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        config: {
                          ...(editing.config ?? defaultChartConfig),
                          x_column: e.target.value,
                        },
                      })
                    }
                    placeholder="month"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-subink mb-1">Y columns (comma-separated)</div>
                  <input
                    className="input text-sm"
                    value={(editing.config?.y_columns ?? []).join(", ")}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        config: {
                          ...(editing.config ?? defaultChartConfig),
                          y_columns: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                    placeholder="amount_eur"
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="label">Parameters</div>
                <button className="text-xs text-brand-accent hover:underline" onClick={addParam}>
                  + Add parameter
                </button>
              </div>
              {editing.parameters.length === 0 && (
                <div className="text-xs text-subink">None — this is a static query.</div>
              )}
              <div className="flex flex-col gap-2">
                {editing.parameters.map((p, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <input
                      className="input flex-1"
                      placeholder="name"
                      value={p.name}
                      onChange={(e) => updateParam(i, { name: e.target.value })}
                    />
                    <select
                      className="input w-28"
                      value={p.type}
                      onChange={(e) => updateParam(i, { type: e.target.value })}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="date">date</option>
                    </select>
                    <input
                      className="input flex-[2]"
                      placeholder="description (what the agent should pass)"
                      value={p.description}
                      onChange={(e) => updateParam(i, { description: e.target.value })}
                    />
                    <button
                      className="text-subink hover:text-neg text-sm mt-2"
                      onClick={() => removeParam(i)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="label mb-1">SQL (SELECT / WITH only, :param placeholders)</div>
              <textarea
                className="input font-mono text-xs min-h-[180px]"
                value={editing.sql_template}
                onChange={(e) => setEditing({ ...editing, sql_template: e.target.value })}
                spellCheck={false}
              />
            </div>

            {err && <div className="text-xs text-neg">{err}</div>}

            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={busy || !editing.name || !editing.sql_template}>
                {busy ? "Saving…" : "Save tool"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
