import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth";
import { dec, prisma } from "../db";
import { contentHash } from "../idempotency";

const active = { deletedAt: null, supersededAt: null };

export async function createNutrition(ctx: AuthContext, input: {
  recordedAt: string;
  name: string;
  calories?: number | null;
  proteinG?: number | null;
  carbG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
  sodiumMg?: number | null;
  quantity?: number | null;
  meal?: string | null;
  note?: string | null;
  sourceId?: string;
  valueOrigin?: "user_entered" | "imported" | "fixture";
  sourceSystem?: "manual" | "api" | "fixture" | "samsung_health";
}) {
  const row = await prisma.nutritionEntry.create({
    data: {
      userId: ctx.userId,
      recordedAt: new Date(input.recordedAt),
      name: input.name,
      calories: input.calories ?? null,
      proteinG: input.proteinG ?? null,
      carbG: input.carbG ?? null,
      fatG: input.fatG ?? null,
      fiberG: input.fiberG ?? null,
      sodiumMg: input.sodiumMg ?? null,
      quantity: input.quantity ?? null,
      meal: input.meal ?? null,
      note: input.note ?? null,
      valueOrigin: input.valueOrigin ?? "user_entered",
      sourceSystem: input.sourceSystem ?? (ctx.via === "token" ? "api" : "manual"),
      sourceId: input.sourceId,
    },
  });
  await recomputeDaily(ctx.userId, input.recordedAt.slice(0, 10));
  await prisma.auditLog.create({
    data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "create", entityType: "nutrition_entry", entityId: row.id, after: { name: row.name, calories: dec(row.calories) } },
  });
  return serializeNutrition(row);
}

function serializeNutrition(row: {
  id: string;
  recordedAt: Date;
  name: string;
  calories: Prisma.Decimal | null;
  proteinG: Prisma.Decimal | null;
  carbG: Prisma.Decimal | null;
  fatG: Prisma.Decimal | null;
  fiberG: Prisma.Decimal | null;
  sodiumMg: Prisma.Decimal | null;
  meal: string | null;
  valueOrigin: string;
  note: string | null;
}) {
  return {
    id: row.id,
    recordedAt: row.recordedAt.toISOString(),
    name: row.name,
    calories: dec(row.calories),
    proteinG: dec(row.proteinG),
    carbG: dec(row.carbG),
    fatG: dec(row.fatG),
    fiberG: dec(row.fiberG),
    sodiumMg: dec(row.sodiumMg),
    meal: row.meal,
    valueOrigin: row.valueOrigin,
    note: row.note,
  };
}

export async function listNutrition(userId: string, from?: Date | null, to?: Date | null) {
  const rows = await prisma.nutritionEntry.findMany({
    where: { userId, ...active, recordedAt: { gte: from ?? undefined, lte: to ?? undefined } },
    orderBy: { recordedAt: "desc" },
    take: 200,
  });
  const summaries = await prisma.dailyNutritionSummary.findMany({
    where: { userId, ...(from || to ? { date: { gte: from ?? undefined, lte: to ?? undefined } } : {}) },
    orderBy: { date: "desc" },
    take: 60,
  });
  return {
    entries: rows.map(serializeNutrition),
    daily: summaries.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      calories: dec(row.calories),
      proteinG: dec(row.proteinG),
      carbG: dec(row.carbG),
      fatG: dec(row.fatG),
      calculationVersion: row.calculationVersion,
    })),
  };
}

export async function recomputeDaily(userId: string, date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  const entries = await prisma.nutritionEntry.findMany({ where: { userId, ...active, recordedAt: { gte: start, lte: end } } });
  const totals = entries.reduce(
    (sum, entry) => ({
      calories: sum.calories + (dec(entry.calories) ?? 0),
      proteinG: sum.proteinG + (dec(entry.proteinG) ?? 0),
      carbG: sum.carbG + (dec(entry.carbG) ?? 0),
      fatG: sum.fatG + (dec(entry.fatG) ?? 0),
    }),
    { calories: 0, proteinG: 0, carbG: 0, fatG: 0 },
  );
  const calculationVersion = "nutrition-v1";
  await prisma.dailyNutritionSummary.upsert({
    where: { userId_date_calculationVersion: { userId, date: start, calculationVersion } },
    create: { userId, date: start, calculationVersion, inputHash: contentHash(entries.map((entry) => entry.id).sort()), ...totals },
    update: { ...totals, inputHash: contentHash(entries.map((entry) => entry.id).sort()), computedAt: new Date() },
  });
}
