import type { Prisma, ValueOrigin } from "@prisma/client";
import { planImportMerge } from "@/domain/import/merge";
import {
  activityStoredFields,
  hasStoredActivity,
  hasStoredNutrition,
  nutritionStoredFields,
  scaleImportedNumber,
} from "@/domain/import/scale";
import type { ExistingRecord } from "@/domain/import/types";
import type { SamsungDay, SamsungImportDraft, SamsungWorkout } from "@/domain/import/types";
import type { AuthContext } from "../auth";
import { dec, prisma } from "../db";
import { contentHash } from "../idempotency";
import { ensureExercise } from "./workouts";

const TYPE_LABELS: Record<number, string> = { 0: "Other", 1001: "Walking", 1002: "Running", 15004: "Resistance" };

function mergeOrigin(origin: ValueOrigin): ExistingRecord["valueOrigin"] {
  if (origin === "user_entered" || origin === "measured" || origin === "fixture" || origin === "estimated" || origin === "imported") return origin;
  return "imported";
}

async function applyMetric(userId: string, kind: "weight" | "body_fat_percent" | "fat_mass" | "skeletal_muscle", value: number, recordedAt: Date, sourceId: string, group: string) {
  const stored = scaleImportedNumber(value, 3);
  const hash = contentHash({ kind, value: stored, recordedAt: recordedAt.toISOString() });
  const existing = await prisma.bodyMetric.findFirst({
    where: { userId, sourceSystem: "samsung_health", sourceId, kind, supersededAt: null, deletedAt: null },
  });
  const existingValue = existing ? dec(existing.value) : null;
  const incoming = { sourceSystem: "samsung_health", sourceId, contentHash: hash };
  const plan = planImportMerge(existing ? [{
    sourceSystem: "samsung_health",
    sourceId,
    contentHash: contentHash({
      kind,
      value: existingValue == null ? null : scaleImportedNumber(existingValue, 3),
      recordedAt: existing.recordedAt.toISOString(),
    }),
    valueOrigin: mergeOrigin(existing.valueOrigin),
    superseded: false,
  }] : [], [incoming]);
  if (plan.skipUnchanged.length || plan.keepUserCorrection.length) {
    return plan.keepUserCorrection.length ? "kept" : "skipped";
  }
  if (existing && plan.revise.length) {
    await prisma.bodyMetric.update({ where: { id: existing.id }, data: { supersededAt: new Date() } });
  }
  await prisma.bodyMetric.create({
    data: {
      userId,
      kind,
      value: stored,
      canonicalUnit: kind === "body_fat_percent" ? "percent" : "lb",
      originalValue: stored,
      originalUnit: kind === "body_fat_percent" ? "percent" : "lb",
      valueOrigin: "imported",
      recordedAt,
      readingGroupId: group,
      sourceSystem: "samsung_health",
      sourceId,
      supersedesId: existing?.id,
    },
  });
  return existing ? "revised" : "added";
}

async function applyWater(userId: string, value: number, recordedAt: Date, sourceId: string, group: string) {
  const stored = scaleImportedNumber(value, 3);
  const hash = contentHash({ kind: "body_water", value: stored, recordedAt: recordedAt.toISOString() });
  const existing = await prisma.bodyWaterReading.findFirst({
    where: { userId, sourceSystem: "samsung_health", sourceId, supersededAt: null, deletedAt: null },
  });
  const existingValue = existing ? dec(existing.valueLb) : null;
  const incoming = { sourceSystem: "samsung_health", sourceId, contentHash: hash };
  const plan = planImportMerge(existing ? [{
    sourceSystem: "samsung_health",
    sourceId,
    contentHash: contentHash({
      kind: "body_water",
      value: existingValue == null ? null : scaleImportedNumber(existingValue, 3),
      recordedAt: existing.recordedAt.toISOString(),
    }),
    valueOrigin: mergeOrigin(existing.valueOrigin),
    superseded: false,
  }] : [], [incoming]);
  if (plan.skipUnchanged.length || plan.keepUserCorrection.length) return plan.keepUserCorrection.length ? "kept" : "skipped";
  if (existing) await prisma.bodyWaterReading.update({ where: { id: existing.id }, data: { supersededAt: new Date() } });
  await prisma.bodyWaterReading.create({
    data: {
      userId,
      valueLb: stored,
      originalValue: stored,
      originalUnit: "lb",
      valueOrigin: "imported",
      recordedAt,
      readingGroupId: group,
      sourceSystem: "samsung_health",
      sourceId,
      supersedesId: existing?.id,
    },
  });
  return existing ? "revised" : "added";
}

