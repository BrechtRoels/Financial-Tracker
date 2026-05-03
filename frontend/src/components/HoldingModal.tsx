import { useEffect, useState } from "react";
import Modal from "./Modal";
import Select from "./Select";
import { useHoldings, useInvalidate, useAccounts } from "../api/hooks";
import {
  createHolding,
  deleteHolding,
  getQuote,
  updateHolding,
} from "../api/investments";
import type { Holding } from "../api/types";
import { fromCents, toCents } from "../lib/format";

type Props = {
  open: boolean;
  onClose: () => void;
  editing?: Holding | null;
  defaultAccountId?: number | null;
};

type FormState = {
  account_id: string;
  symbol: string;
  shares: string;
  cost_basis: string; // EUR string
  notes: string;
};

const empty: FormState = {
  account_id: "",
  symbol: "",
  shares: "",
  cost_basis: "",
  notes: "",
};

export default function HoldingModal({ open, onClose, editing, defaultAccountId }: Props) {
  const accounts = useAccounts();
  const holdings = useHoldings();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<FormState>(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    price: number;
    currency: string;
    long_name?: string | null;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const investmentAccounts = (accounts.data ?? []).filter((a) => a.type === "investment");

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setPreview(null);
    if (editing) {
      setForm({
        account_id: String(editing.account_id),
        symbol: editing.symbol,
        shares: String(editing.shares),
        cost_basis: fromCents(editing.cost_basis_cents).toFixed(2),
        notes: editing.notes ?? "",
      });
    } else {
      setForm({
        ...empty,
        account_id: defaultAccountId
          ? String(defaultAccountId)
          : investmentAccounts[0]
          ? String(investmentAccounts[0].id)
          : "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  async function checkSymbol() {
    if (!form.symbol.trim()) return;
    setPreviewBusy(true);
    setErr(null);
    try {
      const q = await getQuote(form.symbol.trim());
      setPreview({ price: q.price, currency: q.currency, long_name: q.long_name });
    } catch (e: any) {
      setPreview(null);
      setErr(e.response?.data?.detail ?? "Unknown symbol — check the Yahoo ticker");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const payload = {
        account_id: Number(form.account_id),
        symbol: form.symbol.trim().toUpperCase(),
        shares: parseFloat(form.shares || "0"),
        cost_basis_cents: toCents(parseFloat(form.cost_basis || "0")),
        notes: form.notes.trim() || null,
      };
      if (editing) await updateHolding(editing.id, payload);
      else await createHolding(payload);
      invalidate("holdings", "accounts");
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirm(`Delete holding ${editing.symbol}?`)) return;
    setBusy(true);
    try {
      await deleteHolding(editing.id);
      invalidate("holdings", "accounts");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = investmentAccounts.map((a) => ({
    value: String(a.id),
    label: a.name,
  }));

  const tickerCount = (holdings.data ?? []).filter((h) => h.account_id === Number(form.account_id))
    .length;

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${editing.symbol}` : "Add holding"}>
      <div className="flex flex-col gap-3">
        <div>
          <div className="label mb-1">Investment account</div>
          {accountOptions.length === 0 ? (
            <div className="text-xs text-neg">
              No investment-type account yet. Create one first.
            </div>
          ) : (
            <Select
              value={form.account_id}
              onChange={(v) => setForm({ ...form, account_id: v })}
              options={accountOptions}
            />
          )}
          {form.account_id && (
            <div className="mt-1 text-[11px] text-subink">
              {tickerCount} holding{tickerCount === 1 ? "" : "s"} in this account
            </div>
          )}
        </div>

        <div>
          <div className="label mb-1">Yahoo Finance symbol</div>
          <div className="flex gap-2">
            <input
              className="input flex-1 font-mono uppercase"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
              placeholder="AAPL · ASML.AS · BMW.DE · BRK-B"
              onBlur={checkSymbol}
            />
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={checkSymbol}
              disabled={previewBusy || !form.symbol.trim()}
            >
              {previewBusy ? "…" : "Check"}
            </button>
          </div>
          {preview && (
            <div className="mt-1.5 text-xs text-subink">
              <span className="font-medium text-ink">{preview.long_name || form.symbol}</span> ·{" "}
              <span className="tabular-nums">
                {preview.price.toLocaleString()} {preview.currency}
              </span>
              {preview.currency !== "EUR" && (
                <span className="ml-1 text-amber-700">(non-EUR — see hint below)</span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label mb-1">Shares</div>
            <input
              className="input"
              type="number"
              step="0.0001"
              min="0"
              value={form.shares}
              onChange={(e) => setForm({ ...form, shares: e.target.value })}
            />
          </div>
          <div>
            <div className="label mb-1">Cost basis (EUR)</div>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={form.cost_basis}
              onChange={(e) => setForm({ ...form, cost_basis: e.target.value })}
              placeholder="Total amount you paid"
            />
          </div>
        </div>

        <div>
          <div className="label mb-1">Notes (optional)</div>
          <input
            className="input"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        {preview && preview.currency !== "EUR" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Yahoo reports this ticker in <strong>{preview.currency}</strong>. The dashboard treats
            holdings nominally — use the EUR-denominated ticker (e.g. <code>ASML.AS</code> for ASML
            in Amsterdam) if you want a clean total.
          </div>
        )}

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
              disabled={
                busy ||
                !form.account_id ||
                !form.symbol.trim() ||
                !parseFloat(form.shares || "0")
              }
            >
              {busy ? "Saving…" : editing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
