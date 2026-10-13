import { resolveMuscleCredits } from "./muscles";
import type {
  EffectiveLoad,
  E1rmEstimate,
  ExerciseComparison,
  ExercisePerformance,
  ExerciseSessionSnapshot,
  ExerciseSummary,
  OverloadOptions,
  OverloadSuggestion,
  PersonalRecords,
  SessionSummary,
  SetInput,
  SetModality,
  TrainingFrequency,
  WorkoutSessionInput,
} from "./types";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const DURATION_INCREMENT_SEC = 5;

const ASSUMPTIONS = {
  eccentric:
    "Eccentric-only load is tracked separately and is not converted to a one-rep max.",
  bodyweight: "Full body weight is counted as the resistance.",
  weighted: "Effective load is body weight plus added external load.",
  assisted: "Effective load is body weight minus assistance.",
  assistedNonPositive:
    "Assistance meets or exceeds body weight, so effective load is not positive.",
  isometric: "Duration is the performance measure. One-rep max is not applicable.",
} as const;

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: number | null | undefined): value is number {
  return finiteNumber(value) && value > 0;
}

function isWorkSet(set: SetInput): boolean {
  return set.isWarmup !== true;
}

function repsInE1rmRange(reps: number | null | undefined): reps is number {
  return finiteNumber(reps) && reps >= 1 && reps <= 12;
}

