import { useEffect, useMemo, useRef, useState } from "react";
import AgentChart, { ChartSpec } from "../components/AgentChart";
import Markdown from "../components/Markdown";
import Select from "../components/Select";
import ToolsModal from "../components/ToolsModal";
import {
  ChatMessage,
  ChatModelOption,
  ChatSession,
  createSession,
  deleteSession,
  getChatConfig,
  ImageArtifact,
  listChatModels,
  listMessages,
  listSessions,
  streamChat,
} from "../api/chat";

const MODEL_STORAGE_KEY = "ft_chat_model";

type LiveMessage = {
  role: "user" | "assistant";
  text: string;
  charts: ChartSpec[];
  images: ImageArtifact[];
  toolCalls: { tool: string; args?: Record<string, any> }[];
  streaming?: boolean;
};

function historyToLive(rows: ChatMessage[]): LiveMessage[] {
  return rows.map((m) => ({
    role: m.role as "user" | "assistant",
    text: m.content,
    charts: (m.chart_spec as ChartSpec[] | undefined) ?? [],
    images: (m.images as ImageArtifact[] | undefined) ?? [],
    toolCalls: [],
  }));
}

export default function Chat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [models, setModels] = useState<ChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(
    () => localStorage.getItem(MODEL_STORAGE_KEY) || ""
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listSessions().then(setSessions).catch(() => setSessions([]));
    Promise.all([listChatModels(), getChatConfig()])
      .then(([ms, cfg]) => {
        setModels(ms);
        const valid = new Set(ms.map((m) => m.id));
        if (!selectedModel || !valid.has(selectedModel)) {
          setSelectedModel(cfg.default_model);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedModel) localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function selectSession(id: number) {
    if (busy) return;
    setActiveId(id);
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
      { role: "user", text, charts: [], images: [], toolCalls: [] },
      { role: "assistant", text: "", charts: [], images: [], toolCalls: [], streaming: true },
    ]);

    try {
      await streamChat(
        sessionId!,
        text,
        (ev) => {
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
                  ? "Querying database…"
                  : ev.tool === "render_chart"
                  ? "Drawing chart…"
                  : `Calling ${ev.tool}…`
              );
              updated.toolCalls = [...updated.toolCalls, { tool: ev.tool, args: ev.args }];
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
        },
        { model: selectedModel || undefined }
      );
      // If no text_delta arrived during the stream (some models batch the
      // final response), reload messages from the server so the assistant
      // bubble picks up its persisted content.
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
      // refresh session list (title may have been set from first message)
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
      "Show my net worth per month as a line chart.",
      "Bar chart of spending by category for March.",
      "Top 5 merchants I spent at.",
    ],
    []
  );

  return (
    <div className="flex gap-4 h-[calc(100vh-4rem)]">
      <aside className="w-64 shrink-0 flex flex-col gap-2">
        <button className="btn-primary" onClick={newChat}>
          + New chat
        </button>
        <div className="flex-1 overflow-auto flex flex-col gap-1 mt-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center justify-between rounded-lg px-3 py-2 text-sm cursor-pointer transition ${
                s.id === activeId ? "bg-brand-accent text-white" : "hover:bg-brand-50"
              }`}
              onClick={() => selectSession(s.id)}
            >
              <span className="truncate flex-1">{s.title || "New chat"}</span>
              <button
                className={`ml-2 opacity-0 group-hover:opacity-100 text-xs ${
                  s.id === activeId ? "text-white/70" : "text-subink"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(s.id);
                }}
                title="Delete"
              >
                ×
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-xs text-subink px-3 py-4 text-center">No chats yet</div>
          )}
        </div>
      </aside>

      <section className="flex-1 card flex flex-col relative">
        <header className="mb-3 pb-3 border-b border-line flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Ask about your finances</h1>
            <p className="text-xs text-subink">
              The agent runs read-only SQL against your data and can draw charts. Try a follow-up to refine.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden md:inline text-xs text-subink">
              {models.find((m) => m.id === selectedModel)?.label ?? selectedModel}
            </span>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => setSettingsOpen((v) => !v)}
              title="Chat settings"
            >
              ⚙ Settings
            </button>
          </div>
        </header>

        {settingsOpen && (
          <div className="absolute top-14 right-4 w-80 rounded-xl bg-white border border-line shadow-pop p-4 z-20">
            <div className="flex items-center justify-between mb-3">
              <div className="font-medium text-sm">Chat settings</div>
              <button className="text-subink text-sm" onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </div>
            <div className="label mb-1">Model</div>
            <Select
              value={selectedModel}
              onChange={(v) => setSelectedModel(v)}
              options={models.map((m) => ({ value: m.id, label: m.label }))}
              disabled={busy}
            />
            {(() => {
              const hint = models.find((m) => m.id === selectedModel)?.hint;
              return hint ? (
                <div className="mt-2 text-xs text-subink">{hint}</div>
              ) : null;
            })()}
            <div className="mt-3 text-[11px] text-subink">
              Stored locally. Applies to the next message you send.
            </div>
            <div className="mt-4 pt-3 border-t border-line">
              <button
                className="btn-ghost w-full text-xs"
                onClick={() => {
                  setSettingsOpen(false);
                  setToolsOpen(true);
                }}
              >
                Manage custom tools…
              </button>
            </div>
          </div>
        )}

        <ToolsModal
          open={toolsOpen}
          onClose={() => setToolsOpen(false)}
          model={selectedModel || undefined}
        />

        <div ref={scrollRef} className="flex-1 overflow-auto flex flex-col gap-4 pr-1">
          {messages.length === 0 && (
            <div className="flex flex-col gap-2 text-sm">
              <div className="text-subink">Try one of these:</div>
              <div className="flex flex-wrap gap-2">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    className="chip bg-brand-50 hover:bg-brand-100 border border-line px-3 py-1.5"
                    onClick={() => setInput(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <MessageBubble key={i} m={m} />
          ))}
          {busy && status && (
            <div className="text-xs text-subink italic">{status}</div>
          )}
          {err && <div className="text-sm text-neg">{err}</div>}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            className="input flex-1"
            placeholder="Ask a question about your money…"
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
          <button className="btn-primary" onClick={send} disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </section>
    </div>
  );
}

function MessageBubble({ m }: { m: LiveMessage }) {
  const isUser = m.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-brand-accent text-white px-4 py-2.5 text-sm whitespace-pre-wrap">
          {m.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-full">
        {m.toolCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wider text-subink">
            <span>Tools</span>
            {m.toolCalls.map((c, i) => (
              <span
                key={i}
                className="chip bg-white border border-line text-[10px] px-2 py-0.5"
              >
                {c.tool === "sql_query" ? "SQL" : c.tool === "render_chart" ? "chart" : c.tool}
              </span>
            ))}
          </div>
        )}
        <div className="rounded-2xl bg-white border border-line px-4 py-3 text-ink shadow-soft">
          {m.text ? (
            <Markdown text={m.text} />
          ) : m.streaming ? (
            <div className="flex items-center gap-2 text-subink text-sm">
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
            <figure key={`img-${i}`} className="mt-3 rounded-lg overflow-hidden border border-line bg-white">
              <img
                src={`data:image/png;base64,${img.png_b64}`}
                alt={img.alt || img.title}
                className="w-full block"
              />
              <figcaption className="px-3 py-1.5 text-xs text-subink flex items-center justify-between">
                <span>{img.title}</span>
                <a
                  href={`data:image/png;base64,${img.png_b64}`}
                  download={`${img.title.replace(/\s+/g, "_")}.png`}
                  className="text-brand-accent hover:underline"
                >
                  Download PNG
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
