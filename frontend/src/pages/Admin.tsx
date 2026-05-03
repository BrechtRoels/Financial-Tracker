import { useEffect, useState } from "react";
import Select from "../components/Select";
import {
  AdminSettings,
  AdminUser,
  fetchAdminSettings,
  fetchAdminUsers,
  updateAdminSettings,
  updateAdminUser,
} from "../api/admin";
import { formatDate } from "../lib/format";

export default function Admin() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [busyUser, setBusyUser] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedHint, setSavedHint] = useState<string | null>(null);

  const [chatModel, setChatModel] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [visionModel, setVisionModel] = useState("");

  useEffect(() => {
    setLoadingSettings(true);
    fetchAdminSettings()
      .then((s) => {
        setSettings(s);
        setChatModel(s.chat_model);
        setLlmModel(s.llm_model);
        setVisionModel(s.vision_model);
      })
      .catch((e) => setErr(e.response?.data?.detail ?? e.message ?? "Load failed"))
      .finally(() => setLoadingSettings(false));
    setLoadingUsers(true);
    fetchAdminUsers()
      .then(setUsers)
      .catch((e) => setErr(e.response?.data?.detail ?? e.message ?? "Load failed"))
      .finally(() => setLoadingUsers(false));
  }, []);

  async function saveSettings() {
    setSavingSettings(true);
    setErr(null);
    setSavedHint(null);
    try {
      const updated = await updateAdminSettings({
        chat_model: chatModel,
        llm_model: llmModel,
        vision_model: visionModel,
      });
      setSettings(updated);
      setSavedHint("Settings saved.");
      setTimeout(() => setSavedHint(null), 2500);
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    } finally {
      setSavingSettings(false);
    }
  }

  async function toggleUserAi(u: AdminUser) {
    setBusyUser(u.id);
    setErr(null);
    try {
      const updated = await updateAdminUser(u.id, { ai_enabled: !u.ai_enabled });
      setUsers((xs) => xs.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Update failed");
    } finally {
      setBusyUser(null);
    }
  }

  const modelOptions = (settings?.available_models ?? []).map((m) => ({
    value: m.id,
    label: m.label,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-subink">Pick the AI models and decide who can use AI.</p>
      </header>

      <section className="card flex flex-col gap-4">
        <div>
          <h2 className="font-medium">AI models</h2>
          <p className="text-xs text-subink">
            Applied to every user. Changing here doesn't redeploy — the next AI request picks up the new value.
          </p>
        </div>

        {loadingSettings && <div className="text-sm text-subink">Loading…</div>}

        {settings && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ModelPicker
              label="Chat model"
              hint="Used by the /chat agent (multi-step reasoning + tools)."
              value={chatModel}
              onChange={setChatModel}
              options={modelOptions}
              models={settings.available_models}
            />
            <ModelPicker
              label="LLM model"
              hint="Used for batch text tasks (CSV enrichment, merchant canonicalization)."
              value={llmModel}
              onChange={setLlmModel}
              options={modelOptions}
              models={settings.available_models}
            />
            <ModelPicker
              label="Vision model"
              hint="Used by the receipt-scan endpoint."
              value={visionModel}
              onChange={setVisionModel}
              options={modelOptions}
              models={settings.available_models}
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {savedHint && <span className="text-xs text-pos">{savedHint}</span>}
          <span className="flex-1" />
          <button
            type="button"
            className="btn-primary"
            onClick={saveSettings}
            disabled={savingSettings || loadingSettings}
          >
            {savingSettings ? "Saving…" : "Save settings"}
          </button>
        </div>
      </section>

      <section className="card flex flex-col gap-3">
        <div>
          <h2 className="font-medium">Users</h2>
          <p className="text-xs text-subink">
            Toggle AI access per user. Disabled users keep all non-AI features (transactions, accounts, budgets).
          </p>
        </div>

        {loadingUsers && <div className="text-sm text-subink">Loading…</div>}

        {!loadingUsers && users.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {users.map((u) => (
              <li key={u.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {u.email}
                    {u.is_admin && (
                      <span className="chip ml-2 bg-tag-mist text-[10px] px-1.5 py-0">admin</span>
                    )}
                  </div>
                  <div className="text-[11px] text-subink">
                    Joined {formatDate(u.created_at)}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-subink shrink-0">
                  <input
                    type="checkbox"
                    checked={u.ai_enabled}
                    onChange={() => toggleUserAi(u)}
                    disabled={busyUser === u.id}
                    className="h-4 w-4 accent-brand-accent"
                  />
                  AI enabled
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {err && <div className="text-sm text-neg">{err}</div>}
    </div>
  );
}

function ModelPicker({
  label,
  hint,
  value,
  onChange,
  options,
  models,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  models: { id: string; label: string; hint: string }[];
}) {
  const selected = models.find((m) => m.id === value);
  return (
    <div className="flex flex-col gap-1">
      <div className="label">{label}</div>
      <Select value={value} onChange={onChange} options={options} />
      <div className="text-[11px] text-subink">{hint}</div>
      {selected && <div className="text-[11px] text-subink/80 italic">{selected.hint}</div>}
    </div>
  );
}
