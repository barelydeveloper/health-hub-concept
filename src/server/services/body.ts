import { randomBytes } from "node:crypto";
import type { BodyMetricKind, CircumferenceSite, ValueOrigin } from "@prisma/client";
import { analyzeBodyComposition } from "@/domain/body-composition";
import type { BodyReading } from "@/domain/body-composition";
import type { AuthContext } from "../auth";
import { dec, prisma } from "../db";

const active = { deletedAt: null, supersededAt: null };

export async function loadBodyReadings(userId: string, from?: Date | null, to?: Date | null): Promise<BodyReading[]> {
  const recordedAt = from || to ? { gte: from ?? undefined, lte: to ?? undefined } : undefined;
  const [metrics, water] = await Promise.all([
    prisma.bodyMetric.findMany({ where: { userId, ...active, ...(recordedAt ? { recordedAt } : {}) }, orderBy: { recordedAt: "asc" } }),
    prisma.bodyWaterReading.findMany({ where: { userId, ...active, ...(recordedAt ? { recordedAt } : {}) }, orderBy: { recordedAt: "asc" } }),
  ]);
  const groups = new Map<string, BodyReading>();
  for (const metric of metrics) {
    const key = metric.readingGroupId ?? `${metric.recordedAt.toISOString()}:${metric.id}`;
    const row = groups.get(key) ?? { recordedAt: metric.recordedAt.toISOString() };
    const value = dec(metric.value);
    if (metric.kind === "weight") row.weightLb = value;
    if (metric.kind === "body_fat_percent") row.bodyFatPercent = value;
    if (metric.kind === "fat_mass") row.fatMassLb = value;
    if (metric.kind === "skeletal_muscle") row.skeletalMuscleLb = value;
    groups.set(key, row);
  }
  for (const reading of water) {
    const key = reading.readingGroupId ?? `${reading.recordedAt.toISOString()}:water`;
    const row = groups.get(key) ?? groups.get(reading.readingGroupId ?? "") ?? { recordedAt: reading.recordedAt.toISOString() };
    row.bodyWaterLb = dec(reading.valueLb);
    row.recordedAt = reading.recordedAt.toISOString();
    groups.set(reading.readingGroupId ?? key, row);
  }
  return [...groups.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export async function bodyTrends(userId: string, from?: Date | null, to?: Date | null) {
  const readings = await loadBodyReadings(userId, from, to);
  return { readings, analysis: analyzeBodyComposition(readings) };
}

function metricValue(kind: BodyMetricKind, input: MeasurementInput): number | undefined {
  if (kind === "weight") return input.weightLb;
  if (kind === "body_fat_percent") return input.bodyFatPercent;
  if (kind === "fat_mass") return input.fatMassLb;
  if (kind === "fat_free_mass") return input.fatFreeMassLb;
  if (kind === "skeletal_muscle") return input.skeletalMuscleLb;
  return undefined;
}

const metricUnit: Record<BodyMetricKind, string> = {
  weight: "lb",
  body_fat_percent: "percent",
  fat_mass: "lb",
  fat_free_mass: "lb",
  skeletal_muscle: "lb",
};

export interface MeasurementInput {
  recordedAt: string;
  site?: CircumferenceSite;
  siteLabel?: string;
  valueInches?: number;
  weightLb?: number;
  bodyFatPercent?: number;
  fatMassLb?: number;
  fatFreeMassLb?: number;
  skeletalMuscleLb?: number;
  bodyWaterLb?: number;
  note?: string;
  sourceId?: string;
  valueOrigin?: ValueOrigin;
  sourceSystem?: "manual" | "api" | "fixture" | "samsung_health";
}

export async function createMeasurement(ctx: AuthContext, input: MeasurementInput) {
  const recordedAt = new Date(input.recordedAt);
  const group = randomBytes(8).toString("hex");
  const sourceSystem = input.sourceSystem ?? (ctx.via === "token" ? "api" : "manual");
  const valueOrigin = input.valueOrigin ?? "user_entered";
  if (input.site && input.valueInches != null) {
    const row = await prisma.circumferenceReading.create({
      data: {
        userId: ctx.userId,
        site: input.site,
        siteLabel: input.siteLabel,
        valueInches: input.valueInches,
        originalValue: input.valueInches,
        originalUnit: "in",
        valueOrigin,
        recordedAt,
        readingGroupId: group,
        sourceSystem,
        sourceId: input.sourceId,
        note: input.note,
      },
    });
    await prisma.auditLog.create({
      data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "create", entityType: "circumference", entityId: row.id, after: { site: input.site, valueInches: input.valueInches } },
    });
    return { id: row.id, kind: "circumference" as const, recordedAt: row.recordedAt.toISOString() };
  }
  const kinds: BodyMetricKind[] = ["weight", "body_fat_percent", "fat_mass", "fat_free_mass", "skeletal_muscle"];
  const created = [];
  for (const kind of kinds) {
    const value = metricValue(kind, input);
    if (value == null) continue;
    const row = await prisma.bodyMetric.create({
      data: {
        userId: ctx.userId,
        kind,
        value,
        canonicalUnit: metricUnit[kind],
        originalValue: value,
        originalUnit: metricUnit[kind],
        valueOrigin,
        recordedAt,
        readingGroupId: group,
        sourceSystem,
        sourceId: input.sourceId ? `${input.sourceId}:${kind}` : null,
        note: input.note,
      },
    });
    created.push({ id: row.id, kind });
  }
  if (input.bodyWaterLb != null) {
    const row = await prisma.bodyWaterReading.create({
      data: {
        userId: ctx.userId,
        valueLb: input.bodyWaterLb,
        originalValue: input.bodyWaterLb,
        originalUnit: "lb",
        valueOrigin,
        recordedAt,
        readingGroupId: group,
        sourceSystem,
        sourceId: input.sourceId ? `${input.sourceId}:body_water` : null,
        note: input.note,
      },
    });
    created.push({ id: row.id, kind: "body_water" as const });
  }
  await prisma.auditLog.create({
    data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "create", entityType: "measurement", entityId: group, after: { recordedAt: input.recordedAt, ids: created } },
  });
  return { readingGroupId: group, recordedAt: input.recordedAt, records: created };
}

