import { useRef, useState } from "react";
import MobileSheet from "./MobileSheet";
import Select from "../Select";
import { api } from "../../api/client";
import { useAccounts, useCategories, useMutateResource } from "../../api/hooks";
import { scanReceipt } from "../../api/receipts";
import { fromCents, toCents, todayISO } from "../../lib/format";

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

function CameraIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7h3l2-3h8l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

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
  const [scanning, setScanning] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  async function onScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setErr(null);
    setScanHint(null);
    try {
      const r = await scanReceipt(file);
      if (r.error) {
        setErr(
          r.error === "not_a_receipt"
            ? "That doesn't look like a receipt — try another photo."
            : "Couldn't read the receipt. Try a clearer photo."
        );
        return;
      }
      setForm((f) => ({
        ...f,
        kind: "expense",
        amount: r.total_amount_cents != null ? fromCents(r.total_amount_cents).toFixed(2) : f.amount,
        occurred_on: r.occurred_on ?? f.occurred_on,
        merchant: r.merchant ?? f.merchant,
        description: r.description ?? f.description,
        category_id: r.category_id ?? f.category_id,
      }));
      setScanHint(
        r.confidence != null
          ? `Filled from photo · ${Math.round(r.confidence * 100)}% confident`
          : "Filled from photo"
      );
    } catch (err: any) {
      setErr(err.response?.data?.detail ?? err.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }

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
    setScanHint(null);
    onClose();
  }

  const canSubmit =
    form.account_id &&
    form.amount &&
    (form.kind !== "transfer" || form.to_account_id);

  return (
    <MobileSheet open={open} onClose={close} title="New transaction">
      <div className="flex flex-col gap-4">
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={onScanFile}
        />
        <button
          type="button"
          onClick={() => scanInputRef.current?.click()}
          disabled={scanning}
          className="h-12 rounded-xl border border-dashed border-brand-accent/40 text-brand-accent flex items-center justify-center gap-2 active:bg-brand-50"
        >
          {scanning ? (
            <>
              <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-brand-accent border-t-transparent animate-spin" />
              <span className="text-sm">Reading receipt…</span>
            </>
          ) : (
            <>
              <CameraIcon />
              <span className="text-sm font-medium">Scan receipt</span>
            </>
          )}
        </button>
        {scanHint && <div className="text-xs text-pos -mt-2">{scanHint}</div>}

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
