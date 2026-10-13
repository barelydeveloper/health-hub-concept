import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth";
import { deleteSet, exerciseHistory, getWorkoutById, listWorkouts, patchMeasurement, patchWorkoutById, postImport, postMeasurement, postSets, postWorkout } from "@/server/api/v1";
import { prisma } from "@/server/db";
import { setRateLimitForTests } from "@/server/rate-limit";

const password = "integration-secret";

function request(method: string, path: string, options: { token?: string; body?: unknown; key?: string } = {}) {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.key) headers.set("idempotency-key", options.key);
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function userWithToken(email: string, scopes: string[]) {
  const user = await prisma.user.create({ data: { email, passwordHash: hashPassword(password) } });
  const raw = `fihub_${createHash("sha256").update(email).digest("hex")}`;
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  await prisma.apiToken.create({ data: { userId: user.id, name: "test", tokenHash, scopes } });
  return { user, raw };
}

describe("API v1", () => {
  let owner: { user: { id: string }; raw: string };
  let other: { user: { id: string }; raw: string };

  beforeAll(async () => {
    setRateLimitForTests(10_000);
    await prisma.user.deleteMany({ where: { email: { in: ["api-owner@test.local", "api-other@test.local", "api-read@test.local"] } } });
    owner = await userWithToken("api-owner@test.local", ["read", "write", "import"]);
    other = await userWithToken("api-other@test.local", ["read", "write", "import"]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: ["api-owner@test.local", "api-other@test.local", "api-read@test.local"] } } });
    await prisma.$disconnect();
  });

  it("rejects missing auth, a read-only token, and a malformed workout", async () => {
    const missing = await listWorkouts(request("GET", "/api/v1/workouts"));
    expect(missing.status).toBe(401);

    const readOnly = await userWithToken("api-read@test.local", ["read"]);
    const forbidden = await postWorkout(request("POST", "/api/v1/workouts", {
      token: readOnly.raw,
      key: "nope",
      body: { startedAt: "2026-10-10T15:00:00.000Z", exercises: [{ exerciseSlug: "pull-up", sets: [{ modality: "bodyweight", reps: 1, bodyWeightLb: 150 }] }] },
    }));
    expect(forbidden.status).toBe(403);

    const malformed = await postWorkout(request("POST", "/api/v1/workouts", {
      token: owner.raw,
      key: "bad-body",
      body: { exercises: "no" },
    }));
    expect(malformed.status).toBe(400);
    const error = await malformed.json();
    expect(error.error.code).toBe("validation_error");
  });

  it("replays an identical write, rejects a conflicting replay, and isolates users", async () => {
    const body = {
      startedAt: "2026-10-10T15:00:00.000Z",
      name: "Test session",
      exercises: [{ exerciseSlug: "pull-up", sets: [{ modality: "bodyweight", reps: 2, bodyWeightLb: 151 }, { modality: "bodyweight", reps: 1, bodyWeightLb: 151 }] }],
    };
    const first = await postWorkout(request("POST", "/api/v1/workouts", { token: owner.raw, key: "workout-1", body }));
    const replay = await postWorkout(request("POST", "/api/v1/workouts", { token: owner.raw, key: "workout-1", body }));
    const conflict = await postWorkout(request("POST", "/api/v1/workouts", {
      token: owner.raw,
      key: "workout-1",
      body: { ...body, name: "Different" },
    }));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
    expect(conflict.status).toBe(409);
    const created = await first.json();
    const hidden = await getWorkoutById(request("GET", `/api/v1/workouts/${created.data.id}`, { token: other.raw }), created.data.id);
    expect(hidden.status).toBe(404);
    const count = await prisma.workoutSession.count({ where: { userId: owner.user.id, name: "Test session" } });
    expect(count).toBe(1);

    const patched = await patchWorkoutById(request("PATCH", `/api/v1/workouts/${created.data.id}`, {
      token: other.raw,
      key: "other-patch",
      body: { name: "Stolen session" },
    }), created.data.id);
    expect(patched.status).toBe(404);
    const appended = await postSets(request("POST", `/api/v1/workouts/${created.data.id}/sets`, {
      token: other.raw,
      key: "other-sets",
      body: { exerciseSlug: "pull-up", sets: [{ modality: "bodyweight", reps: 1, bodyWeightLb: 151 }] },
    }), created.data.id);
    expect(appended.status).toBe(404);
    const unchanged = await prisma.workoutSession.findUnique({ where: { id: created.data.id } });
    expect(unchanged?.name).toBe("Test session");
    const setCount = await prisma.workoutSet.count({ where: { workoutExercise: { sessionId: created.data.id }, deletedAt: null } });
    expect(setCount).toBe(2);
  });

  it("keeps one workout when two identical writes race", async () => {
    const body = {
      startedAt: "2026-10-11T15:00:00.000Z",
      name: "Race session",
      exercises: [{ exerciseSlug: "dead-hang", sets: [{ modality: "isometric", durationSec: 30 }] }],
    };
    const [left, right] = await Promise.all([
      postWorkout(request("POST", "/api/v1/workouts", { token: owner.raw, key: "race-1", body })),
      postWorkout(request("POST", "/api/v1/workouts", { token: owner.raw, key: "race-1", body })),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 201]);
    const count = await prisma.workoutSession.count({ where: { userId: owner.user.id, name: "Race session" } });
    expect(count).toBe(1);
  });

  it("corrects a measurement without discarding the prior row and appends a set", async () => {
    const created = await postMeasurement(request("POST", "/api/v1/measurements", {
      token: owner.raw,
      key: "measure-1",
      body: { recordedAt: "2026-10-12T11:00:00.000Z", weightLb: 151.2 },
    }));
    expect(created.status).toBe(201);
    const payload = await created.json();
    const weight = payload.data.records.find((row: { kind: string }) => row.kind === "weight");
    const corrected = await patchMeasurement(request("PATCH", `/api/v1/measurements/${weight.id}`, {
      token: owner.raw,
      key: "measure-1-fix",
      body: { value: 151.4 },
    }), weight.id);
    expect(corrected.status).toBe(200);
    const prior = await prisma.bodyMetric.findUnique({ where: { id: weight.id } });
    expect(prior?.supersededAt).not.toBeNull();
    const active = await prisma.bodyMetric.count({ where: { userId: owner.user.id, kind: "weight", supersededAt: null, deletedAt: null, sourceSystem: "api" } });
    expect(active).toBe(1);

    const workout = await postWorkout(request("POST", "/api/v1/workouts", {
      token: owner.raw,
      key: "sets-base",
      body: { startedAt: "2026-10-12T16:00:00.000Z", exercises: [{ exerciseSlug: "pull-up", sets: [{ modality: "bodyweight", reps: 2, bodyWeightLb: 151 }] }] },
    }));
    const session = await workout.json();
    const appended = await postSets(request("POST", `/api/v1/workouts/${session.data.id}/sets`, {
      token: owner.raw,
      key: "sets-add",
      body: { exerciseSlug: "pull-up", sets: [{ modality: "bodyweight", reps: 2, bodyWeightLb: 151 }, { modality: "bodyweight", reps: 1, bodyWeightLb: 151 }] },
    }), session.data.id);
    expect(appended.status).toBe(201);
    const history = await exerciseHistory(request("GET", "/api/v1/exercises/pull-up/history", { token: owner.raw }), "pull-up");
    const historyBody = await history.json();
    expect(historyBody.data.comparison.latest.totalReps).toBeGreaterThan(0);
    const setId = session.data.exercises[0].sets[0].id;
    const removed = await deleteSet(request("DELETE", `/api/v1/workouts/${session.data.id}/sets/${setId}`, {
      token: owner.raw,
      key: "sets-del",
    }), session.data.id, setId);
    expect(removed.status).toBe(200);
    const gone = await prisma.workoutSet.findUnique({ where: { id: setId } });
    expect(gone?.deletedAt).not.toBeNull();
  });

  it("imports a Samsung CSV twice without duplicating the weight", async () => {
    const csv = [
      "metadata",
      "start_time,weight,body_fat,body_fat_mass,skeletal_muscle_mass,total_body_water,datauuid",
      "2026-07-01 07:00:00.000,70,20,14,30,40,uuid-int-1",
    ].join("\n");
    const body = { files: [{ name: "com.samsung.health.weight.csv", text: csv }] };
    const first = await postImport(request("POST", "/api/v1/imports", { token: owner.raw, key: "import-1", body }));
    const second = await postImport(request("POST", "/api/v1/imports", { token: owner.raw, key: "import-2", body }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.data.summary.added).toBeGreaterThan(0);
    expect(secondBody.data.summary.added).toBe(0);
    const weights = await prisma.bodyMetric.count({
      where: { userId: owner.user.id, kind: "weight", sourceSystem: "samsung_health", supersededAt: null, deletedAt: null },
    });
    expect(weights).toBe(1);
  });

  it("rate limits an authenticated caller", async () => {
    setRateLimitForTests(2);
    const first = await listWorkouts(request("GET", "/api/v1/workouts", { token: owner.raw }));
    const second = await listWorkouts(request("GET", "/api/v1/workouts", { token: owner.raw }));
    const third = await listWorkouts(request("GET", "/api/v1/workouts", { token: owner.raw }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    setRateLimitForTests(10_000);
  });
});
