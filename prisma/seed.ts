import type { Prisma, SetModality } from "@prisma/client";
import { MUSCLE_CREDITS } from "../src/domain/strength/muscles";
import { hashPassword } from "../src/server/auth";
import { prisma } from "../src/server/db";

const email = process.env.AUTH_EMAIL ?? "owner@localhost";
const password = process.env.AUTH_PASSWORD ?? "change-me-now";

const exercises: Array<{ slug: string; name: string; modality: SetModality; alias?: string }> = [
  { slug: "dead-hang", name: "Dead hang", modality: "isometric" },
  { slug: "pull-up", name: "Pull-up", modality: "bodyweight", alias: "pullup" },
  { slug: "dumbbell-shoulder-press", name: "Dumbbell shoulder press", modality: "conventional", alias: "db shoulder press" },
  { slug: "eccentric-calf-raise", name: "Eccentric-only calf raise", modality: "eccentric_only" },
  { slug: "deadlift", name: "Deadlift", modality: "conventional" },
];

function loadModel(modality: SetModality) {
  if (modality === "eccentric_only") return "eccentric_only" as const;
  if (modality === "isometric") return "isometric_duration" as const;
  if (modality === "bodyweight") return "bodyweight" as const;
  return "external" as const;
}

export async function clearFixtures(userId?: string) {
  const scoped = userId ? { userId } : {};
  const fixture = { ...scoped, sourceSystem: "fixture" as const };
  await prisma.workoutSession.deleteMany({ where: fixture });
  await prisma.personalRecord.deleteMany({ where: { exercise: { notes: "fixture", ...scoped } } });
  await prisma.goal.deleteMany({ where: fixture });
  await prisma.bodyMetric.deleteMany({ where: fixture });
  await prisma.bodyWaterReading.deleteMany({ where: fixture });
  await prisma.circumferenceReading.deleteMany({ where: fixture });
  await prisma.nutritionEntry.deleteMany({ where: fixture });
  await prisma.activityDay.deleteMany({ where: fixture });
  await prisma.sleepSession.deleteMany({ where: fixture });
  await prisma.forecastScenario.deleteMany({ where: { ...scoped, name: { startsWith: "Fixture:" } } });
  const rows = await prisma.exercise.findMany({
    where: { ...scoped, notes: "fixture" },
    include: { performances: { select: { id: true } } },
  });
  for (const row of rows) {
    if (row.performances.length === 0) await prisma.exercise.delete({ where: { id: row.id } });
  }
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash: hashPassword(password) },
  });
  await prisma.profile.upsert({
    where: { userId: user.id },
    update: {
      heightInches: 66,
      timezone: "America/New_York",
      notes: "Fixture profile. Long-term aim: a muscular, strong physique with substantial arms, shoulders, back, chest, and legs. Aspirational weight is 170–175 lb near 18% body fat. These seed rows are fixtures, not verified imports.",
    },
    create: {
      userId: user.id,
      displayName: "Fixture athlete",
      heightInches: 66,
      timezone: "America/New_York",
      notes: "Fixture profile. Long-term aim: a muscular, strong physique with substantial arms, shoulders, back, chest, and legs. Aspirational weight is 170–175 lb near 18% body fat. These seed rows are fixtures, not verified imports.",
    },
  });
  await clearFixtures(user.id);

  for (const version of [
    ["body-comp", "body-comp-v1", "Hydration-context and two-compartment estimates. Not medical measurements. Fat-free mass is not muscle."],
    ["forecast", "forecast-v1", "Linear baseline plus a capped energy heuristic. Dates and bands are not guaranteed outcomes."],
    ["nutrition", "nutrition-v1", "Daily totals are the sum of active nutrition entries."],
    ["strength", "strength-v1", "Epley e1RM only for conventional reps 1–12. Eccentric and isometric work are excluded."],
  ] as const) {
    await prisma.calculationVersion.upsert({
      where: { key_version: { key: version[0], version: version[1] } },
      update: { description: version[2] },
      create: { key: version[0], version: version[1], description: version[2] },
    });
  }

  for (const exercise of exercises) {
    const created = await prisma.exercise.create({
      data: {
        userId: user.id,
        slug: exercise.slug,
        name: exercise.name,
        modality: exercise.modality,
        loadModel: loadModel(exercise.modality),
        allowE1rm: exercise.modality !== "eccentric_only" && exercise.modality !== "isometric",
        muscleCredits: (MUSCLE_CREDITS[exercise.slug] ?? []) as unknown as Prisma.InputJsonValue,
        notes: "fixture",
      },
    });
    if (exercise.alias) {
      await prisma.exerciseAlias.create({ data: { exerciseId: created.id, alias: exercise.alias } });
    }
  }

  const bySlug = Object.fromEntries((await prisma.exercise.findMany({ where: { userId: user.id } })).map((row) => [row.slug, row.id]));

  async function metric(kind: "weight" | "body_fat_percent" | "fat_mass", value: number, at: string, sourceId: string, group: string) {
    await prisma.bodyMetric.create({
      data: {
        userId: user.id,
        kind,
        value,
        canonicalUnit: kind === "body_fat_percent" ? "percent" : "lb",
        originalValue: value,
        originalUnit: kind === "body_fat_percent" ? "percent" : "lb",
        valueOrigin: "fixture",
        recordedAt: new Date(at),
        readingGroupId: group,
        sourceSystem: "fixture",
        sourceId,
        note: "Development fixture. Not a verified import.",
      },
    });
  }

  await metric("weight", 152.4, "2026-06-01T11:00:00.000Z", "fixture:2026-06-01:weight", "fixture-2026-06-01");
  await metric("body_fat_percent", 20.5, "2026-06-01T11:00:00.000Z", "fixture:2026-06-01:bf", "fixture-2026-06-01");
  await metric("fat_mass", 31.242, "2026-06-01T11:00:00.000Z", "fixture:2026-06-01:fat", "fixture-2026-06-01");
  await metric("weight", 151, "2026-09-15T11:00:00.000Z", "fixture:2026-09-15:weight", "fixture-2026-09-15");
  await metric("body_fat_percent", 18.9, "2026-09-15T11:00:00.000Z", "fixture:2026-09-15:bf", "fixture-2026-09-15");
  await metric("fat_mass", 28.539, "2026-09-15T11:00:00.000Z", "fixture:2026-09-15:fat", "fixture-2026-09-15");

  const tape: Array<["neck" | "chest" | "waist" | "hips" | "thigh_left" | "thigh_right" | "upper_arm_left" | "upper_arm_right", number]> = [
    ["neck", 12.5],
    ["chest", 33],
    ["waist", 28],
    ["hips", 34],
    ["thigh_left", 24],
    ["thigh_right", 24],
    ["upper_arm_left", 11],
    ["upper_arm_right", 11],
  ];
  for (const [site, value] of tape) {
    await prisma.circumferenceReading.create({
      data: {
        userId: user.id,
        site,
        valueInches: value,
        originalValue: value,
        originalUnit: "in",
        valueOrigin: "fixture",
        recordedAt: new Date("2026-08-24T11:00:00.000Z"),
        readingGroupId: "fixture-tape-2026-08-24",
        sourceSystem: "fixture",
        sourceId: `fixture:tape:${site}`,
        note: "Development fixture tape baseline.",
      },
    });
  }

  await prisma.workoutSession.create({
    data: {
      userId: user.id,
      startedAt: new Date("2026-10-03T15:00:00.000Z"),
      name: "Dead hang",
      notes: "Fixture. Best dead hang 40 seconds.",
      sourceSystem: "fixture",
      sourceId: "fixture:dead-hang:2026-10-03",
      valueOrigin: "fixture",
      exercises: {
        create: [{
          exerciseId: bySlug["dead-hang"],
          position: 0,
          sets: { create: [{ position: 0, modality: "isometric", durationSec: 40, isWarmup: false }] },
        }],
      },
    },
  });

  await prisma.workoutSession.create({
    data: {
      userId: user.id,
      startedAt: new Date("2026-10-09T15:00:00.000Z"),
      name: "Upper pull and accessories",
      notes: "Fixture. Pull-ups are dated 2026-10-09. Shoulder press and eccentric calf-raise dates were not specified, so they are grouped in this labeled fixture session.",
      sourceSystem: "fixture",
      sourceId: "fixture:session:2026-10-09",
      valueOrigin: "fixture",
      exercises: {
        create: [
          {
            exerciseId: bySlug["pull-up"],
            position: 0,
            sets: {
              create: [2, 2, 1].map((reps, position) => ({ position, modality: "bodyweight" as const, reps, bodyWeightLb: 151, isWarmup: false })),
            },
          },
          {
            exerciseId: bySlug["dumbbell-shoulder-press"],
            position: 1,
            sets: { create: [{ position: 0, modality: "conventional", reps: 12, externalLoadLb: 25, isWarmup: false, notes: "25 lb dumbbell" }] },
          },
          {
            exerciseId: bySlug["eccentric-calf-raise"],
            position: 2,
            sets: {
              create: [0, 1].map((position) => ({
                position,
                modality: "eccentric_only" as const,
                reps: 10,
                externalLoadLb: 80,
                isWarmup: false,
                notes: "80 lb per handle",
              })),
            },
          },
        ],
      },
    },
  });

  const goals = [
    { type: "weight" as const, name: "Milestone 155 lb", targetValue: 155, targetUnit: "lb", direction: "up" },
    { type: "weight" as const, name: "Milestone 160 lb", targetValue: 160, targetUnit: "lb", direction: "up" },
    { type: "weight" as const, name: "Milestone 165 lb", targetValue: 165, targetUnit: "lb", direction: "up" },
    { type: "weight" as const, name: "Aspirational weight", targetValue: 172.5, targetHigh: 175, targetUnit: "lb", direction: "up", notes: "Range 170–175 lb near 18% body fat." },
    { type: "body_fat_percent" as const, name: "Aspirational body fat", targetValue: 18, targetUnit: "percent", direction: "down", notes: "Approximate target alongside the 170–175 lb range." },
    { type: "deadlift_weight" as const, name: "Deadlift 400 lb", targetValue: 400, targetUnit: "lb", direction: "up", exerciseSlug: "deadlift" },
  ];
  for (const goal of goals) {
    await prisma.goal.create({
      data: { userId: user.id, sourceSystem: "fixture", status: "active", ...goal },
    });
  }

  console.log(`Seeded fixture data for ${email}. Password comes from AUTH_PASSWORD and is not printed.`);
}

if (process.argv[1]?.includes("seed.ts")) {
  main().then(() => prisma.$disconnect()).catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
}
