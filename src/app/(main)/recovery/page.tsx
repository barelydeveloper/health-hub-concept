"use client";

import { useQuery } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { TrendChart } from "@/components/TrendChart";
import { Empty, Loading, PageHeader } from "@/components/ui";
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
  if (query.error) return <p role="alert" className="text-sm text-danger">{query.error.message}</p>;
  if (query.isLoading || !query.data) return <Loading label="Loading recovery…" />;
  const data = query.data.data;
  return (
    <div className="space-y-5">
      <PageHeader title="Recovery" lede={data.estimateLabel} />
      <Panel title="Steps">
        <TrendChart zeroBaseline data={[...data.activity].reverse().map((day) => ({ date: day.date, steps: day.steps }))} lines={[{ key: "steps", name: "Steps", color: "#6fbf9a" }]} />
      </Panel>
      <Panel title="Sleep">
        {data.sleep.length === 0 ? <Empty>No sleep sessions.</Empty> : (
          <ul className="space-y-1 text-sm">{data.sleep.map((row) => <li key={row.id} className="border-t border-line py-2 first:border-t-0">{row.startedAt.slice(0, 10)}: <span className="num">{formatNumber(row.durationHours)}</span> h <span className="badge">{row.valueOrigin}</span></li>)}</ul>
        )}
      </Panel>
      <Panel title="Activity">
        {data.activity.length === 0 ? <Empty>No activity days.</Empty> : data.activity.slice(0, 14).map((day) => (
          <p key={day.date} className="border-t border-line py-2 text-sm first:border-t-0">{day.date}: <span className="num">{day.steps ?? "—"}</span> steps, <span className="num">{formatNumber(day.workoutMinutes, 0)}</span> min, HR <span className="num">{formatNumber(day.heartRateAvg, 0)}</span></p>
        ))}
      </Panel>
    </div>
  );
}
