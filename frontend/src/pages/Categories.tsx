import { useMemo, useState } from "react";
import CategoryModal from "../components/CategoryModal";
import EditTransactionModal from "../components/EditTransactionModal";
import MonthStartPicker from "../components/MonthStartPicker";
import { useAccounts, useCategories, useTransactions } from "../api/hooks";
import type { Category, Transaction } from "../api/types";
import { formatDate, formatEUR } from "../lib/format";

export default function Categories() {
  const categories = useCategories();
  const accounts = useAccounts();
  // Pull all transactions in one shot — single-user app, the volume is fine.
  const txs = useTransactions({ limit: 500 });
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const accountMap = useMemo(
    () => Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data]
  );

  // Aggregate per category from the loaded transactions (cheap, in-memory).
  const stats = useMemo(() => {
    const out: Record<number, { in: number; out: number; n: number; tx: Transaction[] }> = {};
    let uncatIn = 0;
    let uncatOut = 0;
    let uncatN = 0;
    const uncatTx: Transaction[] = [];
    for (const t of txs.data ?? []) {
      if (t.transfer_group_id) continue; // exclude self-transfers
      if (t.category_id == null) {
        uncatN += 1;
        uncatTx.push(t);
        if (t.amount_cents > 0) uncatIn += t.amount_cents;
        else uncatOut += -t.amount_cents;
        continue;
      }
      const b = (out[t.category_id] ||= { in: 0, out: 0, n: 0, tx: [] });
      b.n += 1;
      b.tx.push(t);
      if (t.amount_cents > 0) b.in += t.amount_cents;
      else b.out += -t.amount_cents;
    }
    return { byCat: out, uncatIn, uncatOut, uncatN, uncatTx };
  }, [txs.data]);

  function toggle(id: number) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  const expense = (categories.data ?? []).filter((c) => c.kind === "expense");
  const income = (categories.data ?? []).filter((c) => c.kind === "income");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="text-sm text-subink">
            Click a category to see its transactions. Click any transaction to recategorise it
            (useful for paybacks).
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreatingNew(true)}>
          + New category
        </button>
      </header>

      <MonthStartPicker />

      <Group
        title="Expenses"
        items={expense}
        stats={stats.byCat}
        accountMap={accountMap}
        expanded={expanded}
        toggle={toggle}
        onEditCat={setEditingCat}
        onEditTx={setEditingTx}
      />

      <Group
        title="Income"
        items={income}
        stats={stats.byCat}
        accountMap={accountMap}
        expanded={expanded}
        toggle={toggle}
        onEditCat={setEditingCat}
        onEditTx={setEditingTx}
      />

      {(stats.uncatN > 0) && (
        <div>
          <h2 className="text-sm font-medium text-subink mb-3 uppercase tracking-wide">
            Uncategorised
          </h2>
          <UncategorisedCard
            count={stats.uncatN}
            totalIn={stats.uncatIn}
            totalOut={stats.uncatOut}
            txs={stats.uncatTx}
            accountMap={accountMap}
            isOpen={!!expanded[-1]}
            onToggle={() => toggle(-1)}
            onEditTx={setEditingTx}
          />
        </div>
      )}

      <CategoryModal
        open={editingCat != null || creatingNew}
        onClose={() => {
          setEditingCat(null);
          setCreatingNew(false);
        }}
        editing={editingCat}
      />

      <EditTransactionModal
        open={editingTx != null}
        onClose={() => setEditingTx(null)}
        transaction={editingTx}
      />
    </div>
  );
}

type GroupProps = {
  title: string;
  items: Category[];
  stats: Record<number, { in: number; out: number; n: number; tx: Transaction[] }>;
  accountMap: Record<number, any>;
  expanded: Record<number, boolean>;
  toggle: (id: number) => void;
  onEditCat: (c: Category) => void;
  onEditTx: (t: Transaction) => void;
};

