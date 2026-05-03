type Props = {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
};

export default function StatCard({ label, value, accent = "#1E3A5F", hint }: Props) {
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />
      <div className="pl-3">
        <div className="label">{label}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        {hint && <div className="mt-1 text-xs text-subink">{hint}</div>}
      </div>
    </div>
  );
}
