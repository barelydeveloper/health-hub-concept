"use client";

import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { TrendChart } from "@/components/TrendChart";
import { api, formatNumber } from "@/lib/api";

interface Recovery {
  data: {
    estimateLabel: string;
    activity: Array<{ date: string; steps: number | null; activeCalories: number | null; workoutMinutes: number | null; heartRateAvg: number | null }>;
    sleep: Array<{ id: string; startedAt: string; durationHours: number | null; valueOrigin: string }>;
  };
}

export default function RecoveryPage() {
  const query = useQuery({ queryKey: ["recovery"], queryFn: () => api<Recovery>("/api/v1/recovery") });
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (query.isLoading || !query.data) return <p>Loading recovery…</p>;
  const data = query.data.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Recovery</h1>
      <p className="text-sm text-muted">{data.estimateLabel}</p>
      <Panel title="Steps">
        <TrendChart data={[...data.activity].reverse().map((day) => ({ date: day.date, steps: day.steps }))} lines={[{ key: "steps", name: "Steps", color: "#7dd3c7" }]} />
      </Panel>
      <Panel title="Sleep">
        {data.sleep.length === 0 ? <p className="text-sm text-muted">No sleep sessions.</p> : (
          <ul className="space-y-1 text-sm">{data.sleep.map((row) => <li key={row.id}>{row.startedAt.slice(0, 10)}: {formatNumber(row.durationHours)} h ({row.valueOrigin})</li>)}</ul>
        )}
      </Panel>
      <Panel title="Activity">
        {data.activity.length === 0 ? <p className="text-sm text-muted">No activity days.</p> : data.activity.slice(0, 14).map((day) => (
          <p key={day.date} className="text-sm">{day.date}: {day.steps ?? "—"} steps, {formatNumber(day.workoutMinutes, 0)} min, HR {formatNumber(day.heartRateAvg, 0)}</p>
        ))}
      </Panel>
    </div>
  );
}
