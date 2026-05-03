export default function ProgressBar({ value, color = "#C8E6D0" }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2.5 w-full rounded-full bg-white/70 overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
    </div>
  );
}
