import { useState } from "react";

type Props = {
  logoUrl?: string | null;
  name: string;
  size?: number; // px
  className?: string;
};

export default function AccountLogo({ logoUrl, name, size = 36, className = "" }: Props) {
  const [failed, setFailed] = useState(false);

  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={() => setFailed(true)}
        style={{ height: size, width: size }}
        className={`rounded-lg bg-white border border-line object-contain p-1 shrink-0 ${className}`}
        loading="lazy"
      />
    );
  }
  // Initials fallback
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
  return (
    <span
      style={{ height: size, width: size }}
      className={`rounded-lg bg-brand-50 border border-line text-ink flex items-center justify-center text-xs font-semibold shrink-0 ${className}`}
    >
      {initials}
    </span>
  );
}

// Preset Belgian banks (use Clearbit's free logo CDN — no key needed).
// User can also paste any URL manually.
export const BANK_PRESETS: { name: string; url: string }[] = [
  { name: "KBC", url: "https://logo.clearbit.com/kbc.be" },
  { name: "Bolero", url: "https://logo.clearbit.com/bolero.be" },
  { name: "ING", url: "https://logo.clearbit.com/ing.be" },
  { name: "Belfius", url: "https://logo.clearbit.com/belfius.be" },
  { name: "BNP Paribas Fortis", url: "https://logo.clearbit.com/bnpparibasfortis.be" },
  { name: "Argenta", url: "https://logo.clearbit.com/argenta.be" },
  { name: "Crelan", url: "https://logo.clearbit.com/crelan.be" },
  { name: "Bunq", url: "https://logo.clearbit.com/bunq.com" },
  { name: "Revolut", url: "https://logo.clearbit.com/revolut.com" },
  { name: "Wise", url: "https://logo.clearbit.com/wise.com" },
];
