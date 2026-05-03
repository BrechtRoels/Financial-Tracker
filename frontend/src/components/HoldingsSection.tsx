import { useState } from "react";
import AccountLogo from "./AccountLogo";
import CashFlowModal from "./CashFlowModal";
import HoldingModal from "./HoldingModal";
import { useAccounts, useHoldings } from "../api/hooks";
import type { Holding } from "../api/types";
import { formatEUR } from "../lib/format";

function fmtPrice(price: number, currency: string): string {
  return `${price.toLocaleString("nl-BE", { maximumFractionDigits: 2 })} ${currency}`;
}

export default function HoldingsSection() {
  const accounts = useAccounts();
  const holdings = useHoldings();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [defaultAccount, setDefaultAccount] = useState<number | null>(null);
  const [cashFor, setCashFor] = useState<{ id: number; name: string } | null>(null);

  const investmentAccounts = (accounts.data ?? []).filter((a) => a.type === "investment");
  if (investmentAccounts.length === 0) return null;

  const byAccount: Record<number, Holding[]> = {};
  for (const h of holdings.data ?? []) {
    (byAccount[h.account_id] ||= []).push(h);
  }

  function openAdd(accountId: number) {
    setEditing(null);
    setDefaultAccount(accountId);
    setModalOpen(true);
  }

  function openEdit(h: Holding) {
    setEditing(h);
    setDefaultAccount(null);
    setModalOpen(true);
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-subink mb-3 uppercase tracking-wide">
        Holdings
      </h2>
      <div className="flex flex-col gap-3">
        {investmentAccounts.map((acc) => {
          const accHoldings = byAccount[acc.id] ?? [];
          const totalMarket = accHoldings.reduce((s, h) => s + h.market_value_cents, 0);
          const totalCost = accHoldings.reduce((s, h) => s + h.cost_basis_cents, 0);
          const totalPnl = totalMarket - totalCost;
          const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : null;
          const cashCents = acc.balance_cents - acc.holdings_value_cents;

          return (
            <div key={acc.id} className="card p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-line gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <AccountLogo logoUrl={acc.logo_url} name={acc.name} size={36} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{acc.name}</div>
                    <div className="text-xs text-subink">
                      {accHoldings.length} holding{accHoldings.length === 1 ? "" : "s"} · cash{" "}
                      {formatEUR(cashCents)} · holdings {formatEUR(totalMarket)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatEUR(acc.balance_cents)}
                    </div>
                    {totalPnlPct !== null && (
                      <div
                        className={`text-[11px] tabular-nums ${
                          totalPnl >= 0 ? "text-pos" : "text-neg"
                        }`}
                      >
                        {totalPnl >= 0 ? "+" : ""}
                        {formatEUR(totalPnl)} ({totalPnlPct.toFixed(1)}%)
                      </div>
                    )}
                  </div>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => setCashFor({ id: acc.id, name: acc.name })}
                  >
                    + Cash
                  </button>
                  <button className="btn-primary text-xs" onClick={() => openAdd(acc.id)}>
                    + Holding
                  </button>
                </div>
              </div>

              {accHoldings.length === 0 && cashCents === 0 ? (
                <div className="px-5 py-4 text-xs text-subink">
                  No holdings or cash yet. Click <span className="font-medium">+ Holding</span> to track a stock or <span className="font-medium">+ Cash</span> to record a deposit.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-subink bg-brand-50/40">
                      <th className="px-5 py-2 font-medium uppercase text-[11px] tracking-wide">
                        Symbol
                      </th>
                      <th className="px-5 py-2 font-medium uppercase text-[11px] tracking-wide">
                        Name
                      </th>
                      <th className="px-5 py-2 font-medium uppercase text-[11px] tracking-wide text-right">
                        Shares
                      </th>
                      <th className="px-5 py-2 font-medium uppercase text-[11px] tracking-wide text-right">
                        Price
                      </th>
                      <th className="px-5 py-2 font-medium uppercase text-[11px] tracking-wide text-right">
                        Value
                      </th>
                      <th className="px-5 py-2 font-medium uppercase text-[11px] tracking-wide text-right">
                        Cost
                      </th>
                      <th className="px-5 py-2 font-medium uppercase text-[11px] tracking-wide text-right">
                        P/L
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashCents !== 0 && (
                      <tr className="border-t border-line bg-brand-50/30">
                        <td className="px-5 py-2 font-mono text-xs">CASH</td>
                        <td className="px-5 py-2 text-subink italic">Uninvested cash</td>
                        <td className="px-5 py-2 text-right tabular-nums text-subink">—</td>
                        <td className="px-5 py-2 text-right tabular-nums text-subink">—</td>
                        <td className="px-5 py-2 text-right font-medium tabular-nums">
                          {formatEUR(cashCents)}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums text-subink">—</td>
                        <td className="px-5 py-2 text-right tabular-nums text-subink">—</td>
                        <td></td>
                      </tr>
                    )}
                    {accHoldings.map((h) => (
                      <tr key={h.id} className="border-t border-line hover:bg-brand-50/40">
                        <td className="px-5 py-2 font-mono text-xs">{h.symbol}</td>
                        <td className="px-5 py-2 truncate max-w-[220px]">
                          <span className="text-ink">{h.name ?? "—"}</span>
                          {h.last_currency && h.last_currency !== "EUR" && (
                            <span className="ml-2 text-[10px] text-amber-700">
                              ({h.last_currency})
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums">
                          {h.shares.toLocaleString("nl-BE", { maximumFractionDigits: 4 })}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums">
                          {h.last_price !== null && h.last_currency
                            ? fmtPrice(h.last_price, h.last_currency)
                            : "—"}
                        </td>
                        <td className="px-5 py-2 text-right font-medium tabular-nums">
                          {formatEUR(h.market_value_cents)}
                        </td>
                        <td className="px-5 py-2 text-right tabular-nums text-subink">
                          {formatEUR(h.cost_basis_cents)}
                        </td>
                        <td
                          className={`px-5 py-2 text-right tabular-nums ${
                            h.unrealised_pnl_cents >= 0 ? "text-pos" : "text-neg"
                          }`}
                        >
                          {h.unrealised_pnl_cents >= 0 ? "+" : ""}
                          {formatEUR(h.unrealised_pnl_cents)}
                          {h.unrealised_pnl_pct !== null && (
                            <span className="ml-1 text-[11px]">
                              ({h.unrealised_pnl_pct.toFixed(1)}%)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            className="text-subink hover:text-brand-accent text-xs"
                            onClick={() => openEdit(h)}
                          >
                            edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      <HoldingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        editing={editing}
        defaultAccountId={defaultAccount}
      />

      <CashFlowModal
        open={cashFor != null}
        onClose={() => setCashFor(null)}
        accountId={cashFor?.id ?? 0}
        accountName={cashFor?.name ?? ""}
      />
    </div>
  );
}
