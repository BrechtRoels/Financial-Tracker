import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import AiSummaryCard from "../components/AiSummaryCard";
import AnomalyFeed from "../components/AnomalyFeed";
import GoalsCard from "../components/GoalsCard";
import InsightsCard from "../components/InsightsCard";
import LocationsCard from "../components/LocationsCard";
import MonthlySpendingCard from "../components/MonthlySpendingCard";
import RunwayCard from "../components/RunwayCard";
import StatCard from "../components/StatCard";
import SubscriptionsCard from "../components/SubscriptionsCard";
import {
  useCurrentNetWorth,
  useDataRange,
  useInsights,
  useNetWorth,
  useNetWorthForecast,
  useSpendingByCategory,
  useSummary,
} from "../api/hooks";
import { formatEUR, fromCents, monthStart } from "../lib/format";

function defaultRange(earliestIso?: string | null) {
  const today = new Date();
  // Fall back to last 12 months when we have no transactions yet.
  let fromDate: Date;
  if (earliestIso) {
    fromDate = new Date(earliestIso);
  } else {
    fromDate = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1);
  }
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

function monthRange() {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

const FORECAST_WEEKS = 26;

type ChartPoint = {
  date: string;
  net: number | null;
  forecast: number | null;
  band?: [number, number]; // [lower, upper] in EUR — Recharts renders Area ranges from tuples
};

function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function Dashboard() {
  const month = monthStart();
  const dataRange = useDataRange();
  const { from: nwFrom, to: nwTo } = defaultRange(dataRange.data?.earliest_transaction);
  const { from: mFrom, to: mTo } = monthRange();

  const nw = useCurrentNetWorth();
  const summary = useSummary(month);
  const series = useNetWorth(nwFrom, nwTo);
  const spending = useSpendingByCategory(mFrom, mTo);

  const [showForecast, setShowForecast] = useState(false);
  const forecast = useNetWorthForecast(FORECAST_WEEKS, showForecast);
  const insightsQuery = useInsights();

  const savingsPct = summary.data ? Math.round(summary.data.savings_rate * 100) : 0;
  const paceInsight = (insightsQuery.data ?? []).find((i) => i.kind === "pace_projection");
  const expensesHint = paceInsight?.value
    ? `On pace for ~€${Math.round(paceInsight.value).toLocaleString()} this month`
    : undefined;

  const chartData: ChartPoint[] = useMemo(() => {
    const raw = series.data ?? [];
    if (!showForecast) {
      return raw.map((p) => ({
        date: p.date,
        net: fromCents(p.net_worth_cents),
        forecast: null,
      }));
    }
    const f = forecast.data;
    if (!f || f.history.length === 0) {
      return raw.map((p) => ({
        date: p.date,
        net: fromCents(p.net_worth_cents),
        forecast: null,
      }));
    }
    const historical: ChartPoint[] = f.history.map((p) => ({
      date: p.date,
      net: fromCents(p.net_worth_cents),
      forecast: null,
    }));
    // Bridge the last historical point into the forecast line + band
    const lastHist = historical[historical.length - 1];
    const lastVal = lastHist.net ?? 0;
    lastHist.forecast = lastVal;
    lastHist.band = [lastVal, lastVal];

    const future: ChartPoint[] = f.forecast.map((p) => ({
      date: p.date,
      net: null,
      forecast: fromCents(p.point_cents),
      band: [fromCents(p.lower_cents), fromCents(p.upper_cents)],
    }));
    return [...historical, ...future];
  }, [series.data, showForecast, forecast.data]);

  const canForecast = (series.data ?? []).length >= 2;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-subink">A gentle overview of your money.</p>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Net worth"
          value={nw.data ? formatEUR(nw.data.net_worth_cents) : "—"}
          accent="#1E3A5F"
          hint={
            nw.data
              ? `Assets ${formatEUR(nw.data.assets_cents)} · Liab ${formatEUR(nw.data.liabilities_cents)}`
              : undefined
          }
        />
        <StatCard
          label="Income (month)"
          value={summary.data ? formatEUR(summary.data.income_cents) : "—"}
          accent="#0F766E"
        />
        <StatCard
          label="Expenses (month)"
          value={summary.data ? formatEUR(summary.data.expenses_cents) : "—"}
          accent="#B91C1C"
          hint={expensesHint}
        />
        <StatCard
          label="Avg monthly spend"
          value={
            summary.data && summary.data.months_sampled > 0
              ? formatEUR(summary.data.avg_monthly_expenses_cents)
              : "—"
          }
          hint={
            summary.data && summary.data.months_sampled > 0
              ? `across ${summary.data.months_sampled} month${summary.data.months_sampled === 1 ? "" : "s"}`
              : undefined
          }
          accent="#B45309"
        />
        <StatCard label="Savings rate" value={`${savingsPct}%`} accent="#475569" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RunwayCard />
        </div>
        <AnomalyFeed />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div className="font-medium">
              Net worth · weekly{" "}
              {dataRange.data?.earliest_transaction ? (
                <span className="text-subink font-normal">
                  · since {new Date(dataRange.data.earliest_transaction).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </span>
              ) : (
                <span className="text-subink font-normal">· last 12 months</span>
              )}
              {showForecast && (
                <span className="ml-2 text-xs text-subink">
                  · projecting next 6 months
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowForecast((v) => !v)}
              disabled={!canForecast}
              title={
                !canForecast
                  ? "Need at least 2 months of data to forecast"
                  : "Project the trend forward by 6 months"
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
                showForecast
                  ? "bg-brand-accent text-white border-brand-accent"
                  : "bg-white text-ink border-line hover:bg-brand-50"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="3 17 9 11 13 15 21 7" />
                <polyline points="15 7 21 7 21 13" />
              </svg>
              {showForecast ? "Forecast on" : "Forecast 6m"}
            </button>
          </div>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1E3A5F" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1E3A5F" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="nw_fc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#475569" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#475569" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#64748B" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={shortDate}
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#64748B" }}
                  tickLine={false}
                  axisLine={false}
                  width={60}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const label = name === "forecast" ? "forecast" : "net worth";
                    if (value == null || value === "") return ["—", label];
                    const n = typeof value === "number" ? value : Number(value);
                    return [Number.isFinite(n) ? `€${n.toLocaleString()}` : String(value), label];
                  }}
                />
                {showForecast && (
                  <Area
                    type="monotone"
                    dataKey="band"
                    stroke="none"
                    fill="#475569"
                    fillOpacity={0.12}
                    connectNulls={false}
                    isAnimationActive={false}
                    activeDot={false}
                    legendType="none"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="net"
                  stroke="#1E3A5F"
                  fill="url(#nw)"
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {showForecast && (
                  <Area
                    type="monotone"
                    dataKey="forecast"
                    stroke="#475569"
                    strokeDasharray="5 5"
                    fill="none"
                    strokeWidth={2}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {showForecast && forecast.data && (
            <details className="mt-2 text-[11px] text-subink group">
              <summary className="cursor-pointer select-none hover:text-ink">
                Projection with 80% band ·{" "}
                <span className="font-medium text-ink">
                  {(() => {
                    const p = forecast.data.forecast[forecast.data.forecast.length - 1];
                    return p
                      ? `€${Math.round(fromCents(p.lower_cents)).toLocaleString()} – €${Math.round(fromCents(p.upper_cents)).toLocaleString()} in 6 months`
                      : "";
                  })()}
                </span>{" "}
                <span className="text-brand-accent group-open:hidden">how?</span>
              </summary>
              <div className="mt-2 pl-1 space-y-0.5">
                <div>
                  <strong>Method:</strong> Damped Holt exponential smoothing over the last{" "}
                  {forecast.data.params.weeks_used} weekly snapshots.
                </div>
                <div>
                  <strong>Fit:</strong> α={forecast.data.params.alpha.toFixed(2)}, β=
                  {forecast.data.params.beta.toFixed(2)}, φ={forecast.data.params.phi.toFixed(2)}{" "}
                  · in-sample RMSE {formatEUR(forecast.data.params.rmse_cents)}
                </div>
                <div>
                  <strong>Band:</strong> ±1.28·σ·√h, where σ =
                  {" "}{formatEUR(forecast.data.params.sigma_cents)} is the stdev of weekly one-step-ahead residuals (band widens with horizon).
                </div>
                {forecast.data.params.weekly_drag_cents !== 0 && (
                  <div>
                    <strong>Known subscription drag:</strong>{" "}
                    {formatEUR(forecast.data.params.weekly_drag_cents)} / week subtracted from the trajectory.
                  </div>
                )}
                <div className="text-subink/80">Informational only — past behaviour is not a guarantee of future balance.</div>
              </div>
            </details>
          )}
        </div>
        <GoalsCard />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <MonthlySpendingCard />
        </div>
        <InsightsCard />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SubscriptionsCard />
        <div className="card">
          <div className="font-medium mb-4">Spending by category · this month</div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={(spending.data ?? []).map((s) => ({
                    name: s.category_name,
                    value: fromCents(s.amount_cents),
                    color: s.color,
                  }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {(spending.data ?? []).map((s, i) => (
                    <Cell key={i} fill={s.color || "#E2E8F0"} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `€${v.toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5 text-sm">
            {(spending.data ?? []).slice(0, 5).map((s) => (
              <li key={s.category_id ?? s.category_name} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                  {s.category_name}
                </span>
                <span className="text-subink">{formatEUR(s.amount_cents)}</span>
              </li>
            ))}
            {!spending.data?.length && <li className="text-subink text-sm">No spending yet this month.</li>}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <LocationsCard />
      </div>

      <div className="grid grid-cols-1 gap-4">
        <AiSummaryCard />
      </div>
    </div>
  );
}
