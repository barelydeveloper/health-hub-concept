import { FORECAST_VERSION, linearModel, parseSeries, type SeriesPoint } from "./project";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SLOPE_EPSILON_PER_WEEK = 1e-6;

export const GOAL_DISCLAIMER =
  "Outcomes are not guaranteed. The estimated date is not a guaranteed date.";

export type GoalSpec =
  | {
      type:
        | "weight"
        | "body_fat_percent"
        | "fat_mass"
        | "circumference"
        | "dumbbell_press_weight"
        | "deadlift_weight"
        | "calories"
        | "protein"
        | "training_frequency";
      target: number;
      direction: "up" | "down";
    }
  | {
      type: "pull_up_reps" | "hold_duration";
      target: number;
      direction: "up";
    };

export interface GoalProjection {
  version: typeof FORECAST_VERSION;
  status: "already_met" | "projected" | "insufficient_data" | "no_crossing";
  estimatedDate: string | null;
  slopePerWeek: number | null;
  latest: number | null;
  method: "linear";
  disclaimer: string;
}

export function projectGoal(points: SeriesPoint[], goal: GoalSpec, asOf?: string): GoalProjection {
  const series = parseSeries(points);
  const latest = series.length > 0 ? series[series.length - 1].value : null;
  const base = {
    version: FORECAST_VERSION,
    method: "linear" as const,
    disclaimer: GOAL_DISCLAIMER,
    latest,
    slopePerWeek: null as number | null,
    estimatedDate: null as string | null,
  };

  if (series.length === 0 || !Number.isFinite(goal.target)) {
    return { ...base, status: "insufficient_data" };
  }

  const alreadyMet =
    (goal.direction === "up" && latest !== null && latest >= goal.target) ||
    (goal.direction === "down" && latest !== null && latest <= goal.target);

  if (alreadyMet) {
    const fit = series.length >= 2 ? linearModel(points) : null;
    return {
      ...base,
      status: "already_met",
      slopePerWeek: fit?.slopePerWeek ?? null,
    };
  }

  if (series.length < 2) {
    return { ...base, status: "insufficient_data" };
  }

  const fit = linearModel(points);
  const slopePerWeek = fit.slopePerWeek;
  if (
    slopePerWeek === null ||
    Math.abs(slopePerWeek) < SLOPE_EPSILON_PER_WEEK ||
    (goal.direction === "up" ? slopePerWeek <= 0 : slopePerWeek >= 0)
  ) {
    return { ...base, status: "no_crossing", slopePerWeek };
  }

  const slopePerDay = slopePerWeek / 7;
  const days = (goal.target - (latest as number)) / slopePerDay;
  const anchorTime = resolveAnchor(asOf, series[series.length - 1].time);
  const estimatedDate = new Date(anchorTime + days * MS_PER_DAY).toISOString();

  return {
    ...base,
    status: "projected",
    slopePerWeek,
    estimatedDate,
  };
}

function resolveAnchor(asOf: string | undefined, fallbackTime: number): number {
  if (asOf === undefined) return fallbackTime;
  const parsed = Date.parse(asOf);
  return Number.isFinite(parsed) ? parsed : fallbackTime;
}
