"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { api, formatNumber, idempotencyKey } from "@/lib/api";

interface Goals {
  data: Array<{ id: string; name: string; type: string; targetValue: number; targetUnit: string; projection: { status: string; estimatedDate: string | null; latest: number | null; disclaimer: string } | null }>;
}

interface Forecasts {
  data: {
    live: { disclaimer: string; plateau: { plateau: boolean; reason: string }; linear: { status: string; projected: number | null; slopePerWeek: number | null } };
  };
}

export default function GoalsPage() {
  const client = useQueryClient();
  const goals = useQuery({ queryKey: ["goals"], queryFn: () => api<Goals>("/api/v1/goals") });
  const forecasts = useQuery({ queryKey: ["forecasts"], queryFn: () => api<Forecasts>("/api/v1/forecasts?mode=expected&intakeKcal=2400&tdeeKcal=2600&horizonDays=56") });
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setFormError(null);
    try {
      await api("/api/v1/goals", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey() },
        body: JSON.stringify({
          type: form.get("type"),
          name: form.get("name"),
          targetValue: Number(form.get("target")),
          targetUnit: form.get("unit"),
          direction: form.get("direction"),
        }),
      });
      setMessage("Goal saved. The date, if any, is an estimate.");
      await client.invalidateQueries({ queryKey: ["goals"] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Request failed");
    }
  }

  if (goals.error || forecasts.error) return <p role="alert">{(goals.error ?? forecasts.error)?.message}</p>;
  if (goals.isLoading || forecasts.isLoading || !goals.data || !forecasts.data) return <p>Loading goals…</p>;
  const live = forecasts.data.data.live;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Goals and forecasts</h1>
      <p className="text-sm text-muted">{live.disclaimer}</p>
      <Panel title="Weight trajectory">
        <p className="text-sm">Linear status {live.linear.status}. Slope {formatNumber(live.linear.slopePerWeek)} lb/week. 56-day projection {formatNumber(live.linear.projected)} lb.</p>
        <p className="mt-2 text-sm">Plateau: {live.plateau.plateau ? "yes" : "no"}. {live.plateau.reason}</p>
      </Panel>
      <Panel title="Active goals">
        <ul className="space-y-2 text-sm">
          {goals.data.data.map((goal) => (
            <li key={goal.id}>
              <span className="font-medium">{goal.name}</span> — {formatNumber(goal.projection?.latest ?? null)} toward {formatNumber(goal.targetValue)} {goal.targetUnit}. {goal.projection?.status ?? "no series"}{goal.projection?.estimatedDate ? `, estimate ${goal.projection.estimatedDate.slice(0, 10)}` : ""}.
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Add a goal">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Name<input name="name" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Type
            <select name="type" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2">
              <option value="weight">Weight</option>
              <option value="body_fat_percent">Body fat %</option>
              <option value="fat_mass">Fat mass</option>
              <option value="pull_up_reps">Pull-up reps</option>
              <option value="hold_duration">Hold duration</option>
              <option value="deadlift_weight">Deadlift</option>
              <option value="dumbbell_press_weight">Dumbbell press</option>
              <option value="training_frequency">Training frequency</option>
              <option value="calories">Calories</option>
              <option value="protein">Protein</option>
            </select>
          </label>
          <label className="text-sm">Target<input name="target" type="number" step="0.1" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Unit<input name="unit" defaultValue="lb" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Direction
            <select name="direction" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2"><option value="up">Up</option><option value="down">Down</option></select>
          </label>
          <button className="rounded bg-accent px-4 py-2 font-semibold text-ink">Save goal</button>
        </form>
        {formError ? <p role="alert" className="mt-2 text-sm">{formError}</p> : null}
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </Panel>
    </div>
  );
}
