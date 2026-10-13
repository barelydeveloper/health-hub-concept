export type SetModality =
  | "conventional"
  | "eccentric_only"
  | "isometric"
  | "assisted"
  | "bodyweight"
  | "weighted_bodyweight";

export interface SetInput {
  modality: SetModality;
  reps?: number | null;
  durationSec?: number | null;
  externalLoadLb?: number | null;
  addedLoadLb?: number | null;
  assistanceLb?: number | null;
  bodyWeightLb?: number | null;
  rpe?: number | null;
  rir?: number | null;
  side?: "left" | "right" | "both" | null;
  isWarmup?: boolean;
  notes?: string | null;
}

export interface MuscleCredit {
  muscle: string;
  role: "direct" | "secondary";
  credit: number;
}

export interface ExercisePerformance {
  exerciseId: string;
  exerciseName: string;
  sets: SetInput[];
  muscleCredits?: MuscleCredit[];
}

export interface WorkoutSessionInput {
  id: string;
  startedAt: string;
  exercises: ExercisePerformance[];
}

export interface EffectiveLoad {
  loadLb: number | null;
  assumption: string | null;
}

export interface E1rmEstimate {
  applicable: boolean;
  valueLb: number | null;
  reason: string;
  formula?: "epley";
}

export interface ExerciseSummary {
  exerciseId: string;
  exerciseName: string;
  conventionalVolumeLb: number;
  eccentricLoadRepProduct: number;
  totalReps: number;
  workSetCount: number;
  bestReps: number | null;
  bestDurationSec: number | null;
  /** Heaviest external load among work sets, independent of the best-rep set. */
  bestExternalLoadLb: number | null;
  bestSet: SetInput | null;
}

export interface SessionSummary {
  id: string;
  startedAt: string;
  exercises: ExerciseSummary[];
  conventionalVolumeLb: number;
  totalReps: number;
}

export interface PersonalRecords {
  exerciseId: string;
  bestE1rmLb: number | null;
  bestReps: number | null;
  bestDurationSec: number | null;
  bestEccentricLoadLb: number | null;
  bestConventionalLoadLb: number | null;
  achievedAt: {
    bestE1rmLb: string | null;
    bestReps: string | null;
    bestDurationSec: string | null;
    bestEccentricLoadLb: string | null;
    bestConventionalLoadLb: string | null;
  };
}

export interface ExerciseSessionSnapshot {
  sessionId: string;
  startedAt: string;
  bestReps: number | null;
  totalReps: number;
  bestDurationSec: number | null;
  conventionalVolumeLb: number;
  eccentricLoadRepProduct: number;
  bestExternalLoadLb: number | null;
}

export interface ExerciseComparison {
  exerciseId: string;
  latest: ExerciseSessionSnapshot | null;
  previous: ExerciseSessionSnapshot | null;
  deltaTotalReps: number | null;
  deltaBestReps: number | null;
  deltaBestDurationSec: number | null;
  deltaConventionalVolumeLb: number | null;
}

export interface MuscleExposureRow {
  muscle: string;
  direct: number;
  secondary: number;
}

export interface MuscleExposure {
  heuristic: true;
  muscles: MuscleExposureRow[];
}

export interface OverloadOptions {
  repTarget?: number;
  loadIncrementLb?: number;
  durationTargetSec?: number;
}

export type OverloadKind = "baseline" | "duration" | "load" | "repeat";

export interface OverloadSuggestion {
  exerciseId: string;
  kind: OverloadKind;
  message: string;
  loadIncrementLb: number | null;
  durationIncrementSec: number | null;
}

export interface TrainingFrequency {
  sessions: number;
  weeks: number;
  sessionsPerWeek: number;
}
