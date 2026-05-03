import { useEffect, useMemo, useState } from "react";
import Markdown from "../components/Markdown";
import { api } from "../api/client";
import { useSpendingByMonth } from "../api/hooks";

type ReportPayload = {
  month: string;
  report: string;
  generated_at: string;
  model: string;
};

function shortMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default function Reports() {
  const monthly = useSpendingByMonth(12);
  const today = new Date();
  const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState<string>(currentYm);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const monthOptions = useMemo(
    () => (monthly.data ?? []).map((m) => m.month).sort().reverse(),
    [monthly.data]
  );

  async function generate(target: string) {
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const resp = await api.post<ReportPayload>("/stats/ai-expense-report", null, {
        params: { month: target },
      });
      setReport(resp.data);
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Failed to generate report");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // First load: auto-generate for the current month if there's any data.
    if (monthOptions.length > 0 && report === null && !busy && !err) {
      generate(month);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthOptions.length]);

  function downloadMd() {
    if (!report) return;
    const blob = new Blob([report.report], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expense-report-${report.month}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold">Expense reports</h1>
          <p className="text-sm text-subink">
            AI-generated monthly breakdowns with category trends, top merchants, and recommendations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-44 text-sm"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={busy}
          >
            {monthOptions.length === 0 && <option value={currentYm}>{shortMonth(currentYm)}</option>}
            {monthOptions.map((ym) => (
              <option key={ym} value={ym}>
                {shortMonth(ym)}
                {ym === currentYm ? " (current)" : ""}
              </option>
            ))}
          </select>
          <button
            className="btn-primary text-sm"
            onClick={() => generate(month)}
            disabled={busy}
          >
            {busy ? "Generating…" : "Generate"}
          </button>
        </div>
      </header>

      {err && <div className="text-sm text-neg print:hidden">{err}</div>}

      {busy && !report && (
        <div className="card flex items-center gap-3 text-sm text-subink py-6">
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse [animation-delay:240ms]" />
          </span>
          Crunching transactions, comparing months, and writing your report…
        </div>
      )}

      {report && (
        <article className="card">
          <header className="flex items-center justify-between mb-4 pb-3 border-b border-line print:border-0">
            <div>
              <div className="text-lg font-semibold">{shortMonth(report.month)} expense report</div>
              <div className="text-xs text-subink">
                Generated {report.generated_at} · {report.model}
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button className="btn-ghost text-xs" onClick={downloadMd}>
                Download .md
              </button>
              <button className="btn-ghost text-xs" onClick={printReport}>
                Print
              </button>
              <button className="btn-ghost text-xs" onClick={() => generate(report.month)}>
                Regenerate
              </button>
            </div>
          </header>

          <Markdown text={report.report} />
        </article>
      )}
    </div>
  );
}
