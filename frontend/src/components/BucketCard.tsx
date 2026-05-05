import { useBuckets } from "../api/hooks";
import { formatEUR, fromCents } from "../lib/format";

const ROWS: { key: "need" | "want" | "save"; label: string; target: number; color: string; description: string }[] = [
  { key: "need", label: "Needs", target: 50, color: "#1E3A5F", description: "Rent, groceries, utilities, transport" },
  { key: "want", label: "Wants", target: 30, color: "#B45309", description: "Dining, entertainment, shopping" },
  { key: "save", label: "Save", target: 20, color: "#0F766E", description: "Investments, debt repayment" },
];

export default function BucketCard() {
  const q = useBuckets();
  const data = q.data;

  if (!data) {
    return (
      <div className="card">
        <div className="font-medium mb-2">50 / 30 / 20 split</div>
        <div className="text-xs text-subink">Loading…</div>
      </div>
    );
  }

  const totalSpend = data.need_cents + data.want_cents + data.save_cents + data.untagged_cents;
  const denom = data.income_cents > 0 ? data.income_cents : totalSpend;
  const periodLabel = `${prettyDate(data.period_start)} → ${prettyDate(data.period_end)}`;

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <div className="font-medium">50 / 30 / 20 split</div>
        <div className="text-[11px] text-subink truncate">{periodLabel}</div>
      </div>
      <div className="text-xs text-subink mb-4">
        {data.income_cents > 0
          ? `Of ${formatEUR(data.income_cents)} income this month.`
          : "Of categorised expenses this month."}
      </div>

      <ul className="flex flex-col gap-3">
        {ROWS.map((row) => {
          const cents = (data as any)[`${row.key}_cents`] as number;
          const pct = denom > 0 ? Math.round((cents / denom) * 100) : 0;
          const targetPct = (data as any)[`target_${row.key}_pct`] as number;
          const overUnder = pct - targetPct;
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between text-sm mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: row.color }}
                  />
                  <span className="font-medium">{row.label}</span>
                  <span className="text-[11px] text-subink hidden sm:inline truncate">
                    · target {targetPct}%
                  </span>
                </div>
                <div className="tabular-nums text-ink whitespace-nowrap">
                  {formatEUR(cents)}{" "}
                  <span
                    className={
                      Math.abs(overUnder) <= 5
                        ? "text-subink"
                        : overUnder > 0
                        ? "text-neg"
                        : "text-pos"
                    }
                  >
                    ({pct}%)
                  </span>
                </div>
              </div>
              <div className="relative h-2 rounded-full bg-line overflow-hidden">
                {/* target marker */}
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-dashed border-subink/40"
                  style={{ left: `${Math.min(targetPct, 100)}%` }}
                />
                <div
                  className="h-full rounded-full transition-[width]"
                  style={{
                    width: `${Math.min(pct, 100)}%`,
                    background: row.color,
                  }}
                />
              </div>
              <div className="text-[10px] text-subink mt-0.5">{row.description}</div>
            </li>
          );
        })}
      </ul>

      {data.untagged_cents > 0 && (
        <div className="mt-4 pt-3 border-t border-line text-xs text-subink">
          <span className="font-medium text-ink">{formatEUR(data.untagged_cents)}</span>{" "}
          of expenses isn't tagged with a bucket.{" "}
          <a href="/categories" className="text-brand-accent hover:underline">
            Tag categories →
          </a>
        </div>
      )}
    </div>
  );
}

function prettyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// Keeps fromCents reachable for any caller that imports both helpers from
// this file in the future without forcing a separate format.ts hop.
export const _formatEur = (cents: number) => formatEUR(cents);
export const _fromCents = (c: number) => fromCents(c);
