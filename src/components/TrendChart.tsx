"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function finiteOrNull(value: string | number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function TrendChart({
  data,
  lines,
  zeroBaseline = false,
}: {
  data: Array<Record<string, string | number | null>>;
  lines: Array<{ key: string; name: string; color: string; dashed?: boolean }>;
  zeroBaseline?: boolean;
}) {
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    setAnimate(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const points = data.map((row) => {
    const next: Record<string, string | number | null> = { ...row };
    for (const line of lines) next[line.key] = finiteOrNull(row[line.key]);
    return next;
  });
  const values = points.flatMap((row) => lines.map((line) => row[line.key])).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return <p className="rounded-md border border-dashed border-line px-3 py-6 text-sm text-muted">No points in this range.</p>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = span === 0 ? Math.max(Math.abs(max) * 0.08, 1) : span * 0.12;
  const domain: [number, number] = zeroBaseline ? [0, Math.max(max + pad, 1)] : [min - pad, max + pad];
  return (
    <div className="h-64 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--chart-axis)" tick={{ fontSize: 12, fill: "var(--chart-axis)" }} minTickGap={24} />
          <YAxis
            stroke="var(--chart-axis)"
            tick={{ fontSize: 12, fill: "var(--chart-axis)" }}
            width={52}
            domain={domain}
            tickFormatter={(value: number) => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : ""}
          />
          <Tooltip
            contentStyle={{ background: "var(--chart-tip)", border: "1px solid #3a4636", borderRadius: 8 }}
            formatter={(value, name) => [typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : "—", name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              strokeDasharray={line.dashed ? "5 4" : undefined}
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={animate}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
