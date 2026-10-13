import type { GoalType, Prisma } from "@prisma/client";
import { detectPlateau, FORECAST_VERSION, projectCapped, projectLinear, type SeriesPoint } from "@/domain/forecast";
import { projectGoal, type GoalSpec } from "@/domain/forecast/goals";
import type { AuthContext } from "../auth";
import { dec, prisma } from "../db";
import { loadBodyReadings } from "./body";
import { loadSessions, toSessionInput } from "./workouts";
import { personalRecords } from "@/domain/strength/calculate";

const active = { deletedAt: null, supersededAt: null };

export async function createGoal(ctx: AuthContext, input: {
  type: GoalType;
  name: string;
  targetValue: number;
  targetHigh?: number | null;
  targetUnit: string;
  targetDate?: string | null;
  direction?: string;
  circumferenceSite?: "neck" | "chest" | "waist" | "hips" | "thigh_left" | "thigh_right" | "upper_arm_left" | "upper_arm_right" | "other";
  exerciseSlug?: string;
  notes?: string | null;
  sourceSystem?: "manual" | "api" | "fixture";
}) {
  const goal = await prisma.goal.create({
    data: {
      userId: ctx.userId,
      type: input.type,
      name: input.name,
      targetValue: input.targetValue,
      targetHigh: input.targetHigh ?? null,
      targetUnit: input.targetUnit,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      direction: input.direction ?? (input.type === "body_fat_percent" || input.type === "fat_mass" ? "down" : "up"),
      circumferenceSite: input.circumferenceSite,
      exerciseSlug: input.exerciseSlug,
      notes: input.notes ?? null,
      sourceSystem: input.sourceSystem ?? (ctx.via === "token" ? "api" : "manual"),
    },
  });
  await prisma.auditLog.create({
    data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "create", entityType: "goal", entityId: goal.id, after: { name: goal.name, type: goal.type, target: input.targetValue } },
  });
  return serializeGoal(goal, null);
}

function serializeGoal(goal: {
  id: string;
  type: GoalType;
  name: string;
  targetValue: Prisma.Decimal;
  targetHigh: Prisma.Decimal | null;
  targetUnit: string;
  targetDate: Date | null;
  direction: string | null;
  circumferenceSite: string | null;
  exerciseSlug: string | null;
  status: string;
  notes: string | null;
  sourceSystem: string;
}, projection: ReturnType<typeof projectGoal> | null) {
  return {
    id: goal.id,
    type: goal.type,
    name: goal.name,
    targetValue: dec(goal.targetValue),
    targetHigh: dec(goal.targetHigh),
    targetUnit: goal.targetUnit,
    targetDate: goal.targetDate?.toISOString() ?? null,
    direction: goal.direction,
    circumferenceSite: goal.circumferenceSite,
    exerciseSlug: goal.exerciseSlug,
    status: goal.status,
    notes: goal.notes,
    sourceSystem: goal.sourceSystem,
    projection,
  };
}

