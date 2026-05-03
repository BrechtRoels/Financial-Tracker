import { useState } from "react";
import MobileSheet from "./MobileSheet";
import Select from "../Select";
import { api } from "../../api/client";
import { useAccounts, useCategories, useMutateResource } from "../../api/hooks";
import { toCents, todayISO } from "../../lib/format";

type TxForm = {
  kind: "expense" | "income" | "transfer";
  account_id: number | "";
  to_account_id: number | "";
  category_id: number | "";
  amount: string;
  occurred_on: string;
  merchant: string;
  description: string;
};

const empty: TxForm = {
  kind: "expense",
  account_id: "",
  to_account_id: "",
  category_id: "",
  amount: "",
  occurred_on: todayISO(),
  merchant: "",
  description: "",
};

export default function AddTransactionSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const accounts = useAccounts();
  const categories = useCategories();
  const [form, setForm] = useState<TxForm>(empty);
  const [err, setErr] = useState<string | null>(null);

  const accountOptions = (accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }));
  const categoryOptionsForKind = (kind: "income" | "expense") =>
    (categories.data ?? [])
      .filter((c) => c.kind === kind)
      .map((c) => ({ value: c.id, label: c.name, swatch: c.color }));

  const create = useMutateResource(async (f: TxForm) => {
    const cents = toCents(parseFloat(f.amount));
    if (f.kind === "transfer") {
      return api.post("/transactions/transfer", {
        from_account_id: f.account_id,
        to_account_id: f.to_account_id,
        amount_cents: cents,
        occurred_on: f.occurred_on,
        description: f.description,
      });
    }
    const signed = f.kind === "expense" ? -Math.abs(cents) : Math.abs(cents);
    return api.post("/transactions", {
      account_id: f.account_id,
      category_id: f.category_id || null,
      amount_cents: signed,
      occurred_on: f.occurred_on,
      merchant: f.merchant.trim() || null,
      description: f.description,
    });
  }, ["transactions", "accounts", "budgets"]);

  async function submit() {
    setErr(null);
    try {
      await create.mutateAsync(form);
      setForm(empty);
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    }
  }

  function close() {
    setForm(empty);
    setErr(null);
    onClose();
  }

  const canSubmit =
    form.account_id &&
    form.amount &&
    (form.kind !== "transfer" || form.to_account_id);

  return (
    <MobileSheet open={open} onClose={close} title="New transaction">
      <div className="flex flex-col gap-4">
        <div className="inline-flex rounded-lg border border-line p-0.5 bg-brand-50/50 self-start">
          {(["expense", "income", "transfer"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setForm({ ...form, kind: k, category_id: "" })}
              className={`px-3 py-1.5 text-sm rounded-md capitalize transition ${
                form.kind === k ? "bg-surface shadow-soft text-ink" : "text-subink"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div>
          <div className="label mb-1 text-xs">Amount (EUR)</div>
          <input
            className="input text-2xl font-semibold tabular-nums h-14"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value.replace(",", ".") })}
            autoFocus
          />
        </div>

        <div>
          <div className="label mb-1">{form.kind === "transfer" ? "From account" : "Account"}</div>
          <Select
            value={form.account_id}
            onChange={(v) => setForm({ ...form, account_id: Number(v) })}
            options={accountOptions}
          />
        </div>

        {form.kind === "transfer" && (
          <div>
            <div className="label mb-1">To account</div>
            <Select
              value={form.to_account_id}
              onChange={(v) => setForm({ ...form, to_account_id: Number(v) })}
              options={accountOptions}
            />
          </div>
        )}

        {form.kind !== "transfer" && (
          <div>
            <div className="label mb-1">Category</div>
            <Select
              value={form.category_id}
              onChange={(v) => setForm({ ...form, category_id: v ? Number(v) : ("" as any) })}
              options={[{ value: "", label: "None" }, ...categoryOptionsForKind(form.kind)]}
              placeholder="None"
            />
          </div>
        )}

        <div>
          <div className="label mb-1">Date</div>
          <input
            className="input h-12"
            type="date"
            value={form.occurred_on}
            onChange={(e) => setForm({ ...form, occurred_on: e.target.value })}
          />
        </div>

        {form.kind !== "transfer" && (
          <div>
            <div className="label mb-1">Merchant / Place</div>
            <input
              className="input h-12"
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
              placeholder="e.g. Albert Heijn"
            />
          </div>
        )}

        <div>
          <div className="label mb-1">Description</div>
          <input
            className="input h-12"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        {err && <div className="text-xs text-neg">{err}</div>}

        <button
          className="btn-primary w-full h-12 mt-2"
          onClick={submit}
          disabled={!canSubmit || create.isPending}
        >
          {create.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </MobileSheet>
  );
}
