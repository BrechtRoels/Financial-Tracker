import { api, getToken } from "./client";
import type { ChartSpec } from "../components/AgentChart";

export type ChatSession = {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_name?: string | null;
  tool_args?: Record<string, any> | null;
  tool_result?: any;
  chart_spec?: ChartSpec[] | null;
  images?: ImageArtifact[] | null;
  created_at: string;
};

export type ChatModelOption = {
  id: string;
  label: string;
  hint: string;
};

export type ChatConfig = {
  default_model: string;
  enabled: boolean;
};

export async function listChatModels(): Promise<ChatModelOption[]> {
  return (await api.get("/chat/models")).data;
}

export type CustomToolParam = {
  name: string;
  type: string;
  description: string;
};

export type ToolKind = "sql_rows" | "sql_chart_png";

export type ChartConfig = {
  chart_type: "bar" | "line" | "area" | "pie";
  x_column: string;
  y_columns: string[];
  title?: string;
};

export type CustomTool = {
  id: number;
  name: string;
  description: string;
  kind: ToolKind;
  sql_template: string;
  parameters: CustomToolParam[];
  config?: ChartConfig | null;
  created_at?: string;
};

export type CustomToolUpsert = {
  name: string;
  description: string;
  kind: ToolKind;
  sql_template: string;
  parameters: CustomToolParam[];
  config?: ChartConfig | null;
};

export type ImageArtifact = {
  title: string;
  alt: string;
  png_b64: string;
};

export async function listTools(): Promise<CustomTool[]> {
  return (await api.get("/chat/tools")).data;
}
export async function createTool(payload: CustomToolUpsert): Promise<CustomTool> {
  return (await api.post("/chat/tools", payload)).data;
}
export async function updateTool(id: number, payload: CustomToolUpsert): Promise<CustomTool> {
  return (await api.patch(`/chat/tools/${id}`, payload)).data;
}
export async function deleteTool(id: number): Promise<void> {
  await api.delete(`/chat/tools/${id}`);
}
export async function draftTool(prompt: string, model?: string): Promise<CustomToolUpsert> {
  return (await api.post("/chat/tools/draft", { prompt, model })).data;
}

export async function getChatConfig(): Promise<ChatConfig> {
  return (await api.get("/chat/config")).data;
}

export type StreamEvent =
  | { stage: "thinking" }
  | { stage: "tool_call"; tool: string; args: Record<string, any> }
  | { stage: "tool_result"; tool: string; ok: boolean; rows?: number }
  | { stage: "text_delta"; text: string }
  | { stage: "chart"; chart: ChartSpec }
  | { stage: "image"; image: ImageArtifact }
  | { stage: "done"; message_id: number }
  | { stage: "error"; detail: string };

export async function listSessions(): Promise<ChatSession[]> {
  return (await api.get("/chat/sessions")).data;
}

export async function createSession(): Promise<ChatSession> {
  return (await api.post("/chat/sessions")).data;
}

export async function deleteSession(id: number): Promise<void> {
  await api.delete(`/chat/sessions/${id}`);
}

export async function listMessages(sessionId: number): Promise<ChatMessage[]> {
  return (await api.get(`/chat/sessions/${sessionId}/messages`)).data;
}

export async function streamChat(
  sessionId: number,
  message: string,
  onEvent: (e: StreamEvent) => void,
  opts: { model?: string } = {}
): Promise<void> {
  const resp = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken() ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, model: opts.model }),
  });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line) as StreamEvent;
        onEvent(ev);
      } catch {
        // ignore malformed lines
      }
    }
  }
}
