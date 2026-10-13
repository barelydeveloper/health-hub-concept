import type { Prisma, SetModality, Side } from "@prisma/client";
import { MUSCLE_CREDITS } from "@/domain/strength/muscles";
import type { MuscleCredit, SetInput, WorkoutSessionInput } from "@/domain/strength/types";
import { summarizeSession } from "@/domain/strength/calculate";
import type { AuthContext } from "../auth";
import { dec, prisma } from "../db";

const activeSet = { deletedAt: null, supersededAt: null };

export async function ensureExercise(userId: string, slug: string, name?: string, modality?: SetModality) {
  const existing = await prisma.exercise.findUnique({ where: { userId_slug: { userId, slug } } });
  if (existing) return existing;
  const credits = MUSCLE_CREDITS[slug] ?? [];
  const resolvedModality = modality ?? "conventional";
  const loadModel = resolvedModality === "eccentric_only"
    ? "eccentric_only"
    : resolvedModality === "isometric"
      ? "isometric_duration"
      : resolvedModality === "assisted"
        ? "assisted"
        : resolvedModality === "bodyweight"
          ? "bodyweight"
          : resolvedModality === "weighted_bodyweight"
            ? "weighted_bodyweight"
            : "external";
  return prisma.exercise.create({
    data: {
      userId,
      slug,
      name: name ?? slug,
      modality: resolvedModality,
      loadModel,
      allowE1rm: resolvedModality !== "eccentric_only" && resolvedModality !== "isometric",
      muscleCredits: credits as unknown as Prisma.InputJsonValue,
    },
  });
}

function setData(set: SetInput & { tempo?: string | null; effort?: string | null }, position: number) {
  return {
    position,
    modality: set.modality,
    reps: set.reps ?? null,
    durationSec: set.durationSec ?? null,
    externalLoadLb: set.externalLoadLb ?? null,
    addedLoadLb: set.addedLoadLb ?? null,
    assistanceLb: set.assistanceLb ?? null,
    bodyWeightLb: set.bodyWeightLb ?? null,
    rpe: set.rpe ?? null,
    rir: set.rir ?? null,
    side: (set.side ?? null) as Side | null,
    isWarmup: set.isWarmup ?? false,
    tempo: set.tempo ?? null,
    effort: set.effort ?? null,
    notes: set.notes ?? null,
  };
}

const sessionInclude = {
  exercises: {
    orderBy: { position: "asc" as const },
    include: {
      exercise: true,
      sets: { where: activeSet, orderBy: { position: "asc" as const } },
    },
  },
};

export async function loadSessions(userId: string, where: Prisma.WorkoutSessionWhereInput = {}, take?: number) {
  return prisma.workoutSession.findMany({
    where: { userId, deletedAt: null, ...where },
    include: sessionInclude,
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take,
  });
}

type LoadedSession = Awaited<ReturnType<typeof loadSessions>>[number];

export function toSetInput(set: LoadedSession["exercises"][number]["sets"][number]): SetInput {
  return {
    modality: set.modality,
    reps: set.reps,
    durationSec: dec(set.durationSec),
    externalLoadLb: dec(set.externalLoadLb),
    addedLoadLb: dec(set.addedLoadLb),
    assistanceLb: dec(set.assistanceLb),
    bodyWeightLb: dec(set.bodyWeightLb),
    rpe: dec(set.rpe),
    rir: dec(set.rir),
    side: set.side,
    isWarmup: set.isWarmup,
    notes: set.notes,
  };
}

export function toSessionInput(session: LoadedSession): WorkoutSessionInput {
  return {
    id: session.id,
    startedAt: session.startedAt.toISOString(),
    exercises: session.exercises.map((exercise) => ({
      exerciseId: exercise.exercise.slug,
      exerciseName: exercise.exercise.name,
      muscleCredits: (exercise.exercise.muscleCredits as MuscleCredit[] | null) ?? undefined,
      sets: exercise.sets.map(toSetInput),
    })),
  };
}

export function serializeSession(session: LoadedSession) {
  const summary = summarizeSession(toSessionInput(session));
  return {
    id: session.id,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    name: session.name,
    notes: session.notes,
    timezone: session.timezone,
    sourceSystem: session.sourceSystem,
    sourceId: session.sourceId,
    valueOrigin: session.valueOrigin,
    summary,
    exercises: session.exercises.map((exercise) => ({
      id: exercise.id,
      slug: exercise.exercise.slug,
      name: exercise.exercise.name,
      notes: exercise.notes,
      sets: exercise.sets.map((set) => ({ id: set.id, ...toSetInput(set), tempo: set.tempo, effort: set.effort })),
    })),
  };
}