async function applyDay(userId: string, day: SamsungDay, counts: Record<string, number>) {
  const recordedAt = new Date(`${day.date}T12:00:00.000Z`);
  const group = `samsung:${day.date}`;
  const base = day.sourceIds[0] ?? day.date;
  const metrics: Array<["weight" | "body_fat_percent" | "fat_mass" | "skeletal_muscle", number | undefined]> = [
    ["weight", day.weightLb],
    ["body_fat_percent", day.bodyFatPercent],
    ["fat_mass", day.fatMassLb],
    ["skeletal_muscle", day.skeletalMuscleLb],
  ];
  for (const [kind, value] of metrics) {
    if (value == null) continue;
    counts[await applyMetric(userId, kind, value, recordedAt, `${base}:${kind}`, group)] += 1;
  }
  if (day.bodyWaterLb != null) counts[await applyWater(userId, day.bodyWaterLb, recordedAt, `${base}:body_water`, group)] += 1;
  const activity = activityStoredFields(day);
  if (hasStoredActivity(activity)) {
    const sourceId = `${day.date}:activity`;
    const hash = contentHash(activity);
    const existing = await prisma.activityDay.findFirst({ where: { userId, sourceSystem: "samsung_health", sourceId, supersededAt: null, deletedAt: null } });
    const existingActivity = existing
      ? activityStoredFields({ steps: existing.steps, activeCalories: dec(existing.activeCalories), workoutMinutes: dec(existing.workoutMinutes) })
      : null;
    const plan = planImportMerge(existing && existingActivity ? [{
      sourceSystem: "samsung_health",
      sourceId,
      contentHash: contentHash(existingActivity),
      valueOrigin: mergeOrigin(existing.valueOrigin),
      superseded: false,
    }] : [], [{ sourceSystem: "samsung_health", sourceId, contentHash: hash }]);
    if (plan.insert.length || plan.revise.length) {
      if (existing) await prisma.activityDay.update({ where: { id: existing.id }, data: { supersededAt: new Date() } });
      await prisma.activityDay.create({
        data: {
          userId,
          recordedOn: new Date(`${day.date}T00:00:00.000Z`),
          steps: activity.steps,
          activeCalories: activity.active,
          workoutMinutes: activity.minutes,
          valueOrigin: "imported",
          sourceSystem: "samsung_health",
          sourceId,
          supersedesId: existing?.id,
        },
      });
      counts[existing ? "revised" : "added"] += 1;
    } else counts[plan.keepUserCorrection.length ? "kept" : "skipped"] += 1;
  }
  if (day.sleepHours != null) {
    const sourceId = `${day.date}:sleep`;
    const existing = await prisma.sleepSession.findFirst({ where: { userId, sourceSystem: "samsung_health", sourceId, supersededAt: null, deletedAt: null } });
    const hours = scaleImportedNumber(day.sleepHours, 3);
    const hash = contentHash({ hours });
    const existingHours = existing ? dec(existing.durationHours) : null;
    const plan = planImportMerge(existing ? [{
      sourceSystem: "samsung_health",
      sourceId,
      contentHash: contentHash({ hours: existingHours == null ? null : scaleImportedNumber(existingHours, 3) }),
      valueOrigin: mergeOrigin(existing.valueOrigin),
      superseded: false,
    }] : [], [{ sourceSystem: "samsung_health", sourceId, contentHash: hash }]);
    if (plan.insert.length || plan.revise.length) {
      if (existing) await prisma.sleepSession.update({ where: { id: existing.id }, data: { supersededAt: new Date() } });
      await prisma.sleepSession.create({
        data: {
          userId,
          startedAt: recordedAt,
          durationHours: hours,
          valueOrigin: "imported",
          sourceSystem: "samsung_health",
          sourceId,
          supersedesId: existing?.id,
        },
      });
      counts[existing ? "revised" : "added"] += 1;
    } else counts[plan.keepUserCorrection.length ? "kept" : "skipped"] += 1;
  }
  const nutrition = nutritionStoredFields(day);
  if (hasStoredNutrition(nutrition)) {
    const sourceId = `${day.date}:nutrition`;
    const existing = await prisma.nutritionEntry.findFirst({ where: { userId, sourceSystem: "samsung_health", sourceId, supersededAt: null, deletedAt: null } });
    const hash = contentHash(nutrition);
    const existingNutrition = existing
      ? nutritionStoredFields({
          calories: dec(existing.calories),
          proteinG: dec(existing.proteinG),
          carbG: dec(existing.carbG),
          fatG: dec(existing.fatG),
          fiberG: dec(existing.fiberG),
          sodiumMg: dec(existing.sodiumMg),
        })
      : null;
    const plan = planImportMerge(existing && existingNutrition ? [{
      sourceSystem: "samsung_health",
      sourceId,
      contentHash: contentHash(existingNutrition),
      valueOrigin: mergeOrigin(existing.valueOrigin),
      superseded: false,
    }] : [], [{ sourceSystem: "samsung_health", sourceId, contentHash: hash }]);
    if (plan.insert.length || plan.revise.length) {
      if (existing) await prisma.nutritionEntry.update({ where: { id: existing.id }, data: { supersededAt: new Date() } });
      await prisma.nutritionEntry.create({
        data: {
          userId,
          recordedAt,
          name: "Samsung Health nutrition",
          calories: nutrition.calories,
          proteinG: nutrition.protein,
          carbG: nutrition.carbs,
          fatG: nutrition.fat,
          fiberG: nutrition.fiber,
          sodiumMg: nutrition.sodium,
          valueOrigin: "imported",
          sourceSystem: "samsung_health",
          sourceId,
          supersedesId: existing?.id,
        },
      });
      counts[existing ? "revised" : "added"] += 1;
    } else counts[plan.keepUserCorrection.length ? "kept" : "skipped"] += 1;
  }
}

