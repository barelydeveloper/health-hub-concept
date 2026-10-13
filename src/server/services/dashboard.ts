import { compareExercise, muscleExposure, personalRecords, summarizeSession, trainingFrequency } from "@/domain/strength/calculate";
import { dec, prisma } from "../db";
import { bodyTrends } from "./body";
import { listGoals } from "./goals";
import { loadSessions, toSessionInput } from "./workouts";

export async function dashboard(userId: string) {
  const trends = await bodyTrends(userId);
  const latest = trends.analysis.points.at(-1) ?? null;
  const sessions = await loadSessions(userId);
  const inputs = sessions.map(toSessionInput);
  const recent = sessions[0] ? inputs.find((session) => session.id === sessions[0].id) ?? null : null;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentSessions = inputs.filter((session) => new Date(session.startedAt) >= weekAgo);
  const records = new Map<string, ReturnType<typeof personalRecords>>();
  for (const session of inputs) {
    for (const exercise of session.exercises) {
      records.set(exercise.exerciseId, personalRecords(inputs, exercise.exerciseId));
    }
  }
  const activity = await prisma.activityDay.findMany({
    where: { userId, deletedAt: null, supersededAt: null, recordedOn: { gte: weekAgo } },
    orderBy: { recordedOn: "desc" },
  });
  const sleep = await prisma.sleepSession.findMany({
    where: { userId, deletedAt: null, supersededAt: null, startedAt: { gte: weekAgo } },
    orderBy: { startedAt: "desc" },
  });
  const goals = await listGoals(userId);
  const comparisons = recent
    ? recent.exercises.map((exercise) => compareExercise(inputs, exercise.exerciseId))
    : [];
  return {
    generatedAt: new Date().toISOString(),
    body: latest
      ? {
          recordedAt: latest.recordedAt,
          weightLb: latest.weightLb,
          bodyFatPercent: latest.rawBodyFatPercent,
          normalizedBodyFatPercent: latest.hydrationContext?.bodyFatPercent ?? null,
          fatMassLb: latest.rawFatMassLb,
          fatFreeMassLb: latest.rawFatFreeMassLb,
          skeletalMuscleLb: latest.rawSkeletalMuscleLb,
          normalization: trends.analysis.normalization,
          limitations: trends.analysis.limitations,
        }
      : null,
    recentWorkout: recent ? summarizeSession(recent) : null,
    lastSessionComparisons: comparisons,
    personalRecords: [...records.values()],
    weeklyTraining: {
      ...trainingFrequency(recentSessions.length ? recentSessions : inputs.slice(0, 1), weekAgo.toISOString(), new Date().toISOString()),
      sessionCount: recentSessions.length,
      muscleExposure: muscleExposure(recentSessions),
    },
    activity: {
      steps: activity.reduce((sum, day) => sum + (day.steps ?? 0), 0),
      days: activity.map((day) => ({ date: day.recordedOn.toISOString().slice(0, 10), steps: day.steps, activeCalories: dec(day.activeCalories), workoutMinutes: dec(day.workoutMinutes) })),
    },
    recovery: {
      label: "Sleep and activity summaries are logs, not medical recovery scores.",
      sleep: sleep.map((row) => ({ startedAt: row.startedAt.toISOString(), durationHours: dec(row.durationHours) })),
    },
    goals,
  };
}

export async function recovery(userId: string) {
  const activity = await prisma.activityDay.findMany({ where: { userId, deletedAt: null, supersededAt: null }, orderBy: { recordedOn: "desc" }, take: 90 });
  const sleep = await prisma.sleepSession.findMany({ where: { userId, deletedAt: null, supersededAt: null }, orderBy: { startedAt: "desc" }, take: 90 });
  return {
    estimateLabel: "Heart-rate and recovery figures are imported observations or estimates, not clinical measurements.",
    activity: activity.map((day) => ({
      date: day.recordedOn.toISOString().slice(0, 10),
      steps: day.steps,
      activeCalories: dec(day.activeCalories),
      workoutMinutes: dec(day.workoutMinutes),
      distanceMi: dec(day.distanceMi),
      heartRateAvg: dec(day.heartRateAvg),
      valueOrigin: day.valueOrigin,
    })),
    sleep: sleep.map((row) => ({
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      durationHours: dec(row.durationHours),
      valueOrigin: row.valueOrigin,
    })),
  };
}
