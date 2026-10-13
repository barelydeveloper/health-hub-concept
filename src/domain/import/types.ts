export interface ImportError {
  file: string;
  row: number | null;
  message: string;
}

export type SamsungDataset =
  | "weight"
  | "steps"
  | "nutrition"
  | "sleepCombined"
  | "sleep"
  | "exercise"
  | "caloriesBurned"
  | "daySummary"
  | "userProfile"
  | "liveData";

export interface SamsungDay {
  date: string;
  sourceIds: string[];
  weightLb?: number;
  bodyFatPercent?: number;
  fatMassLb?: number;
  skeletalMuscleLb?: number;
  bodyWaterLb?: number;
  original?: Record<string, unknown>;
  steps?: number;
  calories?: number;
  proteinG?: number;
  carbG?: number;
  fatG?: number;
  fiberG?: number;
  sodiumMg?: number;
  sleepHours?: number;
  workoutMinutes?: number;
  exerciseCalories?: number;
  resistanceTraining?: boolean;
  bmr?: number;
  activeCalories?: number;
  burnedCalories?: number;
  walkMinutes?: number;
}

export interface SamsungWorkout {
  sourceId: string;
  startedAt: string;
  exerciseType: number;
  durationMin: number | null;
  distanceMi: number | null;
  calories: number | null;
  meanSpeedMph: number | null;
  maxSpeedMph: number | null;
  meanHr: number | null;
  maxHr: number | null;
  minHr: number | null;
  meanCadence: number | null;
  payload: Record<string, unknown>;
}

export interface SamsungImportDraft {
  sourceSystem: "samsung_health";
  discovered: { name: string; dataset: string | null; supported: boolean }[];
  unsupported: string[];
  errors: ImportError[];
  duplicatesSkipped: number;
  profile: { birthDate: string | null };
  days: SamsungDay[];
  workouts: SamsungWorkout[];
}

export interface ExistingRecord {
  sourceSystem: string;
  sourceId: string;
  contentHash: string;
  valueOrigin: "imported" | "user_entered" | "fixture" | "measured" | "estimated";
  superseded: boolean;
}

export interface IncomingRecord {
  sourceSystem: string;
  sourceId: string;
  contentHash: string;
}

export interface MergePlan {
  insert: IncomingRecord[];
  skipUnchanged: IncomingRecord[];
  /** Source changed and the active row is imported, fixture, or estimated. */
  revise: IncomingRecord[];
  /** Do not overwrite user_entered or measured corrections. */
  keepUserCorrection: IncomingRecord[];
}
