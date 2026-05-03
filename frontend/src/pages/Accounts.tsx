import { useEffect, useState } from "react";
import AccountLogo, { BANK_PRESETS } from "../components/AccountLogo";
import HoldingsSection from "../components/HoldingsSection";
import Modal from "../components/Modal";
import Select from "../components/Select";
import { api } from "../api/client";
import { useAccounts, useMutateResource } from "../api/hooks";
import { ACCOUNT_TYPES, Account } from "../api/types";
import { formatEUR, fromCents, toCents } from "../lib/format";

const ACCOUNT_OPTIONS = ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }));

type FormState = {
  name: string;
  type: string;
  iban: string;
  logo_url: string;
  opening: string;
};

const emptyForm: FormState = {
  name: "",
  type: "checking",
  iban: "",
  logo_url: "",
  opening: "0",
};

export default function Accounts() {
  const { data } = useAccounts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        type: editing.type,
        iban: editing.iban ?? "",
        logo_url: editing.logo_url ?? "",
        opening: fromCents(editing.opening_balance_cents).toFixed(2),
      });
    } else {
      setForm(emptyForm);
    }
  }, [editing, open]);

  const create = useMutateResource(
    (v: any) => api.post("/accounts", v).then((r) => r.data),
    ["accounts"]
  );
  const update = useMutateResource(
    ({ id, ...v }: any) => api.patch(`/accounts/${id}`, v).then((r) => r.data),
    ["accounts"]
  );

  async function submit() {
    const payload = {
      name: form.name,
      type: form.type,
      iban: form.iban.trim() || null,
      logo_url: form.logo_url.trim() || null,
      opening_balance_cents: toCents(parseFloat(form.opening || "0")),
    };
    if (editing) await update.mutateAsync({ id: editing.id, ...payload });
    else await create.mutateAsync(payload);
    setOpen(false);
    setEditing(null);
  }

  function openCreate() {
    setEditing(null);
    setOpen(true);
  }

  function openEdit(a: Account) {
    setEditing(a);
    setOpen(true);
  }

  const assets = (data ?? []).filter((a) => a.is_asset);
  const liab = (data ?? []).filter((a) => !a.is_asset);
  const totalAssets = assets.reduce((s, a) => s + a.balance_cents, 0);
  const totalLiab = liab.reduce((s, a) => s + Math.abs(a.balance_cents), 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Accounts</h1>
          <p className="text-sm text-subink">
            Add IBANs so transfers between your own accounts are auto-detected on import.
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          + Add account
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="label">Assets</div>
          <div className="mt-2 text-2xl font-semibold">{formatEUR(totalAssets)}</div>
        </div>
        <div className="card">
          <div className="label">Liabilities</div>
          <div className="mt-2 text-2xl font-semibold">{formatEUR(totalLiab)}</div>
        </div>
        <div className="card bg-brand-accent border-brand-accent text-white">
          <div className="text-xs font-medium uppercase tracking-wide text-white/70">Net worth</div>
          <div className="mt-2 text-2xl font-semibold">{formatEUR(totalAssets - totalLiab)}</div>
        </div>
      </div>

      <Section title="Assets" list={assets} onEdit={openEdit} />
      <Section title="Liabilities" list={liab} onEdit={openEdit} />

      <HoldingsSection />

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.name}` : "New account"}
      >
        <div className="flex flex-col gap-3">
          <div>
            <div className="label mb-1">Name</div>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <div className="label mb-1">Type</div>
            <Select
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={ACCOUNT_OPTIONS}
            />
          </div>
          <div>
            <div className="label mb-1">IBAN (optional)</div>
            <input
              className="input font-mono tracking-wide"
              placeholder="BE00 0000 0000 0000"
              value={form.iban}
              onChange={(e) => setForm({ ...form, iban: e.target.value })}
            />
            <div className="mt-1 text-xs text-subink">
              Used to auto-detect transfers between your own accounts on CSV import.
            </div>
          </div>
          <div>
            <div className="label mb-1">Logo (optional)</div>
            <div className="flex items-center gap-3">
              <AccountLogo logoUrl={form.logo_url || null} name={form.name || "?"} size={44} />
              <input
                className="input flex-1 text-xs font-mono"
                placeholder="https://logo.example.com/logo.png"
                value={form.logo_url}
                onChange={(e) => setForm({ ...form, logo_url: e.target.value })}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {BANK_PRESETS.map((b) => (
                <button
                  type="button"
                  key={b.name}
                  onClick={() => setForm({ ...form, logo_url: b.url })}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition ${
                    form.logo_url === b.url
                      ? "border-brand-accent bg-brand-50"
                      : "border-line hover:bg-brand-50/50"
                  }`}
                  title={b.name}
                >
                  <img
                    src={b.url}
                    alt=""
                    className="h-4 w-4 rounded object-contain"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  {b.name}
                </button>
              ))}
              {form.logo_url && (
                <button
                  type="button"
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-subink hover:bg-brand-50/50"
                  onClick={() => setForm({ ...form, logo_url: "" })}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div>
            <div className="label mb-1">Opening balance (EUR)</div>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.opening}
              onChange={(e) => setForm({ ...form, opening: e.target.value })}
            />
          </div>
          <button className="btn-primary mt-2" onClick={submit} disabled={!form.name}>
            {editing ? "Save changes" : "Create"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function formatIbanDisplay(iban: string | null): string | null {
  if (!iban) return null;
  return iban.replace(/(.{4})/g, "$1 ").trim();
}

function Section({
  title,
  list,
  onEdit,
}: {
  title: string;
  list: Account[];
  onEdit: (a: Account) => void;
}) {
  if (!list?.length) return null;
  return (
    <div>
      <h2 className="text-sm font-medium text-subink mb-3 uppercase tracking-wide">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {list.map((a) => (
          <button
            key={a.id}
            onClick={() => onEdit(a)}
            className="card text-left hover:border-brand-accent transition"
          >
            <div className="flex items-start gap-3">
              <AccountLogo logoUrl={a.logo_url} name={a.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{a.name}</div>
                <div className="text-xs text-subink capitalize">{a.type.replace("_", " ")}</div>
                {a.iban && (
                  <div className="mt-1 text-[11px] font-mono text-subink truncate">
                    {formatIbanDisplay(a.iban)}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="font-semibold tabular-nums">{formatEUR(a.balance_cents)}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
