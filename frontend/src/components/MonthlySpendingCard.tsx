import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSpendingByMonth } from "../api/hooks";
import { formatEUR, fromCents } from "../lib/format";

function shortMonth(ym: string): string {
  // ym = "YYYY-MM"
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
  });
}

export default function MonthlySpendingCard() {
  const { data, isLoading } = useSpendingByMonth(12);
  const rows = data ?? [];
  const today = new Date();
  const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const chartData = rows.map((r) => ({
    month: r.month,
    label: shortMonth(r.month),
    expenses: fromCents(r.expenses_cents),
    income: fromCents(r.income_cents),
    net: fromCents(r.net_cents),
    isCurrent: r.month === currentYm,
    top: r.top_category,
  }));

  const totalSpent = rows.reduce((s, r) => s + r.expenses_cents, 0);
  const months = rows.filter((r) => r.expenses_cents > 0).length;
  const avg = months > 0 ? totalSpent / months : 0;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="font-medium">Monthly spending · last 12 months</div>
          {months > 0 && (
            <div className="text-xs text-subink">
              avg <span className="font-semibold text-ink">{formatEUR(avg)}</span> / month across{" "}
              {months} active month{months === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>

      {isLoading && <div className="text-xs text-subink">Loading…</div>}

      {!isLoading && chartData.every((d) => d.expenses === 0 && d.income === 0) && (
        <div className="text-xs text-subink py-6">No transactions yet in the last 12 months.</div>
      )}

      {chartData.some((d) => d.expenses !== 0 || d.income !== 0) && (
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#64748B" }}
                tickLine={false}
                axisLine={false}
                width={70}
                tickFormatter={(v) => `€${Math.round(v).toLocaleString()}`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d: any = payload[0].payload;
                  return (
                    <div className="rounded-lg bg-white border border-line shadow-pop px-3 py-2 text-xs">
                      <div className="font-semibold mb-1">{d.label}</div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-pos">Income</span>
                        <span className="tabular-nums">€{d.income.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-neg">Expenses</span>
                        <span className="tabular-nums">€{d.expenses.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4 mt-1 pt-1 border-t border-line">
                        <span className="text-subink">Net</span>
                        <span className={`tabular-nums font-medium ${d.net >= 0 ? "text-pos" : "text-neg"}`}>
                          {d.net >= 0 ? "+" : ""}€{d.net.toLocaleString()}
                        </span>
                      </div>
                      {d.top && (
                        <div className="mt-1 text-subink">
                          Top: {d.top.name} (€{(d.top.amount_cents / 100).toLocaleString()})
                        </div>
                      )}
                      {d.isCurrent && (
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-subink">
                          in progress
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                iconType="circle"
                iconSize={8}
              />
              <Bar dataKey="income" fill="#0F766E" radius={[4, 4, 0, 0]} name="Income">
                {chartData.map((d, i) => (
                  <Cell key={i} fillOpacity={d.isCurrent ? 0.4 : 1} />
                ))}
              </Bar>
              <Bar dataKey="expenses" fill="#B91C1C" radius={[4, 4, 0, 0]} name="Expenses">
                {chartData.map((d, i) => (
                  <Cell key={i} fillOpacity={d.isCurrent ? 0.4 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
