"use client";

import { useQuery } from "@tanstack/react-query";
import { Panel, Stat } from "@/components/Shell";
import { api, formatNumber } from "@/lib/api";

interface Dashboard {
  data: {
    body: null | {
      recordedAt: string;
      weightLb: number | null;
      bodyFatPercent: number | null;
      normalizedBodyFatPercent: number | null;
      fatMassLb: number | null;
      fatFreeMassLb: number | null;
      normalization: { status: string; reason?: string };
    };
    recentWorkout: null | { startedAt: string; exercises: Array<{ exerciseName: string; totalReps: number; bestReps: number | null }> };
    personalRecords: Array<{ exerciseId: string; bestReps: number | null; bestDurationSec: number | null; bestE1rmLb: number | null; bestEccentricLoadLb: number | null }>;
    weeklyTraining: { sessionCount: number; sessionsPerWeek: number; muscleExposure: { muscles: Array<{ muscle: string; direct: number }> } };
    activity: { steps: number };
    recovery: { sleep: Array<{ durationHours: number | null }> };
    goals: Array<{ name: string; projection: { status: string; latest: number | null } | null; targetValue: number; targetUnit: string }>;
  };
}

export default function OverviewPage() {
  const query = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/v1/dashboard") });
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (query.isLoading || !query.data) return <p>Loading overview…</p>;
  const data = query.data.data;
  const body = data.body;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Weight" value={body ? `${formatNumber(body.weightLb)} lb` : "—"} detail={body ? new Date(body.recordedAt).toLocaleDateString() : "No weigh-ins"} />
        <Stat label="Body fat, raw" value={body?.bodyFatPercent == null ? "—" : `${formatNumber(body.bodyFatPercent)}%`} />
        <Stat label="Body fat, normalized" value={body?.normalizedBodyFatPercent == null ? "—" : `${formatNumber(body.normalizedBodyFatPercent)}%`} detail={body?.normalizedBodyFatPercent != null ? "Estimate, shown beside the raw value" : body?.normalization.reason ?? "No hydration-adjusted value for this reading"} />
        <Stat label="Fat mass" value={body?.fatMassLb == null ? "—" : `${formatNumber(body.fatMassLb)} lb`} />
        <Stat label="Fat-free mass" value={body?.fatFreeMassLb == null ? "—" : `${formatNumber(body.fatFreeMassLb)} lb`} detail="Not the same thing as muscle" />
        <Stat label="7-day steps" value={formatNumber(data.activity.steps, 0)} />
      </div>
      <Panel title="Recent workout">
        {data.recentWorkout ? (
          <ul className="space-y-1 text-sm">
            {data.recentWorkout.exercises.map((exercise) => (
              <li key={exercise.exerciseName}>{exercise.exerciseName}: {exercise.totalReps} reps, best set {exercise.bestReps ?? "—"}</li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No workouts yet.</p>}
      </Panel>
      <Panel title="Personal records">
        {data.personalRecords.length === 0 ? <p className="text-sm text-muted">No performances yet.</p> : (
          <ul className="space-y-1 text-sm">
            {data.personalRecords.map((record) => (
              <li key={record.exerciseId}>
                {record.exerciseId}: {record.bestReps != null ? `${record.bestReps} reps` : ""} {record.bestDurationSec != null ? `${formatNumber(record.bestDurationSec, 0)} s` : ""} {record.bestE1rmLb != null ? `e1RM ${formatNumber(record.bestE1rmLb)} lb` : ""} {record.bestEccentricLoadLb != null ? `eccentric ${formatNumber(record.bestEccentricLoadLb, 0)} lb` : ""}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Goals">
        <ul className="space-y-1 text-sm">
          {data.goals.map((goal) => (
            <li key={goal.name}>{goal.name}: latest {formatNumber(goal.projection?.latest ?? null)} / {formatNumber(goal.targetValue, 1)} {goal.targetUnit} ({goal.projection?.status ?? "no series"})</li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