export async function listMeasurements(userId: string, options: { limit: number; cursor: { at: string; id: string } | null; from: Date | null; to: Date | null }) {
  const rows = await prisma.bodyMetric.findMany({
    where: {
      userId,
      ...active,
      recordedAt: { gte: options.from ?? undefined, lte: options.to ?? undefined },
      ...(options.cursor
        ? { OR: [{ recordedAt: { lt: new Date(options.cursor.at) } }, { recordedAt: new Date(options.cursor.at), id: { lt: options.cursor.id } }] }
        : {}),
    },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: options.limit + 1,
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    value: dec(row.value),
    unit: row.canonicalUnit,
    valueOrigin: row.valueOrigin,
    recordedAt: row.recordedAt.toISOString(),
    sourceSystem: row.sourceSystem,
    note: row.note,
  }));
}

export async function correctMeasurement(ctx: AuthContext, id: string, value: number, note?: string) {
  const metric = await prisma.bodyMetric.findFirst({ where: { id, userId: ctx.userId, ...active } });
  if (metric) {
    const created = await prisma.$transaction(async (tx) => {
      await tx.bodyMetric.update({ where: { id }, data: { supersededAt: new Date() } });
      return tx.bodyMetric.create({
        data: {
          userId: ctx.userId,
          kind: metric.kind,
          value,
          canonicalUnit: metric.canonicalUnit,
          originalValue: value,
          originalUnit: metric.originalUnit,
          valueOrigin: metric.valueOrigin === "fixture" ? "fixture" : "user_entered",
          recordedAt: metric.recordedAt,
          readingGroupId: metric.readingGroupId,
          sourceSystem: metric.sourceSystem,
          sourceId: metric.sourceId,
          supersedesId: metric.id,
          note: note ?? metric.note,
        },
      });
    });
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        actorTokenId: ctx.tokenId,
        action: "correct",
        entityType: "body_metric",
        entityId: id,
        before: { value: dec(metric.value) },
        after: { value, id: created.id },
      },
    });
    return { id: created.id, supersedesId: id, kind: metric.kind, value };
  }
  const water = await prisma.bodyWaterReading.findFirst({ where: { id, userId: ctx.userId, ...active } });
  if (!water) return null;
  const created = await prisma.$transaction(async (tx) => {
    await tx.bodyWaterReading.update({ where: { id }, data: { supersededAt: new Date() } });
    return tx.bodyWaterReading.create({
      data: {
        userId: ctx.userId,
        valueLb: value,
        originalValue: value,
        originalUnit: "lb",
        valueOrigin: water.valueOrigin === "fixture" ? "fixture" : "user_entered",
        recordedAt: water.recordedAt,
        readingGroupId: water.readingGroupId,
        sourceSystem: water.sourceSystem,
        sourceId: water.sourceId,
        supersedesId: water.id,
        note: note ?? water.note,
      },
    });
  });
  await prisma.auditLog.create({
    data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "correct", entityType: "body_water", entityId: id, before: { value: dec(water.valueLb) }, after: { value, id: created.id } },
  });
  return { id: created.id, supersedesId: id, kind: "body_water" as const, value };
}

export async function deleteMeasurement(ctx: AuthContext, id: string) {
  const metric = await prisma.bodyMetric.findFirst({ where: { id, userId: ctx.userId, ...active } });
  if (metric) {
    await prisma.bodyMetric.update({ where: { id }, data: { deletedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "delete", entityType: "body_metric", entityId: id, before: { value: dec(metric.value), kind: metric.kind } } });
    return { id, deleted: true };
  }
  const water = await prisma.bodyWaterReading.findFirst({ where: { id, userId: ctx.userId, ...active } });
  if (!water) return null;
  await prisma.bodyWaterReading.update({ where: { id }, data: { deletedAt: new Date() } });
  await prisma.auditLog.create({ data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "delete", entityType: "body_water", entityId: id, before: { value: dec(water.valueLb) } } });
  return { id, deleted: true };
}

export async function listCircumferences(userId: string) {
  const rows = await prisma.circumferenceReading.findMany({
    where: { userId, ...active },
    orderBy: { recordedAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    site: row.site,
    siteLabel: row.siteLabel,
    valueInches: dec(row.valueInches),
    recordedAt: row.recordedAt.toISOString(),
    valueOrigin: row.valueOrigin,
  }));
}
