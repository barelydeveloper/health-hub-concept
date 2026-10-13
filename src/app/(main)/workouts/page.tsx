"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Panel } from "@/components/Shell";
import { api, formatNumber, idempotencyKey } from "@/lib/api";

interface WorkoutList {
  data: Array<{
    id: string;
    startedAt: string;
    summary: { exercises: Array<{ exerciseId: string; exerciseName: string; totalReps: number; bestReps: number | null; conventionalVolumeLb: number }> };
  }>;
}

interface History {
  data: {
    comparison: { latest: { totalReps: number; bestReps: number | null } | null; previous: { totalReps: number; bestReps: number | null } | null; deltaTotalReps: number | null; deltaBestReps: number | null };
    records: { bestE1rmLb: number | null; bestReps: number | null; bestDurationSec: number | null; bestEccentricLoadLb: number | null };
    overload: { message: string };
    muscleExposure: { heuristic: boolean; muscles: Array<{ muscle: string; direct: number; secondary: number }> };
  };
}

export default function WorkoutsPage() {
  const client = useQueryClient();
  const workouts = useQuery({ queryKey: ["workouts"], queryFn: () => api<WorkoutList>("/api/v1/workouts") });
  const [slug, setSlug] = useState("pull-up");
  const history = useQuery({ queryKey: ["history", slug], queryFn: () => api<History>(`/api/v1/exercises/${encodeURIComponent(slug)}/history`), enabled: Boolean(slug) });
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const modality = String(form.get("modality"));
    const reps = form.get("reps");
    const load = form.get("load");
    const duration = form.get("duration");
    await api("/api/v1/workouts", {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey() },
      body: JSON.stringify({
        startedAt: new Date(`${form.get("date")}T15:00:00.000Z`).toISOString(),
        name: String(form.get("name") || "Logged session"),
        exercises: [{
          exerciseSlug: String(form.get("slug")),
          exerciseName: String(form.get("exerciseName") || form.get("slug")),
          sets: [{
            modality,
            reps: reps ? Number(reps) : null,
            durationSec: duration ? Number(duration) : null,
            externalLoadLb: modality === "conventional" || modality === "eccentric_only" ? (load ? Number(load) : null) : null,
            addedLoadLb: modality === "weighted_bodyweight" ? (load ? Number(load) : null) : null,
            assistanceLb: modality === "assisted" ? (load ? Number(load) : null) : null,
            bodyWeightLb: modality === "bodyweight" || modality === "weighted_bodyweight" || modality === "assisted" ? Number(form.get("bodyWeight") || 0) || null : null,
          }],
        }],
      }),
    });
    setMessage("Workout saved.");
    await client.invalidateQueries({ queryKey: ["workouts"] });
    await client.invalidateQueries({ queryKey: ["history"] });
  }

  if (workouts.error) return <p role="alert">{workouts.error.message}</p>;
  if (workouts.isLoading || !workouts.data) return <p>Loading workouts…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Workouts</h1>
      <Panel title="Log a session">
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Date<input name="date" type="date" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Session name<input name="name" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Exercise slug<input name="slug" defaultValue="pull-up" required className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Exercise name<input name="exerciseName" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Modality
            <select name="modality" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2">
              <option value="conventional">Conventional</option>
              <option value="bodyweight">Bodyweight</option>
              <option value="weighted_bodyweight">Weighted bodyweight</option>
              <option value="assisted">Assisted</option>
              <option value="eccentric_only">Eccentric only</option>
              <option value="isometric">Isometric</option>
            </select>
          </label>
          <label className="text-sm">Reps<input name="reps" type="number" min="0" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Load or assistance (lb)<input name="load" type="number" min="0" step="0.5" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Duration (sec)<input name="duration" type="number" min="0" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <label className="text-sm">Body weight (lb)<input name="bodyWeight" type="number" min="0" step="0.1" className="mt-1 w-full rounded border border-line bg-ink px-3 py-2" /></label>
          <button className="rounded bg-accent px-4 py-2 font-semibold text-ink">Save session</button>
        </form>
        {message ? <p className="mt-2 text-sm">{message}</p> : null}
      </Panel>
      <Panel title="Timeline">
        {workouts.data.data.length === 0 ? <p className="text-sm text-muted">No sessions yet.</p> : workouts.data.data.map((session) => (
          <article key={session.id} className="border-t border-line py-3 first:border-t-0">
            <h3 className="font-medium">{session.startedAt.slice(0, 10)}</h3>
            <ul className="mt-1 text-sm text-muted">
              {session.summary.exercises.map((exercise) => (
                <li key={exercise.exerciseId}>
                  <button type="button" className="underline" onClick={() => setSlug(exercise.exerciseId)}>{exercise.exerciseName}</button>
                  {" "}— {exercise.totalReps} reps, best {exercise.bestReps ?? "—"}, volume {formatNumber(exercise.conventionalVolumeLb, 0)} lb
                </li>
              ))}
            </ul>
          </article>
        ))}
      </Panel>
      <Panel title={`History: ${slug}`}>
        {history.error ? <p>{history.error.message}</p> : history.isLoading || !history.data ? <p>Loading history…</p> : (
          <div className="space-y-2 text-sm">
            <p>Latest total reps {history.data.data.comparison.latest?.totalReps ?? "—"} (best {history.data.data.comparison.latest?.bestReps ?? "—"}), previous {history.data.data.comparison.previous?.totalReps ?? "—"}, change {history.data.data.comparison.deltaTotalReps ?? "—"} reps.</p>
            <p>Records: e1RM {formatNumber(history.data.data.records.bestE1rmLb)} lb, reps {history.data.data.records.bestReps ?? "—"}, hold {formatNumber(history.data.data.records.bestDurationSec, 0)} s, eccentric load {formatNumber(history.data.data.records.bestEccentricLoadLb, 0)} lb.</p>
            <p>{history.data.data.overload.message}</p>
            <p className="text-muted">{history.data.data.muscleExposure.heuristic ? "Muscle exposure is a configurable heuristic." : ""}</p>
            <ul>{history.data.data.muscleExposure.muscles.map((muscle) => <li key={muscle.muscle}>{muscle.muscle}: direct {muscle.direct}, secondary {muscle.secondary}</li>)}</ul>
          </div>
        )}
      </Panel>
    </div>
  );
}
