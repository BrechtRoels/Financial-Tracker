import { useEffect, useMemo, useRef, useState } from "react";
import EditTransactionModal from "../components/EditTransactionModal";
import LinkRefundModal from "../components/LinkRefundModal";
import Modal from "../components/Modal";
import Select from "../components/Select";
import ProgressBar from "../components/ProgressBar";
import { API_BASE_URL, api, getToken } from "../api/client";
import { useAccounts, useCategories, useInvalidate, useMutateResource, useTransactions } from "../api/hooks";
import { scanReceipt } from "../api/receipts";
import { useMe } from "../hooks/useAuth";
import type { Transaction } from "../api/types";
import { formatDate, formatEUR, fromCents, toCents, todayISO } from "../lib/format";

const REFUND_CATEGORY_RE = /refund|payback|reimburs|repaid|paid back/i;

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

export default function Transactions() {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [form, setForm] = useState<TxForm>(empty);
  const [filter, setFilter] = useState<{ account_id?: number; category_id?: number }>({});
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [linkingTx, setLinkingTx] = useState<Transaction | null>(null);

  async function onScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    setScanError(null);
    setScanHint(null);
    try {
      const r = await scanReceipt(file);
      if (r.error) {
        setScanError(
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
          ? `Filled from photo · confidence ${Math.round(r.confidence * 100)}%`
          : "Filled from photo"
      );
    } catch (err: any) {
      setScanError(err.response?.data?.detail ?? err.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  const accounts = useAccounts();
  const categories = useCategories();
  const txs = useTransactions(filter);
  const me = useMe();

  // Prefill the new-transaction form's account from the user's chosen default.
  // Resets each time the modal opens.
  useEffect(() => {
    if (!open || editing) return;
    const fallback = me.data?.default_account_id ?? accounts.data?.[0]?.id ?? "";
    setForm((f) => (f.account_id === "" ? { ...f, account_id: fallback as any } : f));
  }, [open, editing, me.data?.default_account_id, accounts.data]);

  const accountMap = useMemo(
    () => Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data]
  );
  const catMap = useMemo(
    () => Object.fromEntries((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data]
  );

  const accountOptions = (accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }));
  const categoryOptions = (categories.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
    swatch: c.color,
  }));
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

  const del = useMutateResource(
    (id: number) => api.delete(`/transactions/${id}`).then((r) => r.data),
    ["transactions", "accounts", "budgets"]
  );

  async function submit() {
    const resp: any = await create.mutateAsync(form);
    const newTx = (resp?.data ?? resp) as Transaction | undefined;
    const pickedCat = form.category_id
      ? (categories.data ?? []).find((c) => c.id === Number(form.category_id))
      : null;
    setOpen(false);
    setForm(empty);
    setScanHint(null);
    setScanError(null);

    if (
      newTx?.id &&
      newTx.amount_cents > 0 &&
      pickedCat &&
      REFUND_CATEGORY_RE.test(pickedCat.name)
    ) {
      setLinkingTx(newTx);
    }
  }

  function closeAddModal() {
    setOpen(false);
    setScanHint(null);
    setScanError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Transactions</h1>
          <p className="text-sm text-subink">Record income, expenses and transfers.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setImportOpen(true)}>
            Import CSV
          </button>
          <button className="btn-primary" onClick={() => setOpen(true)}>
            + Add
          </button>
        </div>
      </header>

      <div className="card flex flex-wrap gap-3 items-end">
        <div className="min-w-[180px]">
          <div className="label mb-1">Account</div>
          <Select
            value={filter.account_id ?? ""}
            onChange={(v) => setFilter({ ...filter, account_id: v ? Number(v) : undefined })}
            options={[{ value: "", label: "All accounts" }, ...accountOptions]}
            placeholder="All accounts"
          />
        </div>
        <div className="min-w-[180px]">
          <div className="label mb-1">Category</div>
          <Select
            value={filter.category_id ?? ""}
            onChange={(v) => setFilter({ ...filter, category_id: v ? Number(v) : undefined })}
            options={[{ value: "", label: "All categories" }, ...categoryOptions]}
            placeholder="All categories"
          />
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-subink bg-brand-50/50">
              <th className="px-6 py-3 font-medium uppercase text-xs tracking-wide">Date</th>
              <th className="px-6 py-3 font-medium uppercase text-xs tracking-wide">Merchant</th>
              <th className="px-6 py-3 font-medium uppercase text-xs tracking-wide">Description</th>
              <th className="px-6 py-3 font-medium uppercase text-xs tracking-wide">Category</th>
              <th className="px-6 py-3 font-medium uppercase text-xs tracking-wide">Account</th>
              <th className="px-6 py-3 font-medium uppercase text-xs tracking-wide text-right">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(txs.data ?? []).map((t) => {
              const cat = t.category_id ? catMap[t.category_id] : null;
              const acc = accountMap[t.account_id];
              return (
                <tr key={t.id} className="table-row">
                  <td className="px-6 py-3 tabular-nums">{formatDate(t.occurred_on)}</td>
                  <td className="px-6 py-3 font-medium">
                    {t.merchant || <span className="text-subink italic">—</span>}
                  </td>
                  <td className="px-6 py-3">
                    {t.description || <span className="text-subink italic">—</span>}
                    {t.transfer_group_id && (
                      <span className="chip ml-2 bg-tag-mist">transfer</span>
                    )}
                    {t.refund_for_id && (
                      <span
                        className="chip ml-2 bg-emerald-50 text-emerald-700"
                        title={`Linked refund of transaction #${t.refund_for_id}`}
                      >
                        ↻ refund of #{t.refund_for_id}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    {cat ? (
                      <span className="chip" style={{ background: cat.color }}>
                        {cat.name}
                      </span>
                    ) : (
                      <span className="text-subink">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3">{acc?.name ?? "—"}</td>
                  <td
                    className={`px-6 py-3 text-right font-medium tabular-nums ${
                      t.amount_cents < 0 ? "text-neg" : "text-pos"
                    }`}
                  >
                    {formatEUR(t.amount_cents)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="text-subink hover:text-brand-accent text-xs px-1.5"
                        onClick={() => setEditing(t)}
                        aria-label="Edit"
                        title="Edit"
                      >
                        edit
                      </button>
                      <button
                        className="text-subink hover:text-neg px-1.5"
                        onClick={() => del.mutate(t.id)}
                        aria-label="Delete"
                        title="Delete"
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!txs.data?.length && (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-subink">
                  No transactions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={closeAddModal} title="New transaction">
        <div className="flex flex-col gap-3">
          <input
            ref={scanInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onScanFile}
          />
          <button
            type="button"
            onClick={() => scanInputRef.current?.click()}
            disabled={scanning}
            className="btn-ghost w-full justify-center gap-2 border border-dashed border-brand-accent/40 text-brand-accent hover:bg-brand-50"
          >
            {scanning ? (
              <>
                <span className="inline-block h-3 w-3 rounded-full border-2 border-brand-accent border-t-transparent animate-spin" />
                Reading receipt…
              </>
            ) : (
              <>📷 Scan receipt</>
            )}
          </button>
          {scanHint && <div className="text-xs text-pos">{scanHint}</div>}
          {scanError && <div className="text-xs text-neg">{scanError}</div>}

          <div className="inline-flex rounded-lg border border-line p-0.5 bg-brand-50/50 self-start">
            {(["expense", "income", "transfer"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setForm({ ...form, kind: k })}
                className={`px-3 py-1.5 text-sm rounded-md capitalize transition ${
                  form.kind === k ? "bg-surface shadow-soft text-ink" : "text-subink"
                }`}
              >
                {k}
              </button>
            ))}
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
                onChange={(v) => setForm({ ...form, category_id: v ? Number(v) : "" as any })}
                options={[{ value: "", label: "None" }, ...categoryOptionsForKind(form.kind)]}
                placeholder="None"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="label mb-1">Amount (EUR)</div>
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <div className="label mb-1">Date</div>
              <input
                className="input"
                type="date"
                value={form.occurred_on}
                onChange={(e) => setForm({ ...form, occurred_on: e.target.value })}
              />
            </div>
          </div>
          {form.kind !== "transfer" && (
            <div>
              <div className="label mb-1">Merchant / Place</div>
              <input
                className="input"
                value={form.merchant}
                onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                placeholder="e.g. Albert Heijn, TC Logan"
              />
            </div>
          )}
          <div>
            <div className="label mb-1">Description</div>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <button
            className="btn-primary mt-2"
            onClick={submit}
            disabled={!form.account_id || !form.amount}
          >
            Save
          </button>
        </div>
      </Modal>

      <ImportCSVModal open={importOpen} onClose={() => setImportOpen(false)} />

      <EditTransactionModal
        open={editing != null}
        onClose={() => setEditing(null)}
        transaction={editing}
      />

      <LinkRefundModal
        open={linkingTx != null}
        onClose={() => setLinkingTx(null)}
        refund={linkingTx}
      />
    </div>
  );
}

type ImportProgress = {
  stage: string;
  label: string;
  done?: number;
  total?: number;
  percent?: number;
};

function ImportCSVModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accounts = useAccounts();
  const invalidate = useInvalidate();
  const [accountId, setAccountId] = useState<number | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [useAI, setUseAI] = useState(true);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [errCanRetry, setErrCanRetry] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);

  async function forgetAndRetry() {
    if (!accountId) return;
    setBusy(true);
    try {
      await api.post(`/transactions/forget-imports?account_id=${accountId}`);
      setErr("");
      setErrCanRetry(false);
      await upload();
    } catch (e: any) {
      setErr(e.message ?? "Failed to clear import history");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!file || !accountId) return;
    setBusy(true);
    setMsg("");
    setErr("");
    setErrCanRetry(false);
    setProgress({ stage: "uploading", label: "Uploading file…" });

    const fd = new FormData();
    fd.append("file", file);
    fd.append("account_id", String(accountId));
    fd.append("use_ai", String(useAI));

    try {
      const resp = await fetch(`${API_BASE_URL}/transactions/import-csv`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        body: fd,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalEvent: any = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          switch (ev.stage) {
            case "parsing":
              setProgress({ stage: "parsing", label: "Reading CSV…" });
              break;
            case "parsed":
              setProgress({
                stage: "parsed",
                label: `Parsed ${ev.total} rows${ev.duplicates ? ` · ${ev.duplicates} duplicates` : ""}${ev.skipped ? ` · ${ev.skipped} malformed` : ""}`,
                percent: 10,
              });
              break;
            case "ai_unavailable":
              setProgress({
                stage: "ai_unavailable",
                label: "AI key not configured — skipping enrichment",
                percent: 20,
              });
              break;
            case "ai_start":
              setProgress({
                stage: "ai",
                label: `Enriching with AI (0 / ${ev.total})…`,
                done: 0,
                total: ev.total,
                percent: 20,
              });
              break;
            case "ai_progress": {
              const pct = 20 + (ev.done / ev.total) * 70;
              setProgress({
                stage: "ai",
                label: `Enriching with AI (${ev.done} / ${ev.total})…`,
                done: ev.done,
                total: ev.total,
                percent: pct,
              });
              break;
            }
            case "saving":
              setProgress({ stage: "saving", label: `Saving ${ev.total} transactions…`, percent: 95 });
              break;
            case "done":
              finalEvent = ev;
              setProgress({ stage: "done", label: "Complete", percent: 100 });
              break;
            case "error": {
              const detail = ev.detail ?? "Import failed";
              setErr(detail);
              setErrCanRetry(/already imported/i.test(detail));
              return;
            }
          }
        }
      }

      if (finalEvent) {
        const {
          imported,
          duplicates,
          skipped,
          transfers_detected,
          format,
          ai_enriched,
          ai_requested,
          ai_available,
        } = finalEvent;
        const parts = [`Imported ${imported} rows`];
        if (transfers_detected) parts.push(`${transfers_detected} transfers detected`);
        if (duplicates) parts.push(`${duplicates} duplicates skipped`);
        if (skipped) parts.push(`${skipped} malformed`);
        if (format) parts.push(`(${format})`);
        if (ai_requested && !ai_available) parts.push("AI unavailable");
        else if (ai_enriched) parts.push("AI enriched");
        else if (ai_requested) parts.push("AI returned nothing");
        setMsg(parts.join(" · "));
        invalidate("transactions", "accounts");
      }
    } catch (e: any) {
      setErr(e.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = (accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }));

  return (
    <Modal open={open} onClose={onClose} title="Import CSV">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-subink">
          Supports <strong>KBC exports</strong> (semicolon-separated, with <code>Datum</code> and{" "}
          <code>Bedrag</code> columns) and <strong>generic CSV</strong> with{" "}
          <code>date</code>, <code>amount</code>, optional <code>description</code> and{" "}
          <code>category</code>. Positive = income, negative = expense.
        </p>
        <div>
          <div className="label mb-1">Account</div>
          <Select
            value={accountId}
            onChange={(v) => setAccountId(Number(v))}
            options={accountOptions}
          />
        </div>
        <div>
          <div className="label mb-1">File</div>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </div>
        <label className="flex items-start gap-3 p-3 rounded-lg border border-line bg-brand-50/40 cursor-pointer hover:bg-brand-50">
          <input
            type="checkbox"
            checked={useAI}
            onChange={(e) => setUseAI(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-accent"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">Clean & categorize with AI</span>
            <span className="block text-xs text-subink mt-0.5">
              Uses AI to rewrite descriptions (e.g. counterparty name) and auto-assign
              categories. Falls back silently if unavailable.
            </span>
          </span>
        </label>
        {progress && busy && (
          <div className="rounded-lg border border-line bg-brand-50/40 p-3">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-ink font-medium">{progress.label}</span>
              {progress.percent !== undefined && (
                <span className="text-subink tabular-nums">{Math.round(progress.percent)}%</span>
              )}
            </div>
            <ProgressBar value={progress.percent ?? 0} color="#1E3A5F" />
          </div>
        )}
        {msg && <div className="text-sm text-pos">{msg}</div>}
        {err && (
          <div className="text-sm text-neg">
            {err}
            {errCanRetry && (
              <button
                type="button"
                className="ml-2 underline hover:text-ink disabled:opacity-50"
                onClick={forgetAndRetry}
                disabled={busy}
              >
                Re-import anyway
              </button>
            )}
          </div>
        )}
        <button
          className="btn-primary mt-2"
          onClick={upload}
          disabled={!file || !accountId || busy}
        >
          {busy ? "Importing…" : "Upload"}
        </button>
      </div>
    </Modal>
  );
}
