import { useEffect, useMemo, useState } from "react";
import LinkRefundModal from "./LinkRefundModal";
import Modal from "./Modal";
import Select from "./Select";
import { api } from "../api/client";
import { useAccounts, useCategories, useInvalidate } from "../api/hooks";
import type { Transaction } from "../api/types";
import { fromCents, toCents } from "../lib/format";

const REFUND_CATEGORY_RE = /refund|payback|reimburs|repaid|paid back/i;

type Props = {
  open: boolean;
  onClose: () => void;
  transaction: Transaction | null;
};

type FormState = {
  account_id: string;
  category_id: string;
  amount: string; // signed string, e.g. "-12.34" or "12.34"
  occurred_on: string;
  description: string;
  merchant: string;
};

const empty: FormState = {
  account_id: "",
  category_id: "",
  amount: "",
  occurred_on: "",
  description: "",
  merchant: "",
};

export default function EditTransactionModal({ open, onClose, transaction }: Props) {
  const accounts = useAccounts();
  const categories = useCategories();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<FormState>(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const isTransfer = !!transaction?.transfer_group_id;
  const amountNum = parseFloat(form.amount || "0");
  const isPositive = amountNum > 0;
  const selectedCat = useMemo(
    () =>
      form.category_id
        ? (categories.data ?? []).find((c) => c.id === Number(form.category_id))
        : null,
    [form.category_id, categories.data]
  );
  const isRefundLikeCategory = !!selectedCat && REFUND_CATEGORY_RE.test(selectedCat.name);

  useEffect(() => {
    if (!open || !transaction) {
      setForm(empty);
      return;
    }
    setForm({
      account_id: String(transaction.account_id),
      category_id: transaction.category_id ? String(transaction.category_id) : "",
      amount: fromCents(transaction.amount_cents).toFixed(2),
      occurred_on: transaction.occurred_on,
      description: transaction.description ?? "",
      merchant: transaction.merchant ?? "",
    });
    setErr(null);
  }, [open, transaction]);

  async function save() {
    if (!transaction) return;
    setBusy(true);
    setErr(null);
    try {
      const payload: Record<string, any> = {
        occurred_on: form.occurred_on,
        description: form.description.trim(),
        merchant: form.merchant.trim() || null,
      };
      payload.amount_cents = toCents(parseFloat(form.amount || "0"));
      if (!isTransfer) {
        payload.account_id = Number(form.account_id);
        payload.category_id = form.category_id ? Number(form.category_id) : null;
      }
      await api.patch(`/transactions/${transaction.id}`, payload);
      invalidate("transactions", "accounts", "budgets");
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = (accounts.data ?? []).map((a) => ({
    value: String(a.id),
    label: a.name,
  }));
  const categoryOptions = [
    { value: "", label: "— No category —" },
    ...(categories.data ?? []).map((c) => ({
      value: String(c.id),
      label: c.name,
      swatch: c.color,
    })),
  ];

  return (
    <Modal open={open} onClose={onClose} title="Edit transaction">
      <div className="flex flex-col gap-3">
        {isTransfer && (
          <div className="rounded-lg bg-brand-50 border border-line px-3 py-2 text-xs text-subink">
            Self-transfer. Editing the amount or date updates the matching leg
            on the other account automatically; the account stays locked.
          </div>
        )}

        <div>
          <div className="label mb-1">Account</div>
          <Select
            value={form.account_id}
            onChange={(v) => setForm({ ...form, account_id: v })}
            options={accountOptions}
            disabled={isTransfer}
          />
        </div>

        {!isTransfer && (
          <div>
            <div className="label mb-1">Category</div>
            <Select
              value={form.category_id}
              onChange={(v) => setForm({ ...form, category_id: v })}
              options={categoryOptions}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label mb-1">Amount (EUR)</div>
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <div className="mt-1 text-[11px] text-subink">
              {isTransfer
                ? "Negative on this leg = leaving this account; the partner row mirrors it."
                : "Negative = expense, positive = income"}
            </div>
          </div>
          <div>
            <div className="label mb-1">Date</div>
            <input
              className="input"
              type="date"
              value={form.occurred_on}
              onChange={(e) => setForm({ ...form, occurred_on: e.target.value })}
            />
          </div>
        </div>

        <div>
          <div className="label mb-1">Merchant / Place</div>
          <input
            className="input"
            value={form.merchant}
            onChange={(e) => setForm({ ...form, merchant: e.target.value })}
            placeholder="e.g. Albert Heijn, TC Logan"
          />
        </div>

        <div>
          <div className="label mb-1">Description</div>
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>

        {!isTransfer && isPositive && transaction && (
          <div
            className={`rounded-lg border px-3 py-2.5 text-xs flex items-center justify-between gap-2 ${
              isRefundLikeCategory
                ? "bg-emerald-50 border-emerald-200/70"
                : "bg-brand-50/40 border-line"
            }`}
          >
            <div className="min-w-0">
              <div className="font-medium text-ink">
                {transaction.refund_for_id
                  ? `Linked as refund of expense #${transaction.refund_for_id}`
                  : "Refund of an earlier expense?"}
              </div>
              <div className="text-subink mt-0.5">
                {transaction.refund_for_id
                  ? "The expense's category is mirrored here so totals net out."
                  : isRefundLikeCategory
                    ? "Pick the original expense so it's clear what was paid back."
                    : "Optional — useful for friend paybacks or returned items."}
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost text-xs whitespace-nowrap"
              onClick={() => setLinkOpen(true)}
              disabled={busy}
            >
              {transaction.refund_for_id ? "Change…" : "Link…"}
            </button>
          </div>
        )}

        {err && <div className="text-xs text-neg">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <LinkRefundModal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        refund={transaction}
      />
    </Modal>
  );
}
