import AccountLogo from "./AccountLogo";
import { useRunway } from "../api/hooks";
import type { Severity } from "../api/types";
import { formatEUR } from "../lib/format";

const SEV_DOT: Record<Severity, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-slate-400",
};

const SEV_BAR: Record<Severity, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
  neutral: "bg-slate-400",
};

const MAX_MONTHS = 18; // bar maxes out at 18 months for visual scaling

function severityForMonths(m: number | null): Severity {
  if (m == null) return "neutral";
  if (m < 1) return "danger";
  if (m < 3) return "warn";
  if (m >= 6) return "good";
  return "neutral";
}

function formatMonths(m: number | null): string {
  if (m == null) return "—";
  if (m < 1) return `${(m * 30).toFixed(0)}d`;
  if (m < 12) return `${m.toFixed(1)} mo`;
  return `${(m / 12).toFixed(1)} yr`;
}

export default function RunwayCard() {
  const { data, isLoading } = useRunway();

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${data ? SEV_DOT[data.severity] : "bg-slate-400"}`} />
          <div className="font-medium">Cash runway</div>
        </div>
        {data && data.median_monthly_expense_cents > 0 && (
          <div className="text-xs text-subink text-right">
            at <span className="font-semibold text-ink">
              {formatEUR(data.median_monthly_expense_cents)}
            </span> / mo burn
          </div>
        )}
      </div>

      {isLoading && <div className="text-xs text-subink py-6">Loading…</div>}

      {!isLoading && data && data.median_monthly_expense_cents === 0 && (
        <div className="text-xs text-subink py-6">
          Need at least one completed month of expenses to compute runway. Import or add some transactions.
        </div>
      )}

      {!isLoading && data && data.median_monthly_expense_cents > 0 && (
        <>
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <div className="text-xs text-subink">Total liquid</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatEUR(data.total_liquid_cents)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-subink">Total runway</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatMonths(data.total_runway_months)}
              </div>
            </div>
          </div>

          <ul className="flex flex-col gap-2.5">
            {data.accounts.length === 0 && (
              <li className="text-xs text-subink py-2">
                No liquid accounts yet. Add a checking, savings, cash or meal-voucher account.
              </li>
            )}
            {data.accounts.map((a) => {
              const months = a.runway_months;
              const sev = severityForMonths(months);
              const pct =
                months == null
                  ? 0
                  : Math.max(2, Math.min(100, (months / MAX_MONTHS) * 100));
              const tickOne = (1 / MAX_MONTHS) * 100;
              const tickThree = (3 / MAX_MONTHS) * 100;
              return (
                <li key={a.account_id} className="flex items-center gap-3">
                  <AccountLogo logoUrl={a.logo_url} name={a.name} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between text-xs gap-2 mb-1">
                      <span className="truncate font-medium text-ink">{a.name}</span>
                      <span className="tabular-nums text-subink shrink-0">
                        {formatEUR(a.balance_cents)} · {formatMonths(months)}
                      </span>
                    </div>
                    <div className="relative h-2 rounded-full bg-brand-50 overflow-visible">
                      <div
                        className={`h-full rounded-full transition-all ${SEV_BAR[sev]}`}
                        style={{ width: `${pct}%` }}
                      />
                      {/* 1-month tick */}
                      <span
                        className="absolute top-[-2px] h-[12px] w-px bg-red-300"
                        style={{ left: `${tickOne}%` }}
                        title="1 month"
                      />
                      {/* 3-month tick */}
                      <span
                        className="absolute top-[-2px] h-[12px] w-px bg-amber-300"
                        style={{ left: `${tickThree}%` }}
                        title="3 months"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 text-[11px] text-subink leading-relaxed">
            Runway = balance ÷ median of the last {data.months_sampled} month
            {data.months_sampled === 1 ? "" : "s"}' expenses. Investment holdings excluded — they're not liquid.
          </div>
        </>
      )}
    </div>
  );
}