function timeMs(iso: string): number {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function inRange(iso: string, fromIso?: string, toIso?: string): boolean {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return false;
  if (fromIso !== undefined) {
    const from = Date.parse(fromIso);
    if (!Number.isNaN(from) && time < from) return false;
  }
  if (toIso !== undefined) {
    const to = Date.parse(toIso);
    if (!Number.isNaN(to) && time > to) return false;
  }
  return true;
}

function tiebreakLoad(set: SetInput): number {
  const loads: number[] = [];
  const effective = effectiveLoad(set).loadLb;
  if (finitePositive(effective)) loads.push(effective);
  if (finitePositive(set.externalLoadLb)) loads.push(set.externalLoadLb);
  if (loads.length === 0) return Number.NEGATIVE_INFINITY;
  return Math.max(...loads);
}

function selectBestSet(sets: SetInput[]): SetInput | null {
  let bestRep: SetInput | null = null;
  let bestIso: SetInput | null = null;
  let bestIsoDuration = Number.NEGATIVE_INFINITY;

  for (const set of sets) {
    if (!isWorkSet(set)) continue;
    if (set.modality === "isometric") {
      if (finiteNumber(set.durationSec) && set.durationSec >= 0 && set.durationSec > bestIsoDuration) {
        bestIso = set;
        bestIsoDuration = set.durationSec;
      }
      continue;
    }
    if (!finitePositive(set.reps)) continue;
    if (bestRep == null || isBetterRepSet(set, bestRep)) bestRep = set;
  }

  return bestRep ?? bestIso;
}

function isBetterRepSet(candidate: SetInput, current: SetInput): boolean {
  if (!finitePositive(candidate.reps) || !finitePositive(current.reps)) return false;
  if (candidate.reps !== current.reps) return candidate.reps > current.reps;
  return tiebreakLoad(candidate) > tiebreakLoad(current);
}

export function effectiveLoad(set: SetInput): EffectiveLoad {
  switch (set.modality) {
    case "conventional":
      return finitePositive(set.externalLoadLb)
        ? { loadLb: set.externalLoadLb, assumption: null }
        : { loadLb: null, assumption: null };
    case "eccentric_only":
      return finitePositive(set.externalLoadLb)
        ? { loadLb: set.externalLoadLb, assumption: ASSUMPTIONS.eccentric }
        : { loadLb: null, assumption: ASSUMPTIONS.eccentric };
    case "bodyweight":
      return finitePositive(set.bodyWeightLb)
        ? { loadLb: set.bodyWeightLb, assumption: ASSUMPTIONS.bodyweight }
        : { loadLb: null, assumption: null };
    case "weighted_bodyweight": {
      if (
        finitePositive(set.bodyWeightLb) &&
        finiteNumber(set.addedLoadLb) &&
        set.addedLoadLb >= 0
      ) {
        return {
          loadLb: set.bodyWeightLb + set.addedLoadLb,
          assumption: ASSUMPTIONS.weighted,
        };
      }
      return { loadLb: null, assumption: null };
    }
    case "assisted": {
      if (
        finitePositive(set.bodyWeightLb) &&
        finiteNumber(set.assistanceLb) &&
        set.assistanceLb >= 0
      ) {
        const loadLb = set.bodyWeightLb - set.assistanceLb;
        if (loadLb > 0) return { loadLb, assumption: ASSUMPTIONS.assisted };
        return { loadLb: null, assumption: ASSUMPTIONS.assistedNonPositive };
      }
      return { loadLb: null, assumption: null };
    }
    case "isometric":
      return { loadLb: null, assumption: ASSUMPTIONS.isometric };
    default: {
      const unexpected: never = set.modality;
      throw new Error(`Unsupported modality: ${String(unexpected)}`);
    }
  }
}

export function estimateE1rm(set: SetInput): E1rmEstimate {
  if (set.modality === "eccentric_only") {
    return {
      applicable: false,
      valueLb: null,
      reason: "The Epley formula is unsuitable for eccentric-only sets.",
    };
  }
  if (set.modality === "isometric") {
    return {
      applicable: false,
      valueLb: null,
      reason: "The Epley formula is unsuitable for isometric sets.",
    };
  }
  if (set.isWarmup === true) {
    return {
      applicable: false,
      valueLb: null,
      reason: "Warm-up sets are excluded from one-rep max estimates.",
    };
  }

  const reps = set.reps;
  if (!repsInE1rmRange(reps)) {
    return {
      applicable: false,
      valueLb: null,
      reason: "Rep range is outside 1–12.",
    };
  }

  const loadLb = effectiveLoad(set).loadLb;
  if (!finitePositive(loadLb)) {
    return {
      applicable: false,
      valueLb: null,
      reason: "Effective load must be greater than zero to estimate a one-rep max.",
    };
  }

  if (reps === 1) {
    return {
      applicable: true,
      valueLb: loadLb,
      reason: "True single; one-rep max equals the effective load.",
      formula: "epley",
    };
  }

  return {
    applicable: true,
    valueLb: loadLb * (1 + reps / 30),
    reason: "Epley estimate from effective load and reps.",
    formula: "epley",
  };
}

/** Reps-in-reserve adjustment. This is not the official e1RM. */
export function rirAdjustedLoad(set: SetInput): number | null {
  const estimate = estimateE1rm(set);
  if (!estimate.applicable) return null;
  if (!finiteNumber(set.rir)) return null;
  const reps = set.reps;
  const loadLb = effectiveLoad(set).loadLb;
  if (!repsInE1rmRange(reps) || !finitePositive(loadLb)) return null;
  return loadLb * (1 + (reps + Math.max(0, set.rir)) / 30);
}

export function summarizeExercise(exercise: ExercisePerformance): ExerciseSummary {
  let conventionalVolumeLb = 0;
  let eccentricLoadRepProduct = 0;
  let totalReps = 0;
  let bestReps: number | null = null;
  let bestDurationSec: number | null = null;
  let bestExternalLoadLb: number | null = null;
  let workSetCount = 0;

  for (const set of exercise.sets) {
    if (!isWorkSet(set)) continue;
    workSetCount += 1;

    if (
      set.modality === "conventional" &&
      finitePositive(set.reps) &&
      finitePositive(set.externalLoadLb)
    ) {
      conventionalVolumeLb += set.reps * set.externalLoadLb;
    }

    if (
      set.modality === "eccentric_only" &&
      finitePositive(set.reps) &&
      finitePositive(set.externalLoadLb)
    ) {
      eccentricLoadRepProduct += set.reps * set.externalLoadLb;
    }

    if (set.modality !== "isometric" && finitePositive(set.reps)) {
      // Each unilateral side is its own work set, so volume and rep totals
      // include both. Rep and e1RM records keep the best single set.
      totalReps += set.reps;
      if (bestReps == null || set.reps > bestReps) bestReps = set.reps;
    }

    if (set.modality === "isometric" && finiteNumber(set.durationSec) && set.durationSec >= 0) {
      if (bestDurationSec == null || set.durationSec > bestDurationSec) {
        bestDurationSec = set.durationSec;
      }
    }

    if (finitePositive(set.externalLoadLb)) {
      if (bestExternalLoadLb == null || set.externalLoadLb > bestExternalLoadLb) {
        bestExternalLoadLb = set.externalLoadLb;
      }
    }
  }

  return {
    exerciseId: exercise.exerciseId,
    exerciseName: exercise.exerciseName,
    conventionalVolumeLb,
    eccentricLoadRepProduct,
    totalReps,
    workSetCount,
    bestReps,
    bestDurationSec,
    bestExternalLoadLb,
    bestSet: selectBestSet(exercise.sets),
  };
}

export function summarizeSession(session: WorkoutSessionInput): SessionSummary {
  const exercises = session.exercises.map((exercise) => summarizeExercise(exercise));
  return {
    id: session.id,
    startedAt: session.startedAt,
    exercises,
    conventionalVolumeLb: exercises.reduce((sum, exercise) => sum + exercise.conventionalVolumeLb, 0),
    totalReps: exercises.reduce((sum, exercise) => sum + exercise.totalReps, 0),
  };
}

interface Mark {
  value: number;
  achievedAt: string;
}

function improve(current: Mark | null, value: number | null, achievedAt: string): Mark | null {
  if (!finiteNumber(value)) return current;
  if (current == null || value > current.value) return { value, achievedAt };
  return current;
}

export function personalRecords(
  sessions: WorkoutSessionInput[],
  exerciseId: string,
): PersonalRecords {
  const ordered = sessions
    .map((session, index) => ({ session, index }))
    .sort((a, b) => timeMs(a.session.startedAt) - timeMs(b.session.startedAt) || a.index - b.index);

  let bestE1rm: Mark | null = null;
  let bestReps: Mark | null = null;
  let bestDuration: Mark | null = null;
  let bestEccentric: Mark | null = null;
  let bestConventional: Mark | null = null;

  for (const { session } of ordered) {
    for (const exercise of session.exercises) {
      if (exercise.exerciseId !== exerciseId) continue;
      for (const set of exercise.sets) {
        if (!isWorkSet(set)) continue;

        const estimate = estimateE1rm(set);
        if (estimate.applicable && finitePositive(estimate.valueLb)) {
          bestE1rm = improve(bestE1rm, estimate.valueLb, session.startedAt);
        }

        if (set.modality !== "isometric" && finitePositive(set.reps)) {
          bestReps = improve(bestReps, set.reps, session.startedAt);
        }

        if (set.modality === "isometric" && finiteNumber(set.durationSec) && set.durationSec >= 0) {
          bestDuration = improve(bestDuration, set.durationSec, session.startedAt);
        }

        if (set.modality === "eccentric_only" && finitePositive(set.externalLoadLb)) {
          bestEccentric = improve(bestEccentric, set.externalLoadLb, session.startedAt);
        }

        if (set.modality === "conventional" && finitePositive(set.externalLoadLb)) {
          bestConventional = improve(bestConventional, set.externalLoadLb, session.startedAt);
        }
      }
    }
  }

  return {
    exerciseId,
    bestE1rmLb: bestE1rm?.value ?? null,
    bestReps: bestReps?.value ?? null,
    bestDurationSec: bestDuration?.value ?? null,
    bestEccentricLoadLb: bestEccentric?.value ?? null,
    bestConventionalLoadLb: bestConventional?.value ?? null,
    achievedAt: {
      bestE1rmLb: bestE1rm?.achievedAt ?? null,
      bestReps: bestReps?.achievedAt ?? null,
      bestDurationSec: bestDuration?.achievedAt ?? null,
      bestEccentricLoadLb: bestEccentric?.achievedAt ?? null,
      bestConventionalLoadLb: bestConventional?.achievedAt ?? null,
    },
  };
}

function exerciseSnapshot(
  session: WorkoutSessionInput,
  exerciseId: string,
): ExerciseSessionSnapshot | null {
  const parts = session.exercises.filter((exercise) => exercise.exerciseId === exerciseId);
  const first = parts[0];
  if (!first) return null;
  const summary = summarizeExercise({
    exerciseId,
    exerciseName: first.exerciseName,
    sets: parts.flatMap((exercise) => exercise.sets),
  });
  return {
    sessionId: session.id,
    startedAt: session.startedAt,
    bestReps: summary.bestReps,
    totalReps: summary.totalReps,
    bestDurationSec: summary.bestDurationSec,
    conventionalVolumeLb: summary.conventionalVolumeLb,
    eccentricLoadRepProduct: summary.eccentricLoadRepProduct,
    bestExternalLoadLb: summary.bestExternalLoadLb,
  };
}

function subtractOrNull(latest: number | null, previous: number | null): number | null {
  if (latest == null || previous == null) return null;
  return latest - previous;
}

export function compareExercise(
  sessions: WorkoutSessionInput[],
  exerciseId: string,
): ExerciseComparison {
  const ranked = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) =>
      session.exercises.some((exercise) => exercise.exerciseId === exerciseId),
    )
    .sort((a, b) => timeMs(b.session.startedAt) - timeMs(a.session.startedAt) || b.index - a.index);

  const latest = ranked[0] ? exerciseSnapshot(ranked[0].session, exerciseId) : null;
  const previous = ranked[1] ? exerciseSnapshot(ranked[1].session, exerciseId) : null;

  if (latest == null || previous == null) {
    return {
      exerciseId,
      latest,
      previous,
      deltaTotalReps: null,
      deltaBestReps: null,
      deltaBestDurationSec: null,
      deltaConventionalVolumeLb: null,
    };
  }

  return {
    exerciseId,
    latest,
    previous,
    deltaTotalReps: subtractOrNull(latest.totalReps, previous.totalReps),
    deltaBestReps: subtractOrNull(latest.bestReps, previous.bestReps),
    deltaBestDurationSec: subtractOrNull(latest.bestDurationSec, previous.bestDurationSec),
    deltaConventionalVolumeLb: subtractOrNull(
      latest.conventionalVolumeLb,
      previous.conventionalVolumeLb,
    ),
  };
}

