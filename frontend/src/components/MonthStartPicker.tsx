import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useMe } from "../hooks/useAuth";

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

export default function MonthStartPicker() {
  const me = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const current = me.data?.month_start_day ?? 1;

  async function set(day: number) {
    if (day === current || busy) return;
    setBusy(true);
    setHint(null);
    try {
      await api.patch("/auth/me", { month_start_day: day });
      await qc.invalidateQueries({ queryKey: ["me"] });
      await qc.invalidateQueries({ queryKey: ["summary"] });
      await qc.invalidateQueries({ queryKey: ["buckets"] });
      setHint("Saved.");
      setTimeout(() => setHint(null), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex-1">
        <div className="text-sm font-medium">Financial month starts on day</div>
        <div className="text-xs text-subink">
          Default: 1 (calendar month). Pick your payday (e.g. 27) to anchor "this month" to your paycheck.
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select
          className="input h-9 w-20"
          value={current}
          onChange={(e) => set(Number(e.target.value))}
          disabled={busy || me.isLoading}
        >
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {hint && <span className="text-xs text-pos">{hint}</span>}
      </div>
    </div>
  );
}