async function seriesForGoal(userId: string, goal: { type: GoalType; exerciseSlug: string | null; circumferenceSite: string | null }): Promise<SeriesPoint[]> {
  if (goal.type === "weight" || goal.type === "body_fat_percent" || goal.type === "fat_mass") {
    const readings = await loadBodyReadings(userId);
    return readings.flatMap((reading) => {
      const value = goal.type === "weight" ? reading.weightLb : goal.type === "body_fat_percent" ? reading.bodyFatPercent : reading.fatMassLb;
      return value == null ? [] : [{ at: reading.recordedAt, value }];
    });
  }
  if (goal.type === "circumference" && goal.circumferenceSite) {
    const rows = await prisma.circumferenceReading.findMany({ where: { userId, site: goal.circumferenceSite as never, ...active }, orderBy: { recordedAt: "asc" } });
    return rows.flatMap((row) => (dec(row.valueInches) == null ? [] : [{ at: row.recordedAt.toISOString(), value: dec(row.valueInches) as number }]));
  }
  if (goal.type === "pull_up_reps" || goal.type === "hold_duration" || goal.type === "dumbbell_press_weight" || goal.type === "deadlift_weight") {
    const slug = goal.exerciseSlug ?? (goal.type === "pull_up_reps" ? "pull-up" : goal.type === "hold_duration" ? "dead-hang" : goal.type === "deadlift_weight" ? "deadlift" : "dumbbell-shoulder-press");
    const sessions = await loadSessions(userId);
    const inputs = sessions.map(toSessionInput).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return inputs.flatMap((session) => {
      const records = personalRecords([session], slug);
      const value = goal.type === "pull_up_reps" ? records.bestReps : goal.type === "hold_duration" ? records.bestDurationSec : records.bestConventionalLoadLb ?? records.bestE1rmLb;
      return value == null ? [] : [{ at: session.startedAt, value }];
    });
  }
  if (goal.type === "training_frequency") {
    const sessions = await loadSessions(userId);
    const weeks = new Map<string, number>();
    for (const session of sessions) {
      const week = session.startedAt.toISOString().slice(0, 10);
      weeks.set(week, (weeks.get(week) ?? 0) + 1);
    }
    return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([at, value]) => ({ at: `${at}T00:00:00.000Z`, value }));
  }
  if (goal.type === "calories" || goal.type === "protein") {
    const rows = await prisma.dailyNutritionSummary.findMany({ where: { userId }, orderBy: { date: "asc" } });
    return rows.flatMap((row) => {
      const value = goal.type === "calories" ? dec(row.calories) : dec(row.proteinG);
      return value == null ? [] : [{ at: row.date.toISOString(), value }];
    });
  }
  return [];
}

function specFor(goal: { type: GoalType; targetValue: Prisma.Decimal; direction: string | null }): GoalSpec | null {
  const target = dec(goal.targetValue);
  if (target == null) return null;
  const direction = goal.direction === "down" ? "down" : "up";
  if (goal.type === "pull_up_reps" || goal.type === "hold_duration") return { type: goal.type, target, direction: "up" };
  if (goal.type === "custom") return null;
  return { type: goal.type, target, direction };
}

export async function listGoals(userId: string) {
  const goals = await prisma.goal.findMany({ where: { userId, status: { in: ["active", "achieved"] } }, orderBy: { createdAt: "asc" } });
  const results = [];
  for (const goal of goals) {
    const spec = specFor(goal);
    const points = await seriesForGoal(userId, goal);
    const projection = spec ? projectGoal(points, spec) : null;
    results.push(serializeGoal(goal, projection));
  }
  return results;
}

export async function forecastReport(userId: string, input?: { name?: string; mode: "conservative" | "expected" | "aggressive"; intakeKcal: number; tdeeKcal: number; horizonDays: number }) {
  const readings = await loadBodyReadings(userId);
  const weightPoints: SeriesPoint[] = readings.flatMap((reading) => (reading.weightLb == null ? [] : [{ at: reading.recordedAt, value: reading.weightLb }]));
  const linear = projectLinear(weightPoints, input?.horizonDays ?? 28);
  const plateau = detectPlateau(weightPoints);
  const latest = readings.at(-1);
  let capped = null;
  if (input && latest?.weightLb && latest.fatMassLb != null) {
    capped = projectCapped({
      weightLb: latest.weightLb,
      fatMassLb: latest.fatMassLb,
      intakeKcal: input.intakeKcal,
      tdeeKcal: input.tdeeKcal,
      horizonDays: input.horizonDays,
      mode: input.mode,
    });
  }
  return {
    version: FORECAST_VERSION,
    linear,
    plateau,
    capped,
    disclaimer: "Forecasts are estimates. They are not guaranteed biological outcomes.",
  };
}

export async function saveForecast(ctx: AuthContext, input: { name: string; mode: "conservative" | "expected" | "aggressive"; intakeKcal: number; tdeeKcal: number; horizonDays: number }) {
  const result = await forecastReport(ctx.userId, input);
  const row = await prisma.forecastScenario.create({
    data: {
      userId: ctx.userId,
      name: input.name,
      assumptions: input as unknown as Prisma.InputJsonValue,
      result: result as unknown as Prisma.InputJsonValue,
      calculationVersion: FORECAST_VERSION,
    },
  });
  return { id: row.id, name: row.name, calculatedAt: row.calculatedAt.toISOString(), result };
}
