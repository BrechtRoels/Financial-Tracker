import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMerchants } from "../api/hooks";
import type { MerchantSummary } from "../api/types";
import { formatEUR } from "../lib/format";

function shortMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function logoUrlFor(merchant: string): string {
  // Heuristic: try the merchant name as a domain on Clearbit's free logo CDN.
  // Falls back gracefully via onError; no API key needed.
  const slug = merchant
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30);
  return `https://logo.clearbit.com/${slug}.com`;
}

function MerchantInitials({ name }: { name: string }) {
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return (
    <span className="h-9 w-9 rounded-lg bg-brand-50 border border-line text-ink flex items-center justify-center text-xs font-semibold">
      {initials.toUpperCase() || "?"}
    </span>
  );
}

function Logo({ merchant }: { merchant: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <MerchantInitials name={merchant} />;
  return (
    <img
      src={logoUrlFor(merchant)}
      alt={merchant}
      className="h-9 w-9 rounded-lg bg-white border border-line object-contain p-1"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

export default function Merchants() {
  const [months, setMonths] = useState(12);
  const { data, isLoading } = useMerchants(months);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((m) => !q || m.merchant.toLowerCase().includes(q));
  }, [data, query]);

  const total = filtered.reduce((s, m) => s + m.total_cents, 0);
  const totalTx = filtered.reduce((s, m) => s + m.transactions, 0);

  const detail = useMemo(
    () => (data ?? []).find((m) => m.merchant === selected) ?? filtered[0] ?? null,
    [data, selected, filtered]
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Merchants</h1>
          <p className="text-sm text-subink">
            Where your money goes — totals, frequency, and trends per merchant.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-48"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="input w-28 text-sm"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
          </select>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="label">Total spent</div>
          <div className="mt-2 text-2xl font-semibold">{formatEUR(total)}</div>
        </div>
        <div className="card">
          <div className="label">Transactions</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{totalTx}</div>
        </div>
        <div className="card">
          <div className="label">Distinct merchants</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{filtered.length}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: list */}
        <div className="lg:col-span-2 card p-0 overflow-hidden">
          {isLoading && <div className="px-6 py-4 text-sm text-subink">Loading…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-subink text-sm">
              No merchants in this period.
            </div>
          )}
          {filtered.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-subink bg-brand-50/50">
                  <th className="px-4 py-3 font-medium uppercase text-[11px] tracking-wide">
                    Merchant
                  </th>
                  <th className="px-4 py-3 font-medium uppercase text-[11px] tracking-wide text-right">
                    Total
                  </th>
                  <th className="px-4 py-3 font-medium uppercase text-[11px] tracking-wide text-right">
                    # tx
                  </th>
                  <th className="px-4 py-3 font-medium uppercase text-[11px] tracking-wide text-right">
                    Avg
                  </th>
                  <th className="px-4 py-3 font-medium uppercase text-[11px] tracking-wide">
                    Last
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const isSel = detail?.merchant === m.merchant;
                  return (
                    <tr
                      key={m.merchant}
                      onClick={() => setSelected(m.merchant)}
                      className={`border-t border-line cursor-pointer transition ${
                        isSel ? "bg-brand-50" : "hover:bg-brand-50/40"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <Logo merchant={m.merchant} />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{m.merchant}</div>
                            {m.top_category && (
                              <div className="text-[11px] text-subink truncate">
                                {m.top_category}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-neg">
                        {formatEUR(-m.total_cents)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-subink">
                        {m.transactions}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-subink">
                        {formatEUR(-m.avg_cents)}
                      </td>
                      <td className="px-4 py-2.5 text-subink text-xs tabular-nums">
                        {fmtDate(m.last_seen)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Right: detail panel */}
        <div className="card">
          {detail ? (
            <MerchantDetail merchant={detail} />
          ) : (
            <div className="text-sm text-subink py-8 text-center">
              Select a merchant on the left to see its trend.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MerchantDetail({ merchant: m }: { merchant: MerchantSummary }) {
  const chartData = m.monthly.map((p) => ({
    month: p.month,
    label: shortMonth(p.month),
    amount: p.amount_cents / 100,
  }));
  const months = m.monthly.length;
  const avgPerMonth = months ? m.total_cents / months : 0;
  const peak = m.monthly.reduce(
    (best, x) => (x.amount_cents > best.amount_cents ? x : best),
    m.monthly[0] ?? { month: "", amount_cents: 0 }
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Logo merchant={m.merchant} />
        <div className="min-w-0">
          <div className="font-semibold truncate">{m.merchant}</div>
          {m.top_category && (
            <div className="text-xs text-subink">{m.top_category}</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-line p-2">
          <div className="label">Total</div>
          <div className="font-semibold mt-1">{formatEUR(-m.total_cents)}</div>
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="label">Avg / month</div>
          <div className="font-semibold mt-1">{formatEUR(-avgPerMonth)}</div>
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="label">Visits</div>
          <div className="font-semibold mt-1 tabular-nums">{m.transactions}</div>
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="label">Peak month</div>
          <div className="font-semibold mt-1">
            {peak.amount_cents > 0
              ? `${shortMonth(peak.month)} · ${formatEUR(-peak.amount_cents)}`
              : "—"}
          </div>
        </div>
      </div>

      <div>
        <div className="label mb-1 mt-1">Monthly trend</div>
        <div style={{ width: "100%", height: 180 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#64748B" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#64748B" }}
                tickLine={false}
                axisLine={false}
                width={50}
                tickFormatter={(v) => `€${Math.round(v).toLocaleString()}`}
              />
              <Tooltip
                formatter={(v: number) => [`€${v.toLocaleString()}`, "spent"]}
                cursor={{ fill: "rgba(30,58,95,0.08)" }}
              />
              <Bar dataKey="amount" fill="#1E3A5F" radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fillOpacity={d.amount === 0 ? 0.15 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="text-[11px] text-subink">
        First seen {fmtDate(m.first_seen)} · last {fmtDate(m.last_seen)}
      </div>
    </div>
  );
}
