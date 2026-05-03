import { useEffect, useState } from "react";
import Modal from "./Modal";
import Select from "./Select";
import { createGoal, deleteGoal, updateGoal } from "../api/goals";
import { useAccounts } from "../api/hooks";
import type { SavingsGoal } from "../api/types";
import { fromCents, toCents } from "../lib/format";

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: SavingsGoal | null;
};

type FormState = {
  name: string;
  target: string;
  target_date: string;
  account_id: string; // "" = net worth
};

const emptyForm: FormState = {
  name: "",
  target: "",
  target_date: "",
  account_id: "",
};

export default function GoalModal({ open, onClose, onSaved, editing }: Props) {
  const accounts = useAccounts();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (editing) {
      setForm({
        name: editing.name,
        target: fromCents(editing.target_cents).toFixed(2),
        target_date: editing.target_date ?? "",
        account_id: editing.account_id != null ? String(editing.account_id) : "",
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, editing]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        name: form.name.trim(),
        target_cents: toCents(parseFloat(form.target || "0")),
        target_date: form.target_date || null,
        account_id: form.account_id ? Number(form.account_id) : null,
      };
      if (editing) await updateGoal(editing.id, payload);
      else await createGoal(payload);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirm(`Delete goal "${editing.name}"?`)) return;
    setBusy(true);
    try {
      await deleteGoal(editing.id);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = [
    { value: "", label: "All accounts (net worth)" },
    ...(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name })),
  ];

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit goal` : "New goal"}>
      <div className="flex flex-col gap-3">
        <div>
          <div className="label mb-1">Name</div>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Emergency fund"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label mb-1">Target (EUR)</div>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
            />
          </div>
          <div>
            <div className="label mb-1">Target date (optional)</div>
            <input
              className="input"
              type="date"
              value={form.target_date}
              onChange={(e) => setForm({ ...form, target_date: e.target.value })}
            />
          </div>
        </div>
        <div>
          <div className="label mb-1">Tracked by</div>
          <Select
            value={form.account_id}
            onChange={(v) => setForm({ ...form, account_id: v })}
            options={accountOptions}
          />
          <div className="mt-1 text-xs text-subink">
            Pick an account to track its balance, or "All accounts" to track net worth.
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
              disabled={busy || !form.name.trim() || !parseFloat(form.target || "0")}
            >
              {busy ? "Saving…" : editing ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