export function muscleExposure(
  sessions: WorkoutSessionInput[],
  fromIso?: string,
  toIso?: string,
): { heuristic: true; muscles: { muscle: string; direct: number; secondary: number }[] } {
  const totals = new Map<string, { direct: number; secondary: number }>();

  for (const session of sessions) {
    if (!inRange(session.startedAt, fromIso, toIso)) continue;
    for (const exercise of session.exercises) {
      const workSets = exercise.sets.filter(isWorkSet).length;
      if (workSets === 0) continue;
      for (const credit of resolveMuscleCredits(exercise)) {
        const row = totals.get(credit.muscle) ?? { direct: 0, secondary: 0 };
        row[credit.role] += credit.credit * workSets;
        totals.set(credit.muscle, row);
      }
    }
  }

  const muscles = [...totals.entries()]
    .map(([muscle, scores]) => ({
      muscle,
      direct: scores.direct,
      secondary: scores.secondary,
    }))
    .sort((a, b) => a.muscle.localeCompare(b.muscle));

  return { heuristic: true, muscles };
}

type ProgressionFamily = "isometric" | "eccentric_only" | "loaded";

function progressionFamily(modality: SetModality): ProgressionFamily {
  if (modality === "isometric") return "isometric";
  if (modality === "eccentric_only") return "eccentric_only";
  return "loaded";
}

