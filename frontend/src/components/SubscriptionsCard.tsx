import { useState } from "react";
import { classifyRecurring } from "../api/goals";
import { useInvalidate, useRecurring } from "../api/hooks";
import type { RecurringClassification, RecurringItem } from "../api/types";
import { formatEUR } from "../lib/format";

const CADENCE_LABEL: Record<string, string> = {
  weekly: "weekly",
  monthly: "monthly",
  yearly: "yearly",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function Menu({
  item,
  onChange,
}: {
  item: RecurringItem;
  onChange: (c: RecurringClassification | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const options: Array<{ value: RecurringClassification; label: string }> = [
    { value: "subscription", label: "Mark as subscription" },
    { value: "regular", label: "Mark as regular" },
    { value: "ignore", label: "Hide from list" },
  ];
  return (
    <div className="relative">
      <button
        className="text-subink hover:text-ink px-1 text-base leading-none"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Classify"
      >
        ⋯
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-6 z-20 w-48 rounded-lg bg-white border border-line shadow-pop py-1 text-left">
            {options.map((o) => (
              <button
                key={o.value}
                className={`w-full px-3 py-1.5 text-xs text-left hover:bg-brand-50 ${
                  item.classification === o.value ? "font-semibold" : ""
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onChange(o.value);
                }}
              >
                {o.label}
              </button>
            ))}
            {item.is_user_set && (
              <button
                className="w-full px-3 py-1.5 text-xs text-left text-subink hover:bg-brand-50 border-t border-line"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onChange(null);
                }}
              >
                Reset to auto
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({
  item,
  onChange,
}: {
  item: RecurringItem;
  onChange: (c: RecurringClassification | null) => void;
}) {
  const muted = item.classification === "ignore";
  return (
    <li
      className={`py-2 flex items-center justify-between gap-3 ${
        muted ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          {item.label}
          {item.is_user_set && (
            <span
              className="text-[10px] text-subink"
              title="You set this classification manually"
            >
              ●
            </span>
          )}
        </div>
        <div className="text-[11px] text-subink">
          <span className="chip bg-brand-50 border border-line mr-1">
            {CADENCE_LABEL[item.cadence] ?? item.cadence}
          </span>
          · next {fmtDate(item.next_expected)}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={`text-sm tabular-nums font-medium ${
            item.avg_amount_cents < 0 ? "text-neg" : "text-pos"
          }`}
        >
          {formatEUR(item.avg_amount_cents)}
        </div>
        <div className="text-[11px] text-subink">
          ≈ {formatEUR(Math.abs(item.monthly_equivalent_cents))}/mo
        </div>
      </div>
      <Menu item={item} onChange={onChange} />
    </li>
  );
}

export default function SubscriptionsCard() {
  const [showHidden, setShowHidden] = useState(false);
  const { data, isLoading } = useRecurring(showHidden);
  const invalidate = useInvalidate();

  async function change(key: string, classification: RecurringClassification | null) {
    await classifyRecurring(key, classification);
    invalidate("recurring");
  }

  const all = (data ?? []).filter((i) => i.avg_amount_cents < 0);
  const subs = all.filter((i) => i.classification === "subscription");
  const regular = all.filter((i) => i.classification === "regular");
  const ignored = all.filter((i) => i.classification === "ignore");

  const subsTotal = subs.reduce((s, i) => s + i.monthly_equivalent_cents, 0);
  const regularTotal = regular.reduce((s, i) => s + i.monthly_equivalent_cents, 0);

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-3">
        <div className="font-medium">Recurring spend</div>
        <div className="text-xs text-subink">
          Click the <span className="font-mono">⋯</span> on any item to reclassify
        </div>
      </div>

      {isLoading && <div className="text-xs text-subink">Detecting…</div>}

      {!isLoading && all.length === 0 && (
        <div className="text-xs text-subink py-4">
          No recurring patterns detected yet. Import more transactions to see your monthly burn.
        </div>
      )}

      {subs.length > 0 && (
        <section className="mb-4">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs font-medium uppercase tracking-wide text-subink">
              Subscriptions
            </div>
            <div className="text-xs text-subink">
              <span className="font-semibold text-ink">{formatEUR(Math.abs(subsTotal))}</span> / mo
            </div>
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {subs.slice(0, 6).map((i) => (
              <Row key={i.key} item={i} onChange={(c) => change(i.key, c)} />
            ))}
          </ul>
        </section>
      )}

      {regular.length > 0 && (
        <section className="mb-4">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs font-medium uppercase tracking-wide text-subink">
              Regular spending
            </div>
            <div className="text-xs text-subink">
              <span className="font-semibold text-ink">{formatEUR(Math.abs(regularTotal))}</span> / mo
            </div>
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {regular.slice(0, 6).map((i) => (
              <Row key={i.key} item={i} onChange={(c) => change(i.key, c)} />
            ))}
          </ul>
        </section>
      )}

      {!showHidden && ignored.length > 0 && (
        <button
          className="text-xs text-subink hover:text-ink"
          onClick={() => setShowHidden(true)}
        >
          Show {ignored.length} hidden
        </button>
      )}
      {showHidden && (
        <section className="mt-2">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs font-medium uppercase tracking-wide text-subink">
              Hidden
            </div>
            <button
              className="text-[11px] text-subink hover:text-ink"
              onClick={() => setShowHidden(false)}
            >
              collapse
            </button>
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {ignored.map((i) => (
              <Row key={i.key} item={i} onChange={(c) => change(i.key, c)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
