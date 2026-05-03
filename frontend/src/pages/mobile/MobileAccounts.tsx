import { Link } from "react-router-dom";
import { useAccounts, useHoldings } from "../../api/hooks";
import { formatEUR } from "../../lib/format";

const TYPE_LABEL: Record<string, string> = {
  cash: "Cash",
  checking: "Checking",
  savings: "Savings",
  investment: "Investment",
  meal_vouchers: "Meal vouchers",
  credit_card: "Credit card",
  loan: "Loan",
  other: "Other",
};

export default function MobileAccounts() {
  const accounts = useAccounts();
  const holdings = useHoldings();

  const list = (accounts.data ?? []).filter((a) => !a.archived);

  return (
    <div className="flex flex-col gap-3">
      {list.map((a) => {
        const accountHoldings = (holdings.data ?? []).filter((h) => h.account_id === a.id);
        const total = a.balance_cents + a.holdings_value_cents;

        return (
          <Link
            key={a.id}
            to={`/transactions?account_id=${a.id}`}
            className="card p-4 flex flex-col gap-2 active:bg-brand-50"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                {a.logo_url && (
                  <img
                    src={a.logo_url}
                    alt=""
                    className="h-8 w-8 rounded-md object-contain bg-white border border-line p-0.5"
                  />
                )}
                <div className="min-w-0">
                  <div className="font-medium text-ink truncate">{a.name}</div>
                  <div className="text-[11px] text-subink">{TYPE_LABEL[a.type] ?? a.type}</div>
                </div>
              </div>
              <div
                className={`text-base font-semibold tabular-nums whitespace-nowrap ${
                  total < 0 ? "text-neg" : "text-ink"
                }`}
              >
                {formatEUR(total)}
              </div>
            </div>

            {a.type === "investment" && a.holdings_value_cents !== 0 && (
              <div className="text-[11px] text-subink flex items-center gap-2">
                <span>Cash {formatEUR(a.balance_cents)}</span>
                <span>·</span>
                <span>Holdings {formatEUR(a.holdings_value_cents)}</span>
              </div>
            )}

            {accountHoldings.length > 0 && (
              <ul className="mt-1 flex flex-col gap-1 text-xs">
                {accountHoldings.slice(0, 4).map((h) => (
                  <li key={h.id} className="flex items-center justify-between">
                    <span className="text-subink truncate">
                      {h.symbol}
                      {h.name ? ` · ${h.name}` : ""}
                    </span>
                    <span className="tabular-nums text-ink">
                      {formatEUR(h.market_value_cents)}
                    </span>
                  </li>
                ))}
                {accountHoldings.length > 4 && (
                  <li className="text-[11px] text-subink">+{accountHoldings.length - 4} more</li>
                )}
              </ul>
            )}
          </Link>
        );
      })}

      {list.length === 0 && (
        <div className="card p-8 text-center text-subink text-sm">
          No accounts yet. Add one from the desktop view (Accounts page).
        </div>
      )}
    </div>
  );
}
