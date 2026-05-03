import { useEffect, useState } from "react";
import Modal from "./Modal";
import Select from "./Select";
import { api } from "../api/client";
import { useInvalidate } from "../api/hooks";
import type { Category } from "../api/types";

const PALETTE = [
  "#DBE4F0", "#E2E8F0", "#DDE4E0", "#E5E1DC",
  "#E0E4EA", "#D9E2EA", "#E8E2D5", "#DEE5E8",
  "#F4E4E4", "#E8DDED", "#E2EAD3", "#F4DECF",
];

const KIND_OPTIONS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  editing?: Category | null;
};

type FormState = {
  name: string;
  kind: "expense" | "income";
  color: string;
};

const empty: FormState = { name: "", kind: "expense", color: PALETTE[0] };

export default function CategoryModal({ open, onClose, editing }: Props) {
  const invalidate = useInvalidate();
  const [form, setForm] = useState<FormState>(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (editing) {
      setForm({
        name: editing.name,
        kind: (editing.kind as "expense" | "income") ?? "expense",
        color: editing.color || PALETTE[0],
      });
    } else {
      setForm(empty);
    }
  }, [open, editing]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        await api.patch(`/categories/${editing.id}`, {
          name: form.name.trim(),
          kind: form.kind,
          color: form.color,
        });
      } else {
        await api.post("/categories", {
          name: form.name.trim(),
          kind: form.kind,
          color: form.color,
        });
      }
      invalidate("categories", "transactions");
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirm(`Delete category "${editing.name}"? Transactions in it will become uncategorised.`)) return;
    setBusy(true);
    try {
      await api.delete(`/categories/${editing.id}`);
      invalidate("categories", "transactions");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : "New category"}>
      <div className="flex flex-col gap-3">
        <div>
          <div className="label mb-1">Name</div>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Groceries"
          />
        </div>

        <div>
          <div className="label mb-1">Kind</div>
          <Select
            value={form.kind}
            onChange={(v) => setForm({ ...form, kind: v as "expense" | "income" })}
            options={KIND_OPTIONS}
          />
        </div>

        <div>
          <div className="label mb-1">Colour</div>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className={`h-8 w-8 rounded-md border-2 transition ${
                  form.color === c ? "border-brand-accent" : "border-line"
                }`}
                style={{ background: c }}
                aria-label={`Pick ${c}`}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="label">Custom hex</span>
            <input
              className="input w-32 font-mono text-xs"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              placeholder="#1E3A5F"
            />
          </div>
        </div>

        {err && <div className="text-xs text-neg">{err}</div>}

        <div className="flex justify-between items-center pt-1">
          <div>
            {editing && (
              <button
                className="btn-ghost text-neg text-xs"
                onClick={remove}
                disabled={busy}
              >
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={save}
              disabled={busy || !form.name.trim()}
            >
              {busy ? "Saving…" : editing ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