function Group({
  title,
  items,
  stats,
  accountMap,
  expanded,
  toggle,
  onEditCat,
  onEditTx,
}: GroupProps) {
  if (items.length === 0) {
    return (
      <div>
        <h2 className="text-sm font-medium text-subink mb-3 uppercase tracking-wide">{title}</h2>
        <div className="text-xs text-subink">None yet.</div>
      </div>
    );
  }
  // Sort by net spend (largest first) so big buckets surface
  const sorted = [...items].sort((a, b) => {
    const sa = stats[a.id];
    const sb = stats[b.id];
    const va = sa ? sa.out + sa.in : 0;
    const vb = sb ? sb.out + sb.in : 0;
    return vb - va;
  });
  return (
    <div>
      <h2 className="text-sm font-medium text-subink mb-3 uppercase tracking-wide">{title}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sorted.map((c) => {
          const s = stats[c.id];
          const total = s ? (c.kind === "expense" ? -s.out + s.in : s.in - s.out) : 0;
          const isOpen = !!expanded[c.id];
          return (
            <div
              key={c.id}
              className="card p-0 overflow-hidden"
              style={{ borderLeft: `6px solid ${c.color}` }}
            >
              <div className="flex items-center justify-between px-4 py-3 gap-2">
                <button
                  className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  onClick={() => toggle(c.id)}
                >
                  <span
                    className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center text-[11px] font-semibold text-ink"
                    style={{ background: c.color }}
                  >
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="text-[11px] text-subink">
                      {s?.n ?? 0} tx
                      {s && s.in > 0 && s.out > 0 && (
                        <>
                          {" "}· in {formatEUR(s.in)} · out {formatEUR(-s.out)}
                        </>
                      )}
                    </div>
                  </div>
                </button>
                <div className="text-right shrink-0">
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      total < 0 ? "text-neg" : total > 0 ? "text-pos" : "text-subink"
                    }`}
                  >
                    {total === 0 ? "—" : (total > 0 ? "+" : "") + formatEUR(total)}
                  </div>
                </div>
                <button
                  className="text-subink hover:text-brand-accent text-xs px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditCat(c);
                  }}
                  aria-label="Edit category"
                  title="Edit category"
                >
                  edit
                </button>
                <span className={`text-subink text-xs transition ${isOpen ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </div>

              {isOpen && (
                <div className="border-t border-line">
                  {(s?.tx ?? []).length === 0 ? (
                    <div className="px-4 py-3 text-xs text-subink">
                      No transactions in this category yet.
                    </div>
                  ) : (
                    <ul className="divide-y divide-line">
                      {(s?.tx ?? [])
                        .slice()
                        .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1))
                        .slice(0, 50)
                        .map((t) => (
                          <li
                            key={t.id}
                            className="px-4 py-2 flex items-center justify-between gap-3 hover:bg-brand-50/40 cursor-pointer"
                            onClick={() => onEditTx(t)}
                          >
                            <div className="min-w-0">
                              <div className="text-sm truncate">
                                <span className="font-medium">
                                  {t.merchant || t.description || "—"}
                                </span>
                                {t.merchant && t.description && t.description !== t.merchant && (
                                  <span className="text-subink ml-2 text-xs">
                                    · {t.description}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-subink">
                                {formatDate(t.occurred_on)}
                                {accountMap[t.account_id] && ` · ${accountMap[t.account_id].name}`}
                              </div>
                            </div>
                            <div
                              className={`text-sm tabular-nums shrink-0 ${
                                t.amount_cents < 0 ? "text-neg" : "text-pos"
                              }`}
                            >
                              {formatEUR(t.amount_cents)}
                            </div>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UncategorisedCard({
  count,
  totalIn,
  totalOut,
  txs,
  accountMap,
  isOpen,
  onToggle,
  onEditTx,
}: {
  count: number;
  totalIn: number;
  totalOut: number;
  txs: Transaction[];
  accountMap: Record<number, any>;
  isOpen: boolean;
  onToggle: () => void;
  onEditTx: (t: Transaction) => void;
}) {
  return (
    <div className="card p-0 overflow-hidden border-l-[6px] border-amber-200">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-brand-50/30"
        onClick={onToggle}
      >
        <div>
          <div className="font-medium">Uncategorised</div>
          <div className="text-[11px] text-subink">
            {count} transaction{count === 1 ? "" : "s"} · in {formatEUR(totalIn)} · out{" "}
            {formatEUR(-totalOut)}
          </div>
        </div>
        <span className={`text-subink text-xs transition ${isOpen ? "rotate-180" : ""}`}>▾</span>
      </button>
      {isOpen && (
        <ul className="border-t border-line divide-y divide-line">
          {txs
            .slice()
            .sort((a, b) => (a.occurred_on < b.occurred_on ? 1 : -1))
            .slice(0, 100)
            .map((t) => (
              <li
                key={t.id}
                className="px-4 py-2 flex items-center justify-between gap-3 hover:bg-brand-50/40 cursor-pointer"
                onClick={() => onEditTx(t)}
              >
                <div className="min-w-0">
                  <div className="text-sm truncate font-medium">
                    {t.merchant || t.description || "—"}
                  </div>
                  <div className="text-[11px] text-subink">
                    {formatDate(t.occurred_on)}
                    {accountMap[t.account_id] && ` · ${accountMap[t.account_id].name}`}
                  </div>
                </div>
                <div
                  className={`text-sm tabular-nums shrink-0 ${
                    t.amount_cents < 0 ? "text-neg" : "text-pos"
                  }`}
                >
                  {formatEUR(t.amount_cents)}
                </div>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
