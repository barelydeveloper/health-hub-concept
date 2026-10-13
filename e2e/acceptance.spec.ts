import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const workout = {
  startedAt: "2026-10-13T15:00:00.000Z",
  name: "Acceptance pull-ups",
  exercises: [{
    exerciseSlug: "pull-up",
    exerciseName: "Pull-up",
    sets: [
      { modality: "bodyweight", reps: 3, bodyWeightLb: 151 },
      { modality: "bodyweight", reps: 2, bodyWeightLb: 151 },
      { modality: "bodyweight", reps: 1, bodyWeightLb: 151 },
    ],
  }],
};

test("external client logs three pull-up sets and the UI shows them", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@localhost");
  await page.getByLabel("Password").fill(process.env.AUTH_PASSWORD ?? "change-me-now");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("151.0 lb")).toBeVisible();

  const tokenResponse = await page.request.post("/api/v1/tokens", {
    data: { name: "acceptance-client", scopes: ["read", "write", "import"] },
    headers: { "idempotency-key": "acceptance-token" },
  });
  expect(tokenResponse.status()).toBe(201);
  const token = (await tokenResponse.json()).data.token as string;
  const auth = { authorization: `Bearer ${token}` };

  const first = await request.post("/api/v1/workouts", {
    data: workout,
    headers: { ...auth, "idempotency-key": "acceptance-pullups" },
  });
  expect(first.status()).toBe(201);
  const created = await first.json();
  expect(created.data.exercises[0].sets).toHaveLength(3);

  const replay = await request.post("/api/v1/workouts", {
    data: workout,
    headers: { ...auth, "idempotency-key": "acceptance-pullups" },
  });
  expect(replay.status()).toBe(201);
  expect(replay.headers()["idempotent-replayed"]).toBe("true");
  expect((await replay.json()).data.id).toBe(created.data.id);

  const listed = await request.get("/api/v1/workouts", { headers: auth });
  expect(listed.status()).toBe(200);
  const sessions = (await listed.json()).data.filter((session: { name: string }) => session.name === "Acceptance pull-ups");
  expect(sessions).toHaveLength(1);

  const history = await request.get("/api/v1/exercises/pull-up/history", { headers: auth });
  expect(history.status()).toBe(200);
  const historyBody = await history.json();
  const logged = historyBody.data.sessions.find((session: { startedAt: string }) => session.startedAt.startsWith("2026-10-13"));
  expect(logged.exercises[0].sets).toHaveLength(3);
  expect(historyBody.data.comparison.latest.totalReps).toBe(6);
  expect(historyBody.data.comparison.latest.bestReps).toBe(3);
  expect(historyBody.data.records.bestReps).toBe(3);
  expect(historyBody.data.records.bestE1rmLb).toEqual(expect.any(Number));

  await page.goto("/workouts");
  await expect(page.getByRole("heading", { name: "Workouts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "2026-10-13" })).toBeVisible();
  await expect(page.getByText("6 reps, best 3")).toBeVisible();
  await expect(page.getByText(/Latest total reps 6/)).toBeVisible();
  await expect(page.getByText(/reps 3, hold/)).toBeVisible();
});

test("imported body-water sample shows raw and normalized estimates", async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@localhost");
  await page.getByLabel("Password").fill(process.env.AUTH_PASSWORD ?? "change-me-now");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  const tokenResponse = await page.request.post("/api/v1/tokens", {
    data: { name: "acceptance-import", scopes: ["read", "write", "import"] },
    headers: { "idempotency-key": "acceptance-import-token" },
  });
  expect(tokenResponse.status()).toBe(201);
  const token = (await tokenResponse.json()).data.token as string;
  const auth = { authorization: `Bearer ${token}` };
  const csv = readFileSync(path.join(process.cwd(), "fixtures/samsung/weight_hydration.csv"), "utf8");
  const imported = await request.post("/api/v1/imports", {
    data: { files: [{ name: "com.samsung.health.weight.csv", text: csv }] },
    headers: { ...auth, "idempotency-key": `acceptance-hydration-${Date.now()}` },
  });
  expect(imported.status()).toBe(201);

  const trends = await request.get("/api/v1/body-composition/trends", { headers: auth });
  expect(trends.status()).toBe(200);
  const analysis = (await trends.json()).data.analysis;
  expect(analysis.normalization.status).toBe("ok");
  const paired = analysis.points.filter((point: { rawBodyFatPercent: number | null; hydrationContext: { bodyFatPercent: number | null } | null }) =>
    point.rawBodyFatPercent != null && point.hydrationContext?.bodyFatPercent != null);
  expect(paired.length).toBeGreaterThan(0);

  await page.goto("/body");
  await expect(page.getByRole("heading", { name: "Body composition" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Body fat, raw and normalized" })).toBeVisible();
  await expect(page.getByText("Raw %")).toBeVisible();
  await expect(page.getByText("Normalized %")).toBeVisible();
  await expect(page.getByText(/normalized \d+(\.\d+)?%/)).toBeVisible();
  await expect(page.getByText(/Fat-free mass change is not muscle gain/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fat mass and fat-free mass" })).toBeVisible();
});