async function applyWorkout(userId: string, workout: SamsungWorkout, counts: Record<string, number>) {
  const label = TYPE_LABELS[workout.exerciseType] ?? `Type ${workout.exerciseType}`;
  const notes = [
    label,
    workout.durationMin != null ? `${workout.durationMin.toFixed(1)} min` : null,
    workout.distanceMi != null ? `${workout.distanceMi.toFixed(2)} mi` : null,
    workout.meanHr != null ? `mean HR ${Math.round(workout.meanHr)}` : null,
    workout.calories != null ? `${Math.round(workout.calories)} kcal` : null,
  ].filter(Boolean).join(" · ");
  const startedAt = new Date(workout.startedAt).toISOString();
  const hash = contentHash({ notes, startedAt });
  const existing = await prisma.workoutSession.findFirst({
    where: { userId, sourceSystem: "samsung_health", sourceId: workout.sourceId, deletedAt: null },
  });
  const plan = planImportMerge(existing ? [{
    sourceSystem: "samsung_health",
    sourceId: workout.sourceId,
    contentHash: contentHash({ notes: existing.notes, startedAt: existing.startedAt.toISOString() }),
    valueOrigin: mergeOrigin(existing.valueOrigin),
    superseded: false,
  }] : [], [{ sourceSystem: "samsung_health", sourceId: workout.sourceId, contentHash: hash }]);
  if (plan.skipUnchanged.length || plan.keepUserCorrection.length) {
    counts[plan.keepUserCorrection.length ? "kept" : "skipped"] += 1;
    return;
  }
  if (existing) await prisma.workoutSession.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  const slug = `samsung-${workout.exerciseType}`;
  await ensureExercise(userId, slug, label, "conventional");
  const exercise = await prisma.exercise.findUniqueOrThrow({ where: { userId_slug: { userId, slug } } });
  await prisma.workoutSession.create({
    data: {
      userId,
      startedAt: new Date(workout.startedAt),
      name: label,
      notes,
      sourceSystem: "samsung_health",
      sourceId: workout.sourceId,
      valueOrigin: "imported",
      exercises: { create: [{ exerciseId: exercise.id, position: 0, notes }] },
    },
  });
  counts[existing ? "revised" : "added"] += 1;
}