function rirAllowsIncrease(set: SetInput): boolean {
  if (set.rir == null) return true;
  return finiteNumber(set.rir) && set.rir >= 1;
}

function baselineSuggestion(exerciseId: string): OverloadSuggestion {
  return {
    exerciseId,
    kind: "baseline",
    message: "Establish a baseline.",
    loadIncrementLb: null,
    durationIncrementSec: null,
  };
}

function repeatSuggestion(exerciseId: string): OverloadSuggestion {
  return {
    exerciseId,
    kind: "repeat",
    message: "Repeat the current load.",
    loadIncrementLb: null,
    durationIncrementSec: null,
  };
}

function loadSuggestion(
  exerciseId: string,
  loadIncrementLb: number,
  eccentric: boolean,
): OverloadSuggestion {
  return {
    exerciseId,
    kind: "load",
    message: eccentric
      ? `Add ${loadIncrementLb} lb to the external load. Eccentric work is not an e1RM progression.`
      : `Add ${loadIncrementLb} lb.`,
    loadIncrementLb,
    durationIncrementSec: null,
  };
}

function durationSuggestion(exerciseId: string): OverloadSuggestion {
  return {
    exerciseId,
    kind: "duration",
    message: `Add ${DURATION_INCREMENT_SEC} seconds. This changes the hold duration and does not increase load.`,
    loadIncrementLb: null,
    durationIncrementSec: DURATION_INCREMENT_SEC,
  };
}

