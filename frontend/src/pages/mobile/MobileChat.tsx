import { useEffect, useMemo, useRef, useState } from "react";
import AgentChart, { ChartSpec } from "../../components/AgentChart";
import Markdown from "../../components/Markdown";
import MobileSheet from "../../components/mobile/MobileSheet";
import {
  ChatMessage,
  ChatSession,
  createSession,
  deleteSession,
  ImageArtifact,
  listMessages,
  listSessions,
  streamChat,
} from "../../api/chat";

type LiveMessage = {
  role: "user" | "assistant";
  text: string;
  charts: ChartSpec[];
  images: ImageArtifact[];
  streaming?: boolean;
};

function historyToLive(rows: ChatMessage[]): LiveMessage[] {
  return rows.map((m) => ({
    role: m.role as "user" | "assistant",
    text: m.content,
    charts: (m.chart_spec as ChartSpec[] | undefined) ?? [],
    images: (m.images as ImageArtifact[] | undefined) ?? [],
  }));
}

function MenuIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export default function MobileChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function selectSession(id: number) {
    if (busy) return;
    setActiveId(id);
    setDrawerOpen(false);
    try {
      const rows = await listMessages(id);
      setMessages(historyToLive(rows));
    } catch {
      setMessages([]);
    }
  }

  async function newChat() {
    if (busy) return;
    const s = await createSession();
    setSessions([s, ...sessions]);
    setActiveId(s.id);
    setMessages([]);
    setDrawerOpen(false);
  }

  async function removeSession(id: number) {
    await deleteSession(id);
    setSessions((xs) => xs.filter((s) => s.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    let sessionId = activeId;
    if (sessionId == null) {
      const s = await createSession();
      setSessions([s, ...sessions]);
      sessionId = s.id;
      setActiveId(sessionId);
    }
    setInput("");
    setErr(null);
    setStatus("Thinking…");
    setBusy(true);

    setMessages((prev) => [
      ...prev,
      { role: "user", text, charts: [], images: [] },
      { role: "assistant", text: "", charts: [], images: [], streaming: true },
    ]);

    try {
      await streamChat(sessionId!, text, (ev) => {
        setMessages((prev) => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (!last || last.role !== "assistant") return prev;
          const updated: LiveMessage = { ...last };
          switch (ev.stage) {
            case "thinking":
              setStatus("Thinking…");
              break;
            case "tool_call":
              setStatus(
                ev.tool === "sql_query"
                  ? "Querying…"
                  : ev.tool === "render_chart"
                  ? "Drawing chart…"
                  : `Calling ${ev.tool}…`
              );
              break;
            case "tool_result":
              setStatus(null);
              break;
            case "text_delta":
              updated.text = (updated.text || "") + ev.text;
              break;
            case "chart":
              updated.charts = [...updated.charts, ev.chart];
              break;
            case "image":
              updated.images = [...updated.images, ev.image];
              setStatus(null);
              break;
            case "done":
              updated.streaming = false;
              setStatus(null);
              break;
            case "error":
              setErr(ev.detail);
              updated.streaming = false;
              setStatus(null);
              break;
          }
          copy[copy.length - 1] = updated;
          return copy;
        });
      });
      let needsReload = false;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.text) needsReload = true;
        return prev;
      });
      if (needsReload) {
        const rows = await listMessages(sessionId!);
        setMessages(historyToLive(rows));
      }
      listSessions().then(setSessions).catch(() => {});
    } catch (e: any) {
      setErr(e.message ?? "Chat failed");
      setMessages((prev) => {
        const copy = [...prev];
        if (copy.length && copy[copy.length - 1].role === "assistant") {
          copy[copy.length - 1] = { ...copy[copy.length - 1], streaming: false };
        }
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  const quickPrompts = useMemo(
    () => [
      "How much did I spend this month?",
      "Top 5 merchants",
      "Net worth per month",
    ],
    []
  );

  const activeTitle =
    sessions.find((s) => s.id === activeId)?.title || (activeId ? "Chat" : "New chat");

  return (
    <div className="flex flex-col gap-2 h-[calc(100vh-7.5rem)]">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="text-subink p-1.5 -ml-1.5"
          aria-label="Open sessions"
        >
          <MenuIcon />
        </button>
        <div className="text-sm font-medium text-ink truncate flex-1">{activeTitle}</div>
        <button type="button" onClick={newChat} className="text-xs text-brand-accent">
          + New
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="text-subink">Try one of these:</div>
            <div className="flex flex-wrap gap-2">
              {quickPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chip bg-brand-50 hover:bg-brand-100 border border-line px-3 py-1.5 text-xs"
                  onClick={() => setInput(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        {busy && status && <div className="text-xs text-subink italic">{status}</div>}
        {err && <div className="text-sm text-neg">{err}</div>}
      </div>

      <div className="flex gap-2 pt-2">
        <input
          className="input flex-1 h-11"
          placeholder="Ask a question…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="btn-primary h-11 px-4"
          onClick={send}
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "Send"}
        </button>
      </div>

      <MobileSheet open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Conversations">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={newChat}
            className="btn-primary h-11 mb-2"
          >
            + New chat
          </button>
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm cursor-pointer ${
                s.id === activeId ? "bg-brand-accent text-white" : "bg-surface"
              }`}
              onClick={() => selectSession(s.id)}
            >
              <span className="truncate flex-1">{s.title || "New chat"}</span>
              <button
                type="button"
                className={`ml-2 text-xs ${s.id === activeId ? "text-white/70" : "text-subink"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(s.id);
                }}
                aria-label="Delete"
              >
                ×
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-xs text-subink py-4 text-center">No chats yet</div>
          )}
        </div>
      </MobileSheet>
    </div>
  );
}

function Bubble({ m }: { m: LiveMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-brand-accent text-white px-3.5 py-2 text-sm whitespace-pre-wrap">
          {m.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] w-full rounded-2xl bg-white border border-line px-3.5 py-2.5 text-ink shadow-soft">
        {m.text ? (
          <Markdown text={m.text} />
        ) : m.streaming ? (
          <div className="flex items-center gap-2 text-subink text-xs">
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-brand-200 animate-pulse [animation-delay:240ms]" />
            </span>
            <span className="italic">thinking…</span>
          </div>
        ) : null}
        {m.charts.map((c, i) => (
          <AgentChart key={i} spec={c} />
        ))}
        {m.images.map((img, i) => (
          <figure key={`img-${i}`} className="mt-2 rounded-lg overflow-hidden border border-line bg-white">
            <img
              src={`data:image/png;base64,${img.png_b64}`}
              alt={img.alt || img.title}
              className="w-full block"
            />
            <figcaption className="px-2 py-1 text-[10px] text-subink">{img.title}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
