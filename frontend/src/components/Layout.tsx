import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { logout } from "../hooks/useAuth";

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/transactions", label: "Transactions" },
  { to: "/accounts", label: "Accounts" },
  { to: "/merchants", label: "Merchants" },
  { to: "/reports", label: "Reports" },
  { to: "/budgets", label: "Budgets" },
  { to: "/categories", label: "Categories" },
];

function ChatIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function LogoutIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-line bg-surface p-6 flex flex-col">
        <div className="mb-10">
          <div className="text-xs font-medium text-subink uppercase tracking-widest">Finance</div>
          <div className="text-lg font-semibold text-ink">Tracker</div>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm transition ${
                  isActive
                    ? "bg-brand-accent text-white"
                    : "text-subink hover:bg-brand-50 hover:text-ink"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          <button
            onClick={() => navigate("/chat")}
            className="btn-ghost w-full justify-start gap-2 text-subink"
          >
            <ChatIcon />
            Chat
          </button>
          <button
            onClick={logout}
            className="btn-ghost w-full justify-start gap-2 text-subink"
          >
            <LogoutIcon />
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 max-w-[1400px]">
        <Outlet />
      </main>
    </div>
  );
}