export async function createWorkout(ctx: AuthContext, input: {
  startedAt: string;
  endedAt?: string | null;
  name?: string | null;
  notes?: string | null;
  timezone?: string;
  sourceId?: string | null;
  exercises: { exerciseSlug: string; exerciseName?: string; notes?: string | null; sets: SetInput[] }[];
}) {
  const exercises = [];
  for (const [index, exercise] of input.exercises.entries()) {
    const row = await ensureExercise(ctx.userId, exercise.exerciseSlug, exercise.exerciseName, exercise.sets[0]?.modality);
    exercises.push({
      exerciseId: row.id,
      position: index,
      notes: exercise.notes ?? null,
      sets: { create: exercise.sets.map((set, setIndex) => setData(set, setIndex)) },
    });
  }
  const created = await prisma.workoutSession.create({
    data: {
      userId: ctx.userId,
      startedAt: new Date(input.startedAt),
      endedAt: input.endedAt ? new Date(input.endedAt) : null,
      name: input.name ?? null,
      notes: input.notes ?? null,
      timezone: input.timezone ?? "America/New_York",
      sourceSystem: ctx.via === "token" ? "api" : "manual",
      sourceId: input.sourceId ?? null,
      valueOrigin: "user_entered",
      exercises: { create: exercises },
    },
    include: sessionInclude,
  });
  const dto = serializeSession(created);
  await prisma.auditLog.create({
    data: {
      userId: ctx.userId,
      actorTokenId: ctx.tokenId,
      action: "create",
      entityType: "workout_session",
      entityId: created.id,
      after: dto as unknown as Prisma.InputJsonValue,
    },
  });
  return dto;
}

export async function getWorkout(userId: string, id: string) {
  const session = await prisma.workoutSession.findFirst({
    where: { id, userId, deletedAt: null },
    include: sessionInclude,
  });
  return session ? serializeSession(session) : null;
}

export async function patchWorkout(ctx: AuthContext, id: string, input: {
  startedAt?: string;
  endedAt?: string | null;
  name?: string | null;
  notes?: string | null;
  timezone?: string;
}) {
  const existing = await prisma.workoutSession.findFirst({ where: { id, userId: ctx.userId, deletedAt: null } });
  if (!existing) return null;
  const before = { name: existing.name, notes: existing.notes, startedAt: existing.startedAt.toISOString(), timezone: existing.timezone };
  const updated = await prisma.workoutSession.update({
    where: { id },
    data: {
      startedAt: input.startedAt ? new Date(input.startedAt) : undefined,
      endedAt: input.endedAt === undefined ? undefined : input.endedAt ? new Date(input.endedAt) : null,
      name: input.name,
      notes: input.notes,
      timezone: input.timezone,
    },
    include: sessionInclude,
  });
  const dto = serializeSession(updated);
  await prisma.auditLog.create({
    data: {
      userId: ctx.userId,
      actorTokenId: ctx.tokenId,
      action: "update",
      entityType: "workout_session",
      entityId: id,
      before: before as Prisma.InputJsonValue,
      after: { name: dto.name, notes: dto.notes, startedAt: dto.startedAt, timezone: dto.timezone },
    },
  });
  return dto;
}

export async function addSets(ctx: AuthContext, sessionId: string, input: { exerciseSlug: string; exerciseName?: string; sets: SetInput[] }) {
  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, userId: ctx.userId, deletedAt: null },
    include: sessionInclude,
  });
  if (!session) return null;
  const exercise = await ensureExercise(ctx.userId, input.exerciseSlug, input.exerciseName, input.sets[0]?.modality);
  let performance = session.exercises.find((row) => row.exerciseId === exercise.id);
  if (!performance) {
    performance = await prisma.workoutExercise.create({
      data: { sessionId, exerciseId: exercise.id, position: session.exercises.length },
      include: { exercise: true, sets: true },
    });
  }
  const start = performance.sets.length;
  await prisma.workoutSet.createMany({
    data: input.sets.map((set, index) => ({ ...setData(set, start + index), workoutExerciseId: performance.id })),
  });
  await prisma.auditLog.create({
    data: {
      userId: ctx.userId,
      actorTokenId: ctx.tokenId,
      action: "create",
      entityType: "workout_set",
      entityId: sessionId,
      after: { exerciseSlug: input.exerciseSlug, count: input.sets.length } as Prisma.InputJsonValue,
    },
  });
  return getWorkout(ctx.userId, sessionId);
}

export async function correctSet(ctx: AuthContext, sessionId: string, setId: string, input: SetInput) {
  const existing = await prisma.workoutSet.findFirst({
    where: { id: setId, ...activeSet, workoutExercise: { sessionId, session: { userId: ctx.userId, deletedAt: null } } },
  });
  if (!existing) return null;
  await prisma.$transaction(async (tx) => {
    await tx.workoutSet.update({ where: { id: setId }, data: { supersededAt: new Date() } });
    await tx.workoutSet.create({
      data: { ...setData(input, existing.position), workoutExerciseId: existing.workoutExerciseId, supersedesId: setId },
    });
    await tx.auditLog.create({
      data: {
        userId: ctx.userId,
        actorTokenId: ctx.tokenId,
        action: "correct",
        entityType: "workout_set",
        entityId: setId,
        before: toSetInput(existing) as unknown as Prisma.InputJsonValue,
        after: input as unknown as Prisma.InputJsonValue,
      },
    });
  });
  return getWorkout(ctx.userId, sessionId);
}

export async function removeSet(ctx: AuthContext, sessionId: string, setId: string) {
  const existing = await prisma.workoutSet.findFirst({
    where: { id: setId, ...activeSet, workoutExercise: { sessionId, session: { userId: ctx.userId, deletedAt: null } } },
  });
  if (!existing) return null;
  await prisma.workoutSet.update({ where: { id: setId }, data: { deletedAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      userId: ctx.userId,
      actorTokenId: ctx.tokenId,
      action: "delete",
      entityType: "workout_set",
      entityId: setId,
      before: toSetInput(existing) as unknown as Prisma.InputJsonValue,
    },
  });
  return getWorkout(ctx.userId, sessionId);
}
