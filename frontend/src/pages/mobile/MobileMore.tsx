import { Link } from "react-router-dom";
import { logout, useMe } from "../../hooks/useAuth";

const baseLinks: { to: string; label: string; hint?: string }[] = [
  { to: "/accounts", label: "Accounts", hint: "Balances + holdings" },
  { to: "/merchants", label: "Merchants", hint: "Where your money goes" },
  { to: "/budgets", label: "Budgets", hint: "Per-category limits" },
  { to: "/categories", label: "Categories", hint: "Income & expense tags" },
  { to: "/reports", label: "Reports", hint: "Monthly written summary" },
];

function ChevronRight() {
  return (
    <svg className="h-4 w-4 text-subink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function MobileMore() {
  const me = useMe();
  const links = me.data?.is_admin
    ? [...baseLinks, { to: "/admin", label: "Admin", hint: "Models + AI access" }]
    : baseLinks;
  return (
    <div className="flex flex-col gap-4">
      <div className="card p-0 overflow-hidden">
        <ul className="flex flex-col divide-y divide-line">
          {links.map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                className="flex items-center justify-between px-4 py-3.5 active:bg-brand-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{l.label}</div>
                  {l.hint && <div className="text-[11px] text-subink">{l.hint}</div>}
                </div>
                <ChevronRight />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={logout}
        className="btn-ghost h-12 w-full text-neg justify-center"
      >
        Log out
      </button>

      <div className="text-center text-[11px] text-subink mt-4">
        Pages above use the desktop layout — pinch to zoom.
      </div>
    </div>
  );
}
