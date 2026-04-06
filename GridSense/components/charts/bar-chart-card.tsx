"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function BarChartCard({
  data,
  xKey,
  yKey,
  color = "#22d3ee",
}: {
  data: Record<string, string | number>[];
  xKey: string;
  yKey: string;
  color?: string;
}) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{
              background: "#020617",
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 16,
              color: "#e2e8f0",
            }}
          />
          <Bar dataKey={yKey} fill={color} radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PieChartCard({
  data,
  dataKey,
  nameKey,
  colors,
}: {
  data: Record<string, string | number>[];
  dataKey: string;
  nameKey: string;
  colors: string[];
}) {
  const total = data.reduce((sum, entry) => sum + Number(entry[dataKey] ?? 0), 0);
  const sortedData = [...data].sort((a, b) => Number(b[dataKey] ?? 0) - Number(a[dataKey] ?? 0));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.95fr)_minmax(240px,1.05fr)]">
      <div className="h-72 rounded-2xl border border-white/10 bg-slate-950/50 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              formatter={(value: number | string, name: string) => [
                `${value} (${total === 0 ? 0 : ((Number(value) / total) * 100).toFixed(1)}%)`,
                name,
              ]}
              contentStyle={{
                background: "#020617",
                border: "1px solid rgba(148,163,184,0.2)",
                borderRadius: 16,
                color: "#e2e8f0",
              }}
            />
            <Pie
              data={sortedData}
              dataKey={dataKey}
              nameKey={nameKey}
              innerRadius={58}
              outerRadius={92}
              paddingAngle={3}
              stroke="rgba(15,23,42,0.9)"
              strokeWidth={2}
            >
              <Label
                value={`Total\n${total}`}
                position="center"
                fill="#e2e8f0"
                style={{ whiteSpace: "pre", fontSize: "14px", fontWeight: 600 }}
              />
              {sortedData.map((entry, index) => (
                <Cell key={`${String(entry[nameKey])}-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-2 content-start">
        {sortedData.map((entry, index) => (
          <div
            key={`${String(entry[nameKey])}-${index}-legend`}
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-3 text-sm"
          >
            <div className="flex items-center gap-3">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: colors[index % colors.length] }}
              />
              <span className="text-slate-200">{String(entry[nameKey])}</span>
            </div>
            <div className="text-right">
              <p className="font-semibold text-white">{Number(entry[dataKey] ?? 0)}</p>
              <p className="text-xs text-slate-400">
                {total === 0 ? 0 : ((Number(entry[dataKey] ?? 0) / total) * 100).toFixed(1)}%
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
