/**
 * Round half away from zero to the decimal scale PostgreSQL stores.
 * Repeat-import hashes must use this same number or a Decimal column
 * round-trip never matches the raw float.
 */
export function scaleImportedNumber(value: number, scale: number): number {
  if (!Number.isFinite(value)) return value;
  const negative = value < 0;
  const multiplicator = 10 ** scale;
  const shifted = Number((Math.abs(value) * multiplicator).toFixed(11));
  const rounded = Math.round(shifted) / multiplicator;
  return Number((negative ? -rounded : rounded).toFixed(scale));
}

function scaledOrNull(value: number | null | undefined, scale: number): number | null {
  if (value == null) return null;
  return scaleImportedNumber(value, scale);
}

/** Fields actually written to activity_days. Walk minutes have no column. */
export function activityStoredFields(day: {
  steps?: number | null;
  activeCalories?: number | null;
  workoutMinutes?: number | null;
  walkMinutes?: number | null;
}): { steps: number | null; active: number | null; minutes: number | null } {
  return {
    steps: day.steps ?? null,
    active: scaledOrNull(day.activeCalories, 2),
    minutes: scaledOrNull(day.workoutMinutes, 2),
  };
}

export function hasStoredActivity(fields: { steps: number | null; active: number | null; minutes: number | null }): boolean {
  return fields.steps != null || fields.active != null || fields.minutes != null;
}

export function nutritionStoredFields(day: {
  calories?: number | null;
  proteinG?: number | null;
  carbG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
  sodiumMg?: number | null;
}): {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sodium: number | null;
} {
  return {
    calories: scaledOrNull(day.calories, 2),
    protein: scaledOrNull(day.proteinG, 2),
    carbs: scaledOrNull(day.carbG, 2),
    fat: scaledOrNull(day.fatG, 2),
    fiber: scaledOrNull(day.fiberG, 2),
    sodium: scaledOrNull(day.sodiumMg, 2),
  };
}

export function hasStoredNutrition(fields: {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  sodium: number | null;
}): boolean {
  return Object.values(fields).some((value) => value != null);
}
