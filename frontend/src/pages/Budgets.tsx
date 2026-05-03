import { useState } from "react";
import ProgressBar from "../components/ProgressBar";
import { api } from "../api/client";
import { useBudgets, useCategories, useMutateResource } from "../api/hooks";
import { formatEUR, monthStart, toCents } from "../lib/format";

export default function Budgets() {
  const [month, setMonth] = useState(monthStart());
  const categories = useCategories();
  const budgets = useBudgets(month);

  const upsert = useMutateResource(
    (v: { category_id: number; amount_cents: number; month: string }) =>
      api.post("/budgets", v).then((r) => r.data),
    ["budgets"]
  );

  const expenseCats = (categories.data ?? []).filter((c) => c.kind === "expense");
  const byCat = Object.fromEntries((budgets.data ?? []).map((b) => [b.category_id, b]));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Budgets</h1>
          <p className="text-sm text-subink">Set a gentle monthly limit per category.</p>
        </div>
        <input
          type="month"
          className="input w-auto"
          value={month.slice(0, 7)}
          onChange={(e) => setMonth(`${e.target.value}-01`)}
        />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {expenseCats.map((c) => {
          const b = byCat[c.id];
          const amount = b?.amount_cents ?? 0;
          const spent = b?.spent_cents ?? 0;
          const pct = amount > 0 ? (spent / amount) * 100 : 0;
          return (
            <div key={c.id} className="card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="chip" style={{ background: c.color }}>
                    {c.name}
                  </span>
                </div>
                <input
                  className="input w-28 text-right"
                  type="number"
                  step="0.01"
                  defaultValue={(amount / 100).toFixed(2)}
                  onBlur={(e) =>
                    upsert.mutate({
                      category_id: c.id,
                      amount_cents: toCents(parseFloat(e.target.value || "0")),
                      month,
                    })
                  }
                />
              </div>
              <ProgressBar value={pct} color={c.color} />
              <div className="flex items-center justify-between mt-2 text-xs text-subink">
                <span>{formatEUR(spent)} spent</span>
                <span>of {formatEUR(amount)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
