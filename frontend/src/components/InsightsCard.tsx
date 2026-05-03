import { useMemo, useState } from "react";
import { useInsights, useSpendingByMonth } from "../api/hooks";
import type { Insight } from "../api/types";

const SEVERITY_STYLES: Record<Insight["severity"], { bg: string; text: string; label: string }> = {
  good: { bg: "bg-emerald-50", text: "text-emerald-700", label: "good" },
  warn: { bg: "bg-amber-50", text: "text-amber-700", label: "watch" },
  neutral: { bg: "bg-brand-50", text: "text-subink", label: "info" },
};

function ArrowUp() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}
function ArrowDown() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function Equals() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="5" y1="9" x2="19" y2="9" />
      <line x1="5" y1="15" x2="19" y2="15" />
    </svg>
  );
}

function arrowFor(insight: Insight) {
  if (insight.value == null) return <Equals />;
  if (insight.value > 1) return <ArrowUp />;
  if (insight.value < -1) return <ArrowDown />;
  return <Equals />;
}

function shortMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export default function InsightsCard() {
  const monthly = useSpendingByMonth(12);
  const today = new Date();
  const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState<string>(currentYm);
  const { data, isLoading } = useInsights(month === currentYm ? undefined : month);

  const monthOptions = useMemo(
    () => (monthly.data ?? []).map((m) => m.month).sort().reverse(),
    [monthly.data]
  );

  const items = data ?? [];

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <div className="font-medium">Insights</div>
        <select
          className="text-xs bg-white border border-line rounded-md px-2 py-1 text-ink"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        >
          {monthOptions.length === 0 && <option value={currentYm}>this month</option>}
          {monthOptions.map((ym) => (
            <option key={ym} value={ym}>
              {ym === currentYm ? `${shortMonthLabel(ym)} (current)` : shortMonthLabel(ym)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <div className="text-xs text-subink">Crunching numbers…</div>}

      {!isLoading && items.length === 0 && (
        <div className="text-xs text-subink py-4">
          No insights yet for this period.
        </div>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {items.map((i, idx) => {
          const s = SEVERITY_STYLES[i.severity];
          return (
            <li key={idx} className="py-2.5 flex items-start gap-3">
              <span
                className={`shrink-0 h-7 w-7 rounded-lg ${s.bg} ${s.text} flex items-center justify-center`}
              >
                {arrowFor(i)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-sm font-medium truncate">{i.headline}</div>
                  <span className={`chip text-[10px] ${s.bg} ${s.text} px-1.5 py-0.5`}>
                    {s.label}
                  </span>
                </div>
                <div className="text-xs text-subink mt-0.5 leading-relaxed">{i.message}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
