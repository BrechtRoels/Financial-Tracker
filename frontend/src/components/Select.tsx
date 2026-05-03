import { useEffect, useRef, useState } from "react";

export type SelectOption = {
  value: string | number;
  label: string;
  swatch?: string;
};

type Props = {
  value: string | number | "";
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export default function Select({ value, onChange, options, placeholder = "Select", disabled, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<number>(-1);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => String(o.value) === String(value));

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setFocused((f) => Math.min(options.length - 1, f + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setFocused((f) => Math.max(0, f - 1));
          } else if (e.key === "Enter" && open && focused >= 0) {
            e.preventDefault();
            onChange(String(options[focused].value));
            setOpen(false);
          }
        }}
        className={`input flex items-center justify-between gap-2 text-left ${
          open ? "border-brand-accent ring-2 ring-brand-accent/15" : ""
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">
          {current?.swatch && (
            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: current.swatch }} />
          )}
          <span className={`truncate ${current ? "" : "text-subink"}`}>
            {current?.label ?? placeholder}
          </span>
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-subink transition ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.24 4.38a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 mt-1.5 w-full rounded-xl bg-surface border border-line shadow-pop py-1 max-h-64 overflow-auto">
          {options.length === 0 && (
            <div className="px-4 py-3 text-sm text-subink">No options</div>
          )}
          {options.map((o, i) => {
            const selected = String(o.value) === String(value);
            return (
              <button
                key={o.value}
                type="button"
                onMouseEnter={() => setFocused(i)}
                onClick={() => {
                  onChange(String(o.value));
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3.5 py-2 text-sm text-left transition ${
                  selected ? "bg-brand-50 font-medium" : focused === i ? "bg-brand-50/60" : ""
                }`}
              >
                {o.swatch && (
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: o.swatch }} />
                )}
                <span className="truncate">{o.label}</span>
                {selected && (
                  <svg className="ml-auto h-4 w-4 text-brand-accent" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
