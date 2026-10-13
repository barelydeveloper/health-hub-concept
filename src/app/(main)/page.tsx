"use client";

import { useQuery } from "@tanstack/react-query";
import { Panel, Stat } from "@/components/Shell";
import { Empty, Loading, PageHeader } from "@/components/ui";
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
  if (query.error) return <p role="alert" className="text-sm text-danger">{query.error.message}</p>;
  if (query.isLoading || !query.data) return <Loading label="Loading overview…" />;
  const data = query.data.data;
  const body = data.body;
  return (
    <div className="space-y-5">
      <PageHeader title="Overview" lede="Latest stored weight, the last session, and strength milestones. Estimates stay labeled beside the raw reading." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Weight" tone="measured" value={body ? `${formatNumber(body.weightLb)} lb` : "—"} detail={body ? new Date(body.recordedAt).toLocaleDateString() : "No weigh-ins"} />
        <Stat label="Body fat, raw" tone="measured" value={body?.bodyFatPercent == null ? "—" : `${formatNumber(body.bodyFatPercent)}%`} detail="Measured" />
        <Stat label="Body fat, normalized" tone="estimate" value={body?.normalizedBodyFatPercent == null ? "—" : `${formatNumber(body.normalizedBodyFatPercent)}%`} detail={body?.normalizedBodyFatPercent != null ? "Estimate, shown beside the raw value" : body?.normalization.reason ?? "No hydration-adjusted value for this reading"} />
        <Stat label="Fat mass" value={body?.fatMassLb == null ? "—" : `${formatNumber(body.fatMassLb)} lb`} />
        <Stat label="Fat-free mass" value={body?.fatFreeMassLb == null ? "—" : `${formatNumber(body.fatFreeMassLb)} lb`} detail="Not the same thing as muscle" />
        <Stat label="7-day steps" value={formatNumber(data.activity.steps, 0)} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Recent workout" note={data.recentWorkout ? data.recentWorkout.startedAt.slice(0, 10) : undefined}>
          {data.recentWorkout ? (
            <ul className="space-y-2 text-sm">
              {data.recentWorkout.exercises.map((exercise) => (
                <li key={exercise.exerciseName} className="flex items-baseline justify-between gap-3 border-t border-line pt-2 first:border-t-0 first:pt-0">
                  <span>{exercise.exerciseName}</span>
                  <span className="num text-muted">{exercise.totalReps} reps, best set {exercise.bestReps ?? "—"}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No workouts yet.</Empty>}
        </Panel>
        <Panel title="Personal records">
          {data.personalRecords.length === 0 ? <Empty>No performances yet.</Empty> : (
            <ul className="space-y-2 text-sm">
              {data.personalRecords.map((record) => (
                <li key={record.exerciseId} className="border-t border-line pt-2 first:border-t-0 first:pt-0">
                  <span className="font-medium">{record.exerciseId}</span>
                  <span className="num ml-2 text-muted">{record.bestReps != null ? `${record.bestReps} reps` : ""} {record.bestDurationSec != null ? `${formatNumber(record.bestDurationSec, 0)} s` : ""} {record.bestE1rmLb != null ? `e1RM ${formatNumber(record.bestE1rmLb)} lb` : ""} {record.bestEccentricLoadLb != null ? `eccentric ${formatNumber(record.bestEccentricLoadLb, 0)} lb` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Goals">
        {data.goals.length === 0 ? <Empty>No goals yet.</Empty> : (
          <ul className="space-y-2 text-sm">
            {data.goals.map((goal) => (
              <li key={goal.name} className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:justify-between">
                <span>{goal.name}</span>
                <span className="num text-muted">latest {formatNumber(goal.projection?.latest ?? null)} / {formatNumber(goal.targetValue, 1)} {goal.targetUnit} <span className="badge ml-2">{goal.projection?.status ?? "no series"}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
