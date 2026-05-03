import { useLocation } from "react-router-dom";
import { logout } from "../../hooks/useAuth";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/transactions": "Transactions",
  "/accounts": "Accounts",
  "/chat": "Chat",
  "/more": "More",
  "/merchants": "Merchants",
  "/reports": "Reports",
  "/budgets": "Budgets",
  "/categories": "Categories",
};

function LogoutIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function MobileTopBar() {
  const loc = useLocation();
  const title = TITLES[loc.pathname] ?? "Finance Tracker";

  return (
    <header
      className="sticky top-0 z-40 h-14 bg-surface border-b border-line flex items-center justify-between px-4"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="text-base font-semibold text-ink">{title}</div>
      <button
        type="button"
        onClick={logout}
        className="text-subink hover:text-ink p-1.5"
        aria-label="Log out"
        title="Log out"
      >
        <LogoutIcon />
      </button>
    </header>
  );
}
