import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { logout, useMe } from "../hooks/useAuth";

const STORAGE_KEY = "ft_sidebar_collapsed";

type IconProps = { className?: string };

function HomeIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}

function ListIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="3.5" cy="6" r="1" />
      <circle cx="3.5" cy="12" r="1" />
      <circle cx="3.5" cy="18" r="1" />
    </svg>
  );
}

function WalletIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v2H5a2 2 0 0 0 0 4h15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <circle cx="16" cy="12" r="1" />
    </svg>
  );
}

function StoreIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9l1.5-5h15L21 9" />
      <path d="M4 9v11h16V9" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    </svg>
  );
}

function DocIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  );
}

function TargetIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

function TagIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12L12 4H4v8l8 8 8-8z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </svg>
  );
}

function ShieldIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" />
    </svg>
  );
}

function ChatIcon({ className = "h-4 w-4" }: IconProps) {
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

function LogoutIcon({ className = "h-4 w-4" }: IconProps) {
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

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

const nav: { to: string; label: string; Icon: (p: IconProps) => JSX.Element }[] = [
  { to: "/", label: "Dashboard", Icon: HomeIcon },
  { to: "/transactions", label: "Transactions", Icon: ListIcon },
  { to: "/accounts", label: "Accounts", Icon: WalletIcon },
  { to: "/merchants", label: "Merchants", Icon: StoreIcon },
  { to: "/reports", label: "Reports", Icon: DocIcon },
  { to: "/budgets", label: "Budgets", Icon: TargetIcon },
  { to: "/categories", label: "Categories", Icon: TagIcon },
];

function initialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "1") return true;
  if (saved === "0") return false;
  // No preference yet: default-collapse on smaller laptops/tablets.
  return window.innerWidth < 1024;
}

export default function Layout() {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(initialCollapsed);
  const me = useMe();

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const asideWidth = collapsed ? "w-16" : "w-60";

  return (
    <div className="min-h-screen flex">
      <aside
        className={`${asideWidth} shrink-0 sticky top-0 h-screen self-start border-r border-line bg-surface flex flex-col overflow-y-auto transition-[width] duration-200 ease-out ${collapsed ? "px-2 py-6" : "p-6"}`}
      >
        <div className={`mb-10 flex items-start ${collapsed ? "justify-center" : "justify-between"}`}>
          {collapsed ? (
            <div className="text-lg font-semibold text-ink leading-none mt-1.5">F</div>
          ) : (
            <div>
              <div className="text-xs font-medium text-subink uppercase tracking-widest">Finance</div>
              <div className="text-lg font-semibold text-ink">Tracker</div>
            </div>
          )}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="text-subink hover:text-ink p-1 -mr-1"
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronIcon collapsed={false} />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="mb-4 self-center text-subink hover:text-ink p-1"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronIcon collapsed={true} />
          </button>
        )}

        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              title={collapsed ? n.label : undefined}
              className={({ isActive }) =>
                `rounded-lg text-sm transition flex items-center gap-2 ${
                  collapsed ? "justify-center h-10 w-12 mx-auto" : "px-3 py-2"
                } ${
                  isActive
                    ? "bg-brand-accent text-white"
                    : "text-subink hover:bg-brand-50 hover:text-ink"
                }`
              }
            >
              <n.Icon />
              <span className={collapsed ? "hidden" : "inline"}>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          {me.data?.is_admin && (
            <NavLink
              to="/admin"
              title={collapsed ? "Admin" : undefined}
              className={({ isActive }) =>
                `rounded-lg text-sm transition flex items-center gap-2 ${
                  collapsed ? "justify-center h-10 w-12 mx-auto" : "px-3 py-2"
                } ${
                  isActive
                    ? "bg-brand-accent text-white"
                    : "text-subink hover:bg-brand-50 hover:text-ink"
                }`
              }
            >
              <ShieldIcon />
              <span className={collapsed ? "hidden" : "inline"}>Admin</span>
            </NavLink>
          )}
          <button
            onClick={() => navigate("/chat")}
            title={collapsed ? "Chat" : undefined}
            className={`btn-ghost text-subink ${
              collapsed ? "justify-center h-10 w-12 mx-auto px-0 gap-0" : "w-full justify-start gap-2"
            }`}
          >
            <ChatIcon />
            <span className={collapsed ? "hidden" : "inline"}>Chat</span>
          </button>
          <button
            onClick={logout}
            title={collapsed ? "Log out" : undefined}
            className={`btn-ghost text-subink ${
              collapsed ? "justify-center h-10 w-12 mx-auto px-0 gap-0" : "w-full justify-start gap-2"
            }`}
          >
            <LogoutIcon />
            <span className={collapsed ? "hidden" : "inline"}>Log out</span>
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8 max-w-[1400px]">
        <Outlet />
      </main>
    </div>
  );
}
