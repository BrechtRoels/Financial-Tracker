import { useState } from "react";
import { NavLink } from "react-router-dom";
import AddTransactionSheet from "./AddTransactionSheet";

type IconProps = { className?: string };

function HomeIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}

function ListIcon({ className = "h-5 w-5" }: IconProps) {
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

function ChatIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function MoreIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TabLink({
  to,
  label,
  Icon,
  end,
}: {
  to: string;
  label: string;
  Icon: (p: IconProps) => JSX.Element;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 min-w-[44px] min-h-[44px] flex-1 transition ${
          isActive ? "text-brand-accent" : "text-subink"
        }`
      }
    >
      <Icon />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </NavLink>
  );
}

export default function BottomTabBar() {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 bg-surface border-t border-line flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <TabLink to="/" label="Home" Icon={HomeIcon} end />
        <TabLink to="/transactions" label="Activity" Icon={ListIcon} />

        <div className="flex-1 flex items-start justify-center relative">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="absolute -top-5 h-12 w-12 rounded-full bg-brand-accent text-white shadow-pop flex items-center justify-center active:scale-95 transition"
            aria-label="Add transaction"
            title="Add transaction"
          >
            <PlusIcon />
          </button>
        </div>

        <TabLink to="/chat" label="Chat" Icon={ChatIcon} />
        <TabLink to="/more" label="More" Icon={MoreIcon} />
      </nav>

      <AddTransactionSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}
