import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartSpec = {
  type: "bar" | "line" | "area" | "pie";
  title: string;
  x_key: string;
  y_keys: string[];
  data: Record<string, any>[];
  colors?: string[];
  stacked?: boolean;
  y_format?: "eur" | "number" | "percent";
};

const PALETTE = ["#1E3A5F", "#2C5282", "#475569", "#64748B", "#94A3B8", "#CBD5E1"];

function fmtY(v: number, kind?: string) {
  if (v === undefined || v === null || Number.isNaN(v)) return String(v);
  if (kind === "eur") return `€${Number(v).toLocaleString("nl-BE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  if (kind === "percent") return `${(Number(v) * 100).toFixed(1)}%`;
  return Number(v).toLocaleString("nl-BE");
}

export default function AgentChart({ spec }: { spec: ChartSpec }) {
  const colors = spec.colors && spec.colors.length > 0 ? spec.colors : PALETTE;
  const yFmt = (v: number) => fmtY(v, spec.y_format);

  if (spec.type === "pie") {
    const key = spec.y_keys[0];
    return (
      <div className="card mt-3">
        <div className="text-sm font-medium mb-2">{spec.title}</div>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={spec.data}
                dataKey={key}
                nameKey={spec.x_key}
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
              >
                {spec.data.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => yFmt(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  const ChartComp = spec.type === "bar" ? BarChart : spec.type === "area" ? AreaChart : LineChart;

  return (
    <div className="card mt-3">
      <div className="text-sm font-medium mb-2">{spec.title}</div>
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <ChartComp data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis dataKey={spec.x_key} tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#64748B" }} tickLine={false} axisLine={false} width={70} tickFormatter={yFmt} />
            <Tooltip formatter={(v: number) => yFmt(v)} />
            {spec.y_keys.length > 1 && <Legend />}
            {spec.y_keys.map((key, i) => {
              const color = colors[i % colors.length];
              if (spec.type === "bar") {
                return <Bar key={key} dataKey={key} fill={color} radius={[4, 4, 0, 0]} stackId={spec.stacked ? "s" : undefined} />;
              }
              if (spec.type === "area") {
                return <Area key={key} dataKey={key} type="monotone" stroke={color} fill={color} fillOpacity={0.25} strokeWidth={2} />;
              }
              return <Line key={key} dataKey={key} type="monotone" stroke={color} strokeWidth={2} dot={false} />;
            })}
          </ChartComp>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
