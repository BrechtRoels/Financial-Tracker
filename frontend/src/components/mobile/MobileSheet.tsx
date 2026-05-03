import { ReactNode, useEffect } from "react";

export default function MobileSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end bg-brand-900/40"
      onClick={onClose}
    >
      <div
        className="w-full max-h-[90vh] rounded-t-2xl bg-surface border-t border-line shadow-pop flex flex-col animate-[slideUp_180ms_ease-out]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-2 pb-1 flex flex-col items-center">
          <div className="h-1 w-10 rounded-full bg-line" />
        </div>
        {title && (
          <div className="px-5 pt-2 pb-3 flex items-center justify-between border-b border-line">
            <div className="text-base font-semibold">{title}</div>
            <button
              type="button"
              className="text-subink p-1 -mr-1"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        <div className="px-5 py-4 overflow-auto">{children}</div>
      </div>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
