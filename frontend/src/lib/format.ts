const eur = new Intl.NumberFormat("nl-BE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

export const fromCents = (cents: number) => cents / 100;
export const toCents = (amount: number) => Math.round(amount * 100);
export const formatEUR = (cents: number) => eur.format(fromCents(cents));
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const monthStart = (d: Date = new Date()) =>
  new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
