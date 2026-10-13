"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function finiteOrNull(value: string | number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function TrendChart({ data, lines }: { data: Array<Record<string, string | number | null>>; lines: Array<{ key: string; name: string; color: string }> }) {
  const points = data.map((row) => {
    const next: Record<string, string | number | null> = { ...row };
    for (const line of lines) next[line.key] = finiteOrNull(row[line.key]);
    return next;
  });
  const hasValue = points.some((row) => lines.some((line) => row[line.key] != null));
  if (!hasValue) return <p className="text-sm text-muted">No points in this range.</p>;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <CartesianGrid stroke="#2a3340" />
          <XAxis dataKey="date" stroke="#9aa6b2" tick={{ fontSize: 12 }} />
          <YAxis stroke="#9aa6b2" tick={{ fontSize: 12 }} width={48} />
          <Tooltip contentStyle={{ background: "#161b22", border: "1px solid #2a3340" }} />
          <Legend />
          {lines.map((line) => <Line key={line.key} type="monotone" dataKey={line.key} name={line.name} stroke={line.color} dot={false} connectNulls={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
