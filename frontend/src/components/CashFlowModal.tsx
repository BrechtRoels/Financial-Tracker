import { useEffect, useState } from "react";
import Modal from "./Modal";
import { api } from "../api/client";
import { useInvalidate } from "../api/hooks";
import { toCents, todayISO } from "../lib/format";

type Props = {
  open: boolean;
  onClose: () => void;
  accountId: number;
  accountName: string;
};

type Direction = "deposit" | "withdraw";

export default function CashFlowModal({ open, onClose, accountId, accountName }: Props) {
  const invalidate = useInvalidate();
  const [direction, setDirection] = useState<Direction>("deposit");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDirection("deposit");
    setAmount("");
    setOccurredOn(todayISO());
    setDescription("");
    setErr(null);
  }, [open]);

  async function save() {
    if (!parseFloat(amount || "0")) return;
    setBusy(true);
    setErr(null);
    try {
      const cents = toCents(parseFloat(amount));
      await api.post("/transactions", {
        account_id: accountId,
        category_id: null,
        amount_cents: direction === "deposit" ? cents : -cents,
        occurred_on: occurredOn,
        description:
          description.trim() || (direction === "deposit" ? "Cash deposit" : "Cash withdrawal"),
      });
      invalidate("transactions", "accounts");
      onClose();
    } catch (e: any) {
      setErr(e.response?.data?.detail ?? e.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Cash flow · ${accountName}`}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-subink">
          Record uninvested cash moving in or out of this account. Creates a regular transaction
          you can later edit on the Transactions page.
        </p>

        <div className="inline-flex rounded-lg border border-line p-0.5 bg-brand-50/50 self-start">
          {(["deposit", "withdraw"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setDirection(k)}
              className={`px-3 py-1.5 text-sm rounded-md capitalize transition ${
                direction === k ? "bg-white shadow-soft text-ink" : "text-subink"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="label mb-1">Amount (EUR)</div>
            <input
              className="input"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <div className="label mb-1">Date</div>
            <input
              className="input"
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="label mb-1">Description (optional)</div>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={direction === "deposit" ? "e.g. Bank transfer in" : "e.g. Withdrawal to checking"}
          />
        </div>

        {err && <div className="text-xs text-neg">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={busy || !parseFloat(amount || "0")}
          >
            {busy ? "Saving…" : direction === "deposit" ? "Deposit" : "Withdraw"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
