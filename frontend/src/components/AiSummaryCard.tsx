import { ReactNode, useEffect, useState } from "react";
import Markdown from "./Markdown";
import { api } from "../api/client";

type AiSummary = {
  summary: string;
  generated_at: string;
  model: string;
};

type Section = { heading: string; body: string };

function parseSections(md: string): Section[] {
  const out: Section[] = [];
  const lines = md.split("\n");
  let current: Section | null = null;
  for (const line of lines) {
    const m = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (m) {
      if (current) out.push(current);
      current = { heading: m[1].trim(), body: "" };
    } else if (current) {
      current.body += (current.body ? "\n" : "") + line;
    }
  }
  if (current) out.push(current);
  return out.map((s) => ({ heading: s.heading, body: s.body.trim() }));
}

type Meta = { icon: ReactNode; tint: string };

const ICONS: { match: RegExp; meta: Meta }[] = [
  {
    match: /where you stand|net worth|overall/i,
    meta: { icon: <ScaleIcon />, tint: "#DBE4F0" },
  },
  {
    match: /this month|month so far|monthly/i,
    meta: { icon: <CalendarIcon />, tint: "#DDE4E0" },
  },
  {
    match: /where your money|money is going|spending/i,
    meta: { icon: <PieIcon />, tint: "#E5E1DC" },
  },
  {
    match: /subscription|recurring|regular/i,
    meta: { icon: <RepeatIcon />, tint: "#E0E4EA" },
  },
  {
    match: /place|location|city|shop/i,
    meta: { icon: <PinIcon />, tint: "#D9E2EA" },
  },
  {
    match: /outlook|forecast|six[- ]?month|projection/i,
    meta: { icon: <TrendIcon />, tint: "#DEE5E8" },
  },
  {
    match: /suggestion|recommend|action|one thing/i,
    meta: { icon: <BulbIcon />, tint: "#E8E2D5" },
  },
];

const DEFAULT_META: Meta = { icon: <DotIcon />, tint: "#E2E8F0" };

function metaFor(heading: string): Meta {
  for (const { match, meta } of ICONS) {
    if (match.test(heading)) return meta;
  }
  return DEFAULT_META;
}

function isSuggestion(heading: string): boolean {
  return /suggestion|recommend|action|one thing/i.test(heading);
}

export default function AiSummaryCard() {
  const [data, setData] = useState<AiSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const resp = await api.post<AiSummary>("/stats/ai-summary");
      setData(resp.data);
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections = data ? parseSections(data.summary) : [];
  const regular = sections.filter((s) => !isSuggestion(s.heading));
  const suggestion = sections.find((s) => isSuggestion(s.heading));

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-brand-accent text-white flex items-center justify-center">
            <SparkleIcon />
          </div>
          <div>
            <div className="font-semibold">Your financial briefing</div>
            <div className="text-xs text-subink">
              {data
                ? `generated ${data.generated_at} · ${data.model}`
                : loading
                ? "writing your briefing…"
                : "AI-written narrative over your data"}
            </div>
          </div>
        </div>
        <button
          className="btn-ghost text-xs flex items-center gap-1.5"
          onClick={load}
          disabled={loading}
          title="Regenerate"
        >
          <svg
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          {loading ? "Writing…" : "Refresh"}
        </button>
      </div>

      {err && <div className="text-sm text-neg">{err}</div>}

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-subink py-6">
          <span className="inline-flex gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse" />
            <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse [animation-delay:120ms]" />
            <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse [animation-delay:240ms]" />
          </span>
          Reading your accounts, spending, subscriptions and forecast…
        </div>
      )}

      {data && sections.length === 0 && (
        <Markdown text={data.summary} />
      )}

      {data && sections.length > 0 && (
        <div className={loading ? "opacity-60 transition-opacity" : ""}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {regular.map((s, i) => {
              const meta = metaFor(s.heading);
              return (
                <section
                  key={i}
                  className="rounded-xl border border-line bg-white p-4 flex flex-col gap-2"
                >
                  <header className="flex items-center gap-2.5">
                    <span
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-ink/80"
                      style={{ background: meta.tint }}
                    >
                      {meta.icon}
                    </span>
                    <h3 className="text-sm font-semibold">{s.heading}</h3>
                  </header>
                  <div className="text-[13px] leading-relaxed">
                    <Markdown text={s.body} />
                  </div>
                </section>
              );
            })}
          </div>

          {suggestion && (
            <section className="mt-3 rounded-xl border border-brand-accent/30 bg-brand-accent/5 p-4 flex gap-3">
              <span
                className="h-9 w-9 rounded-lg flex items-center justify-center text-ink shrink-0"
                style={{ background: metaFor(suggestion.heading).tint }}
              >
                {metaFor(suggestion.heading).icon}
              </span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  {suggestion.heading}
                  <span className="chip bg-brand-accent text-white text-[10px] px-1.5 py-0.5">
                    action
                  </span>
                </h3>
                <div className="mt-1 text-[13px] leading-relaxed">
                  <Markdown text={suggestion.body} />
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// inline icons (stroke-based, follow current color)
// ---------------------------------------------------------------------------

function icon(children: ReactNode) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function ScaleIcon() {
  return icon(
    <>
      <path d="M12 3v18" />
      <path d="M5 8h14" />
      <path d="M7 8l-3 7a3 3 0 0 0 6 0l-3-7z" />
      <path d="M17 8l-3 7a3 3 0 0 0 6 0l-3-7z" />
    </>
  );
}

function CalendarIcon() {
  return icon(
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  );
}

function PieIcon() {
  return icon(
    <>
      <path d="M21 12A9 9 0 1 1 12 3v9z" />
      <path d="M21 12A9 9 0 0 0 12 3v9z" />
    </>
  );
}

function RepeatIcon() {
  return icon(
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  );
}

function PinIcon() {
  return icon(
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  );
}

function TrendIcon() {
  return icon(
    <>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </>
  );
}

function BulbIcon() {
  return icon(
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.8.9 1.5 1.7 2 2.5h4c.5-.8 1.2-1.6 2-2.5A6 6 0 0 0 12 3z" />
    </>
  );
}

function DotIcon() {
  return icon(<circle cx="12" cy="12" r="3" />);
}

function SparkleIcon() {
  return icon(
    <>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="M5.5 5.5l2 2" />
      <path d="M16.5 16.5l2 2" />
      <path d="M5.5 18.5l2-2" />
      <path d="M16.5 7.5l2-2" />
    </>
  );
}
