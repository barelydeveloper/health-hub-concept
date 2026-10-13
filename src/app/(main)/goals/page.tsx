"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { Button, Empty, Loading, Notice, PageHeader } from "@/components/ui";
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

  if (goals.error || forecasts.error) return <p role="alert" className="text-sm text-danger">{(goals.error ?? forecasts.error)?.message}</p>;
  if (goals.isLoading || forecasts.isLoading || !goals.data || !forecasts.data) return <Loading label="Loading goals…" />;
  const live = forecasts.data.data.live;

  return (
    <div className="space-y-5">
      <PageHeader title="Goals and forecasts" lede={live.disclaimer} />
      <Panel title="Weight trajectory" note="Estimate, not a guarantee">
        <p className="text-sm">Linear status <span className="badge">{live.linear.status}</span>. Slope <span className="num">{formatNumber(live.linear.slopePerWeek)}</span> lb/week. 56-day projection <span className="num">{formatNumber(live.linear.projected)}</span> lb.</p>
        <p className="mt-2 text-sm">Plateau: {live.plateau.plateau ? "yes" : "no"}. {live.plateau.reason}</p>
      </Panel>
      <Panel title="Active goals">
        {goals.data.data.length === 0 ? <Empty>No goals yet.</Empty> : (
          <ul className="space-y-2 text-sm">
            {goals.data.data.map((goal) => (
              <li key={goal.id} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                <span className="font-medium">{goal.name}</span> — <span className="num">{formatNumber(goal.projection?.latest ?? null)}</span> toward <span className="num">{formatNumber(goal.targetValue)}</span> {goal.targetUnit}. <span className="badge">{goal.projection?.status ?? "no series"}</span>{goal.projection?.estimatedDate ? `, estimate ${goal.projection.estimatedDate.slice(0, 10)}` : ""}.
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Add a goal">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Name<input name="name" required className="field" /></label>
          <label className="text-sm">Type
            <select name="type" className="field">
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
          <label className="text-sm">Target<input name="target" type="number" step="0.1" required className="field" /></label>
          <label className="text-sm">Unit<input name="unit" defaultValue="lb" required className="field" /></label>
          <label className="text-sm">Direction
            <select name="direction" className="field"><option value="up">Up</option><option value="down">Down</option></select>
          </label>
          <Button>Save goal</Button>
        </form>
        {formError ? <Notice tone="danger">{formError}</Notice> : null}
        {message ? <Notice tone="ok">{message}</Notice> : null}
      </Panel>
    </div>
  );
}
