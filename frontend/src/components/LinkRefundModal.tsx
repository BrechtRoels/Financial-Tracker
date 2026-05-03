import { useEffect, useState } from "react";
import Modal from "./Modal";
import { api } from "../api/client";
import { useAccounts, useCategories, useInvalidate } from "../api/hooks";
import type { RefundCandidate, Transaction } from "../api/types";
import { formatDate, formatEUR } from "../lib/format";

type Props = {
  open: boolean;
  onClose: () => void;
  refund: Transaction | null;
};

export default function LinkRefundModal({ open, onClose, refund }: Props) {
  const accounts = useAccounts();
  const categories = useCategories();
  const invalidate = useInvalidate();
  const [candidates, setCandidates] = useState<RefundCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [allExpenses, setAllExpenses] = useState(false);

  useEffect(() => {
    if (!open || !refund) {
      setCandidates([]);
      setSearch("");
      setAllExpenses(false);
      return;
    }
    setErr(null);
    setLoading(true);
    const handle = setTimeout(() => {
      const params: Record<string, string> = {};
      if (search.trim()) params.q = search.trim();
      if (allExpenses) params.all_expenses = "true";
      api
        .get<RefundCandidate[]>(`/transactions/${refund.id}/refund-candidates`, { params })
        .then((r) => setCandidates(r.data))
        .catch((e) =>
          setErr(e.response?.data?.detail ?? e.message ?? "Failed to load candidates")
        )
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [open, refund, search, allExpenses]);

  async function link(expenseId: number) {
    if (!refund) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/transactions/${refund.id}/link-refund`, { expense_id: expenseId });
      invalidate("transactions", "anomalies");
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Link failed");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!refund) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/transactions/${refund.id}/unlink-refund`);
      invalidate("transactions", "anomalies");
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Unlink failed");
    } finally {
      setBusy(false);
    }
  }

  const accMap = Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a]));
  const catMap = Object.fromEntries((categories.data ?? []).map((c) => [c.id, c]));

  return (
    <Modal open={open} onClose={onClose} title="Link refund to expense">
      <div className="flex flex-col gap-3">
        {refund && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200/70 px-3 py-2 text-xs leading-relaxed">
            <span className="font-semibold">Refund · {formatEUR(refund.amount_cents)}</span>
            {" · "}
            {refund.merchant || refund.counterparty_name || refund.description || "—"}
            {" · "}
            <span className="text-subink">{formatDate(refund.occurred_on)}</span>
          </div>
        )}

        <p className="text-xs text-subink">
          Link this refund to the original expense so the refund inherits its category and the
          category total nets out.
        </p>

        <input
          type="search"
          placeholder="Search merchant or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input"
        />

        <label className="flex items-center gap-2 text-xs text-subink">
          <input
            type="checkbox"
            checked={allExpenses}
            onChange={(e) => setAllExpenses(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand-accent"
          />
          Show all expenses (drop date / amount filter — useful for friend paybacks)
        </label>

        {loading && <div className="text-xs text-subink py-4">Searching…</div>}

        {!loading && candidates.length === 0 && (
          <div className="text-xs text-subink py-4">
            {search.trim() || allExpenses
              ? "No expenses match."
              : "No matching expenses found within ±60 days at 50–150% of the refund amount. Try the search field or tick \"Show all expenses\"."}
          </div>
        )}

        {candidates.length > 0 && (
          <ul className="flex flex-col divide-y divide-line max-h-[360px] overflow-auto">
            {candidates.map((c) => {
              const cat = c.category_id ? catMap[c.category_id] : null;
              const acc = accMap[c.account_id];
              return (
                <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {c.merchant || c.description || "—"}
                    </div>
                    <div className="text-[11px] text-subink">
                      {formatDate(c.occurred_on)} · {acc?.name ?? "?"}
                      {cat && (
                        <span
                          className="chip ml-2 px-1.5 py-0 text-[10px]"
                          style={{ background: cat.color }}
                        >
                          {cat.name}
                        </span>
                      )}
                      {" · "}
                      {c.days_apart === 0
                        ? "same day"
                        : `${c.days_apart}d apart`}
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <div className="text-sm tabular-nums text-neg font-medium">
                      {formatEUR(c.amount_cents)}
                    </div>
                    <button
                      className="btn-primary text-xs"
                      onClick={() => link(c.id)}
                      disabled={busy}
                    >
                      Link
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {err && <div className="text-xs text-neg">{err}</div>}

        <div className="flex justify-between items-center pt-2">
          {refund?.refund_for_id ? (
            <button className="btn-ghost text-xs text-neg" onClick={unlink} disabled={busy}>
              Unlink (currently linked to #{refund.refund_for_id})
            </button>
          ) : (
            <span />
          )}
          <button className="btn-ghost text-xs" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
