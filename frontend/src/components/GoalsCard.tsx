import { useState } from "react";
import GoalModal from "./GoalModal";
import ProgressBar from "./ProgressBar";
import { useGoals, useAccounts, useInvalidate } from "../api/hooks";
import type { SavingsGoal } from "../api/types";
import { formatEUR } from "../lib/format";

function fmtMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

export default function GoalsCard() {
  const { data } = useGoals();
  const accounts = useAccounts();
  const invalidate = useInvalidate();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);

  const goals = data ?? [];
  const accountName = (id: number | null) =>
    id == null
      ? "Net worth"
      : accounts.data?.find((a) => a.id === id)?.name ?? `Account #${id}`;

  function openNew() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(g: SavingsGoal) {
    setEditing(g);
    setModalOpen(true);
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">Goals</div>
        <button
          className="btn-ghost text-xs"
          onClick={openNew}
          title="Create a savings goal"
        >
          + New goal
        </button>
      </div>

      {goals.length === 0 && (
        <div className="text-xs text-subink py-4">
          No goals yet. Create one to track progress toward a target.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {goals.map((g) => {
          const pct = Math.round(g.progress_pct * 100);
          const color =
            g.progress_pct >= 1
              ? "#0F766E"
              : g.target_date && !g.on_track
              ? "#B45309"
              : "#1E3A5F";
          return (
            <button
              key={g.id}
              onClick={() => openEdit(g)}
              className="text-left rounded-lg border border-line px-3 py-2.5 hover:border-brand-accent transition"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{g.name}</div>
                  <div className="text-[11px] text-subink">
                    {accountName(g.account_id)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm tabular-nums">
                    {formatEUR(g.current_cents)}{" "}
                    <span className="text-subink">/ {formatEUR(g.target_cents)}</span>
                  </div>
                  <div className="text-[11px] text-subink">{pct}%</div>
                </div>
              </div>
              <div className="mt-2">
                <ProgressBar value={pct} color={color} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] gap-2">
                <span>
                  {g.target_date ? (
                    <span
                      className={`chip ${
                        g.on_track ? "bg-emerald-50" : "bg-amber-50"
                      } border border-line`}
                    >
                      {g.on_track ? "on track" : "off track"}
                    </span>
                  ) : (
                    <span className="chip bg-brand-50 border border-line">no deadline</span>
                  )}
                </span>
                <span className="text-subink text-right">
                  {g.progress_pct >= 1
                    ? "reached 🎉"
                    : g.eta_date
                    ? `reaches target by ${fmtMonth(g.eta_date)}`
                    : g.monthly_rate_cents <= 0
                    ? "no recent savings rate"
                    : "—"}
                  {g.target_date && <> · target {fmtMonth(g.target_date)}</>}
                </span>
              </div>
              {g.status_reason && g.progress_pct < 1 && !g.on_track && (
                <div className="mt-2 rounded-md bg-amber-50 border border-amber-200/70 px-2.5 py-1.5 text-[11px] text-amber-800 leading-relaxed">
                  {g.status_reason}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <GoalModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => invalidate("goals")}
        editing={editing}
      />
    </div>
  );
}
