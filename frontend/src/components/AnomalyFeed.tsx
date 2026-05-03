import { useState } from "react";
import EditTransactionModal from "./EditTransactionModal";
import LinkRefundModal from "./LinkRefundModal";
import { useAnomalies, useTransactions } from "../api/hooks";
import type { Anomaly, Severity, Transaction } from "../api/types";

const SEV_STYLES: Record<Severity, { bg: string; text: string; label: string }> = {
  danger: { bg: "bg-red-50", text: "text-red-700", label: "alert" },
  warn: { bg: "bg-amber-50", text: "text-amber-700", label: "watch" },
  good: { bg: "bg-emerald-50", text: "text-emerald-700", label: "good" },
  neutral: { bg: "bg-brand-50", text: "text-subink", label: "info" },
};

function iconFor(kind: Anomaly["kind"]) {
  if (kind === "category_zscore") {
    // Spike / arrow up
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="15 7 21 7 21 13" />
      </svg>
    );
  }
  if (kind === "new_merchant_large") {
    // Sparkle
    return (
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="M5.5 5.5l2 2" />
        <path d="M16.5 16.5l2 2" />
      </svg>
    );
  }
  // recurring_jump → repeat arrows
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export default function AnomalyFeed() {
  const { data, isLoading } = useAnomalies();
  const items = data ?? [];
  const txs = useTransactions({ limit: 500 });
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [refundLinking, setRefundLinking] = useState<Transaction | null>(null);

  function openTx(id: number | null) {
    if (id == null) return;
    const t = (txs.data ?? []).find((x) => x.id === id);
    if (t) setEditing(t);
  }

  function openLinkRefund(id: number | null) {
    if (id == null) return;
    const t = (txs.data ?? []).find((x) => x.id === id);
    if (t) setRefundLinking(t);
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-medium">What's unusual</div>
        {items.length > 0 && (
          <div className="text-xs text-subink">{items.length} item{items.length === 1 ? "" : "s"}</div>
        )}
      </div>

      {isLoading && <div className="text-xs text-subink py-6">Scanning…</div>}

      {!isLoading && items.length === 0 && (
        <div className="text-xs text-subink py-6 flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Nothing unusual this week.
        </div>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {items.map((a, i) => {
          const s = SEV_STYLES[a.severity];
          return (
            <li key={i} className="py-2.5 flex items-start gap-3">
              <span className={`shrink-0 h-7 w-7 rounded-lg ${s.bg} ${s.text} flex items-center justify-center`}>
                {iconFor(a.kind)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium truncate">{a.headline}</div>
                  <span className={`chip text-[10px] ${s.bg} ${s.text} px-1.5 py-0.5`}>
                    {s.label}
                  </span>
                </div>
                <div className="text-xs text-subink mt-0.5 leading-relaxed">{a.message}</div>
                {a.transaction_id != null && (
                  <div className="mt-1 flex items-center gap-3 text-[11px]">
                    <button
                      type="button"
                      className="text-brand-accent hover:underline"
                      onClick={() => openTx(a.transaction_id)}
                    >
                      view transaction →
                    </button>
                    {a.kind === "refund_candidate" && (
                      <button
                        type="button"
                        className="text-emerald-700 hover:underline font-medium"
                        onClick={() => openLinkRefund(a.transaction_id)}
                      >
                        link to expense →
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <EditTransactionModal
        open={editing != null}
        onClose={() => setEditing(null)}
        transaction={editing}
      />

      <LinkRefundModal
        open={refundLinking != null}
        onClose={() => setRefundLinking(null)}
        refund={refundLinking}
      />
    </div>
  );
}
