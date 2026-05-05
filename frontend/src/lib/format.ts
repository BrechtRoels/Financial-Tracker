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

/** Day-of-month-aware month-window. With startDay=1 == calendar month. */
export function financialMonthWindow(today: Date, startDay: number) {
  const sd = Math.max(1, Math.min(28, Math.round(startDay || 1)));
  let start: Date;
  if (today.getDate() >= sd) {
    start = new Date(today.getFullYear(), today.getMonth(), sd);
  } else {
    start = new Date(today.getFullYear(), today.getMonth() - 1, sd);
  }
  const next = new Date(start.getFullYear(), start.getMonth() + 1, sd);
  const end = new Date(next.getFullYear(), next.getMonth(), next.getDate() - 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
