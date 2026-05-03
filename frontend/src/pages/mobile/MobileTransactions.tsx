import { useMemo, useState } from "react";
import MobileEditTransactionSheet from "../../components/mobile/MobileEditTransactionSheet";
import { useAccounts, useCategories, useTransactions } from "../../api/hooks";
import type { Transaction } from "../../api/types";
import { formatDate, formatEUR } from "../../lib/format";

export default function MobileTransactions() {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<number | "">("");
  const [categoryFilter, setCategoryFilter] = useState<number | "">("");

  const accounts = useAccounts();
  const categories = useCategories();
  const txs = useTransactions({
    account_id: accountFilter || undefined,
    category_id: categoryFilter || undefined,
  });

  const accountMap = useMemo(
    () => Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data]
  );
  const catMap = useMemo(
    () => Object.fromEntries((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return txs.data ?? [];
    return (txs.data ?? []).filter((t) => {
      const m = (t.merchant ?? "").toLowerCase();
      const d = (t.description ?? "").toLowerCase();
      return m.includes(q) || d.includes(q);
    });
  }, [search, txs.data]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        placeholder="Search merchant or description"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input h-11"
      />

      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        <FilterChip
          label="All accounts"
          active={accountFilter === ""}
          onClick={() => setAccountFilter("")}
        />
        {(accounts.data ?? []).map((a) => (
          <FilterChip
            key={a.id}
            label={a.name}
            active={accountFilter === a.id}
            onClick={() => setAccountFilter(a.id)}
          />
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
        <FilterChip
          label="All categories"
          active={categoryFilter === ""}
          onClick={() => setCategoryFilter("")}
        />
        {(categories.data ?? []).map((c) => (
          <FilterChip
            key={c.id}
            label={c.name}
            swatch={c.color}
            active={categoryFilter === c.id}
            onClick={() => setCategoryFilter(c.id)}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {filtered.map((t) => {
          const cat = t.category_id ? catMap[t.category_id] : null;
          const acc = accountMap[t.account_id];
          return (
            <li
              key={t.id}
              onClick={() => setEditing(t)}
              className="card p-3 flex items-start justify-between gap-3 active:bg-brand-50"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate text-ink">
                  {t.merchant || t.description || "—"}
                </div>
                {t.merchant && t.description && (
                  <div className="text-[11px] text-subink truncate">{t.description}</div>
                )}
                <div className="mt-1 flex items-center flex-wrap gap-1.5 text-[11px] text-subink">
                  <span className="tabular-nums">{formatDate(t.occurred_on)}</span>
                  {acc && <span>· {acc.name}</span>}
                  {cat && (
                    <span
                      className="chip text-[10px] px-1.5 py-0.5"
                      style={{ background: cat.color }}
                    >
                      {cat.name}
                    </span>
                  )}
                  {t.transfer_group_id && (
                    <span className="chip text-[10px] px-1.5 py-0.5 bg-tag-mist">transfer</span>
                  )}
                </div>
              </div>
              <div
                className={`text-sm font-semibold tabular-nums whitespace-nowrap ${
                  t.amount_cents < 0 ? "text-neg" : "text-pos"
                }`}
              >
                {formatEUR(t.amount_cents)}
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="card p-6 text-center text-subink text-sm">No transactions match.</li>
        )}
      </ul>

      <MobileEditTransactionSheet
        open={editing != null}
        onClose={() => setEditing(null)}
        transaction={editing}
      />
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  swatch,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  swatch?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? "bg-brand-accent text-white border-brand-accent"
          : "bg-surface text-subink border-line"
      }`}
    >
      {swatch && (
        <span className="h-2 w-2 rounded-full" style={{ background: swatch }} />
      )}
      {label}
    </button>
  );
}