function latestSessionWithExercise(
  sessions: WorkoutSessionInput[],
  exerciseId: string,
): WorkoutSessionInput | null {
  const ranked = sessions
    .map((session, index) => ({ session, index }))
    .filter(({ session }) =>
      session.exercises.some((exercise) => exercise.exerciseId === exerciseId),
    )
    .sort((a, b) => timeMs(b.session.startedAt) - timeMs(a.session.startedAt) || b.index - a.index);
  return ranked[0]?.session ?? null;
}

export function overloadSuggestion(
  sessions: WorkoutSessionInput[],
  exerciseId: string,
  options?: OverloadOptions,
): OverloadSuggestion {
  const repTarget = options?.repTarget ?? 12;
  const loadIncrementLb = options?.loadIncrementLb ?? 5;
  const durationTargetSec = options?.durationTargetSec;

  const latest = latestSessionWithExercise(sessions, exerciseId);
  if (!latest) return baselineSuggestion(exerciseId);

  const workSets = latest.exercises
    .filter((exercise) => exercise.exerciseId === exerciseId)
    .flatMap((exercise) => exercise.sets)
    .filter(isWorkSet);

  if (workSets.length === 0) return repeatSuggestion(exerciseId);

  const families = new Set(workSets.map((set) => progressionFamily(set.modality)));
  if (families.size !== 1) return repeatSuggestion(exerciseId);
  const family = [...families][0];
  if (family == null) return repeatSuggestion(exerciseId);

  if (family === "isometric") {
    let bestDuration: number | null = null;
    for (const set of workSets) {
      if (finiteNumber(set.durationSec) && set.durationSec >= 0) {
        if (bestDuration == null || set.durationSec > bestDuration) bestDuration = set.durationSec;
      }
    }
    if (durationTargetSec != null && bestDuration != null && bestDuration >= durationTargetSec) {
      return durationSuggestion(exerciseId);
    }
    return repeatSuggestion(exerciseId);
  }

  if (family === "eccentric_only") {
    const ready = workSets.every((set) => finiteNumber(set.reps) && set.reps >= repTarget);
    return ready
      ? loadSuggestion(exerciseId, loadIncrementLb, true)
      : repeatSuggestion(exerciseId);
  }

  const ready = workSets.every(
    (set) => finiteNumber(set.reps) && set.reps >= repTarget && rirAllowsIncrease(set),
  );
  return ready ? loadSuggestion(exerciseId, loadIncrementLb, false) : repeatSuggestion(exerciseId);
}

export function trainingFrequency(
  sessions: WorkoutSessionInput[],
  fromIso: string,
  toIso: string,
): TrainingFrequency {
  const included = sessions.filter((session) => inRange(session.startedAt, fromIso, toIso));
  const times = included
    .map((session) => Date.parse(session.startedAt))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);

  const span = times.length === 0 ? 0 : times[times.length - 1] - times[0];
  const weeks = Math.max(span / MS_PER_WEEK, 1 / 7);
  return {
    sessions: included.length,
    weeks,
    sessionsPerWeek: included.length / weeks,
  };
}