export async function persistSamsungImport(ctx: AuthContext, draft: SamsungImportDraft, label?: string) {
  const batch = await prisma.importBatch.create({
    data: { userId: ctx.userId, sourceSystem: "samsung_health", status: "running", label: label ?? "Samsung Health import" },
  });
  const counts = { added: 0, skipped: 0, revised: 0, kept: 0 };
  for (const file of draft.discovered) {
    await prisma.importFile.create({ data: { batchId: batch.id, name: file.name, supported: file.supported, dataset: file.dataset } });
  }
  for (const error of draft.errors) {
    await prisma.importRowError.create({ data: { batchId: batch.id, fileName: error.file, row: error.row, message: error.message } });
  }
  for (const day of draft.days) await applyDay(ctx.userId, day, counts);
  for (const workout of draft.workouts) await applyWorkout(ctx.userId, workout, counts);
  if (draft.profile.birthDate) {
    const profile = await prisma.profile.findUnique({ where: { userId: ctx.userId } });
    if (profile && !profile.birthDate) {
      await prisma.profile.update({ where: { userId: ctx.userId }, data: { birthDate: new Date(`${draft.profile.birthDate}T00:00:00.000Z`) } });
    }
  }
  const summary = {
    added: counts.added,
    skipped: counts.skipped + draft.duplicatesSkipped,
    revised: counts.revised,
    keptCorrections: counts.kept,
    errors: draft.errors.length,
    unsupported: draft.unsupported,
  };
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      status: draft.errors.length ? "completed_with_errors" : "completed",
      finishedAt: new Date(),
      summary: summary as Prisma.InputJsonValue,
    },
  });
  await prisma.syncCheckpoint.upsert({
    where: { userId_sourceSystem: { userId: ctx.userId, sourceSystem: "samsung_health" } },
    create: { userId: ctx.userId, sourceSystem: "samsung_health", cursor: batch.id, lastSyncedAt: new Date() },
    update: { cursor: batch.id, lastSyncedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "import", entityType: "import_batch", entityId: batch.id, after: summary as Prisma.InputJsonValue },
  });
  return { batchId: batch.id, summary, discovered: draft.discovered, errors: draft.errors, unsupported: draft.unsupported };
}

export async function listImports(userId: string) {
  const batches = await prisma.importBatch.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: 30,
    include: { files: true, errors: true },
  });
  return batches.map((batch) => ({
    id: batch.id,
    status: batch.status,
    label: batch.label,
    startedAt: batch.startedAt.toISOString(),
    finishedAt: batch.finishedAt?.toISOString() ?? null,
    summary: batch.summary,
    files: batch.files.map((file) => ({ name: file.name, supported: file.supported, dataset: file.dataset })),
    errors: batch.errors.map((error) => ({ file: error.fileName, row: error.row, message: error.message })),
  }));
}
