import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import BucketCard from "../../components/BucketCard";
import {
  useAccounts,
  useCategories,
  useCurrentNetWorth,
  useDataRange,
  useInsights,
  useNetWorth,
  useSummary,
  useTransactions,
} from "../../api/hooks";
import { formatDate, formatEUR, fromCents, monthStart } from "../../lib/format";

function defaultRange(earliestIso?: string | null) {
  const today = new Date();
  let from: Date;
  if (earliestIso) from = new Date(earliestIso);
  else from = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

function Tile({
  label,
  value,
  hint,
  accent = "#1E3A5F",
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="card p-3 flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wider text-subink">{label}</div>
      <div className="text-lg font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-subink truncate">{hint}</div>}
    </div>
  );
}

export default function MobileDashboard() {
  const month = monthStart();
  const dataRange = useDataRange();
  const { from: nwFrom, to: nwTo } = defaultRange(dataRange.data?.earliest_transaction);

  const nw = useCurrentNetWorth();
  const summary = useSummary(month);
  const series = useNetWorth(nwFrom, nwTo);
  const insightsQuery = useInsights();
  const txs = useTransactions({});
  const accounts = useAccounts();
  const categories = useCategories();

  const accountMap = useMemo(
    () => Object.fromEntries((accounts.data ?? []).map((a) => [a.id, a])),
    [accounts.data]
  );
  const catMap = useMemo(
    () => Object.fromEntries((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data]
  );

  const savingsPct = summary.data ? Math.round(summary.data.savings_rate * 100) : 0;
  const paceInsight = (insightsQuery.data ?? []).find((i) => i.kind === "pace_projection");
  const expensesHint = paceInsight?.value
    ? `Pace ~€${Math.round(paceInsight.value).toLocaleString()}`
    : undefined;

  const sparklineData = useMemo(
    () =>
      (series.data ?? []).map((p) => ({
        date: p.date,
        net: fromCents(p.net_worth_cents),
      })),
    [series.data]
  );

  const recent = (txs.data ?? []).slice(0, 6);

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4">
        <div className="text-xs text-subink uppercase tracking-wider">Net worth</div>
        <div className="mt-1 text-3xl font-semibold tabular-nums text-ink">
          {nw.data ? formatEUR(nw.data.net_worth_cents) : "—"}
        </div>
        {nw.data && (
          <div className="text-xs text-subink mt-1">
            Assets {formatEUR(nw.data.assets_cents)} · Liab {formatEUR(nw.data.liabilities_cents)}
          </div>
        )}
        {sparklineData.length > 1 && (
          <div className="-mx-1 mt-3" style={{ height: 80 }}>
            <ResponsiveContainer>
              <AreaChart data={sparklineData}>
                <defs>
                  <linearGradient id="nwm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1E3A5F" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1E3A5F" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" hide />
                <YAxis hide domain={["auto", "auto"]} />
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke="#1E3A5F"
                  fill="url(#nwm)"
                  strokeWidth={2}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile
          label="Income"
          value={summary.data ? formatEUR(summary.data.income_cents) : "—"}
          accent="#0F766E"
        />
        <Tile
          label="Expenses"
          value={summary.data ? formatEUR(summary.data.expenses_cents) : "—"}
          accent="#B91C1C"
          hint={expensesHint}
        />
        <Tile
          label="Savings rate"
          value={summary.data ? `${savingsPct}%` : "—"}
          accent="#475569"
        />
        <Tile
          label="Avg /mo"
          value={
            summary.data && summary.data.months_sampled > 0
              ? formatEUR(summary.data.avg_monthly_expenses_cents)
              : "—"
          }
          accent="#B45309"
          hint={
            summary.data && summary.data.months_sampled > 0
              ? `over ${summary.data.months_sampled}m`
              : undefined
          }
        />
      </div>

      <div className="card p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium">Recent transactions</div>
          <Link to="/transactions" className="text-xs text-brand-accent">
            View all →
          </Link>
        </div>
        <ul className="flex flex-col divide-y divide-line -mx-4">
          {recent.map((t) => {
            const cat = t.category_id ? catMap[t.category_id] : null;
            const acc = accountMap[t.account_id];
            return (
              <li key={t.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {t.merchant || t.description || "—"}
                  </div>
                  <div className="text-[11px] text-subink truncate">
                    {formatDate(t.occurred_on)}
                    {acc ? ` · ${acc.name}` : ""}
                    {cat ? ` · ${cat.name}` : ""}
                  </div>
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    t.amount_cents < 0 ? "text-neg" : "text-pos"
                  }`}
                >
                  {formatEUR(t.amount_cents)}
                </div>
              </li>
            );
          })}
          {recent.length === 0 && (
            <li className="px-4 py-6 text-center text-subink text-sm">No transactions yet.</li>
          )}
        </ul>
      </div>

      <BucketCard />

      {(insightsQuery.data ?? []).length > 0 && (
        <div className="card p-4">
          <div className="font-medium mb-2">Insights</div>
          <ul className="flex flex-col gap-2">
            {(insightsQuery.data ?? []).slice(0, 4).map((i, idx) => (
              <li key={idx} className="text-sm">
                <div className="font-medium text-ink">{i.headline}</div>
                <div className="text-xs text-subink">{i.message}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
