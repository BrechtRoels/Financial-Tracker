import { Outlet } from "react-router-dom";
import { logout } from "../hooks/useAuth";

export default function AdminShell() {
  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header
        className="sticky top-0 z-40 bg-surface border-b border-line px-4 sm:px-6 py-3 flex items-center justify-between"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div>
          <div className="text-[10px] font-medium text-subink uppercase tracking-widest">
            Finance Tracker
          </div>
          <div className="text-base font-semibold text-ink">Admin Console</div>
        </div>
        <button type="button" onClick={logout} className="btn-ghost text-subink text-sm">
          Log out
        </button>
      </header>
      <main className="flex-1 px-4 sm:px-6 py-5 w-full max-w-4xl mx-auto">
        <Outlet />
      </main>
    </div>
  );
}
