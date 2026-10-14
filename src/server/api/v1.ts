import { createHash } from "node:crypto";
import { parseSamsungFiles, parseSamsungZip } from "@/domain/import";
import { zipNeedsDirectUpload } from "@/lib/import-limits";
import { compareExercise, muscleExposure, overloadSuggestion, personalRecords, trainingFrequency } from "@/domain/strength/calculate";
import type { SetInput } from "@/domain/strength/types";
import { clearSessionCookie, generateApiToken, sessionCookie, signSession, verifyPassword } from "../auth";
import { prisma } from "../db";
import { parseBody, withAuth, withWrite } from "../guard";
import { apiError, encodeCursor, json, pageParams } from "../http";
import { consumeRate } from "../rate-limit";
import { bodyTrends, correctMeasurement, createMeasurement, deleteMeasurement, listCircumferences, listMeasurements } from "../services/body";
import { dashboard, recovery } from "../services/dashboard";
import { createGoal, forecastReport, listGoals, saveForecast } from "../services/goals";
import { listImports, persistSamsungImport } from "../services/imports";
import { getAsset } from "../storage";
import { createNutrition, listNutrition } from "../services/nutrition";
import { addSets, correctSet, createWorkout, getWorkout, loadSessions, patchWorkout, removeSet, serializeSession, toSessionInput } from "../services/workouts";
import {
  addSetsSchema,
  forecastSchema,
  goalSchema,
  importJsonSchema,
  loginSchema,
  measurementPatchSchema,
  measurementSchema,
  nutritionSchema,
  profilePatchSchema,
  setSchema,
  tokenSchema,
  workoutCreateSchema,
  workoutPatchSchema,
} from "../schemas";

function pathOf(req: Request): string {
  return new URL(req.url).pathname;
}

export async function health(): Promise<Response> {
  return json({ ok: true, service: "fitness-intelligence" });
}

export async function ready(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, database: "up" });
  } catch {
    return apiError(503, "not_ready", "Database is not ready.");
  }
}

export async function login(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "invalid_json", "Request body must be JSON.");
  }
  const parsed = parseBody(loginSchema, body);
  if (!parsed.ok) return parsed.response;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!consumeRate(`login:${ip}`)) return apiError(429, "rate_limited", "Too many requests.");
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return apiError(401, "unauthorized", "Email or password is incorrect.");
  }
  await prisma.auditLog.create({ data: { userId: user.id, action: "login", entityType: "user", entityId: user.id } });
  return json({ data: { email: user.email } }, 200, { "set-cookie": sessionCookie(signSession(user.id)) });
}

export async function logout(req: Request): Promise<Response> {
  return withAuth(req, "read", async () => json({ data: { ok: true } }, 200, { "set-cookie": clearSessionCookie() }));
}

export async function me(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const user = await prisma.user.findUnique({ where: { id: ctx.userId }, include: { profile: true } });
    if (!user) return apiError(401, "unauthorized", "Authentication is required.");
    return json({
      data: {
        email: user.email,
        profile: user.profile
          ? {
              displayName: user.profile.displayName,
              heightInches: user.profile.heightInches == null ? null : Number(user.profile.heightInches),
              sex: user.profile.sex,
              birthDate: user.profile.birthDate?.toISOString().slice(0, 10) ?? null,
              maxHeartRate: user.profile.maxHeartRate,
              timezone: user.profile.timezone,
              notes: user.profile.notes,
            }
          : null,
      },
    });
  });
}

export async function patchProfile(req: Request): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(profilePatchSchema, body);
    if (!parsed.ok) return parsed.response;
    const profile = await prisma.profile.upsert({
      where: { userId: ctx.userId },
      create: {
        userId: ctx.userId,
        displayName: parsed.data.displayName ?? null,
        heightInches: parsed.data.heightInches ?? null,
        sex: parsed.data.sex,
        birthDate: parsed.data.birthDate ? new Date(`${parsed.data.birthDate}T00:00:00.000Z`) : null,
        maxHeartRate: parsed.data.maxHeartRate ?? null,
        timezone: parsed.data.timezone,
        notes: parsed.data.notes ?? null,
      },
      update: {
        displayName: parsed.data.displayName,
        heightInches: parsed.data.heightInches,
        sex: parsed.data.sex,
        birthDate: parsed.data.birthDate === undefined ? undefined : parsed.data.birthDate ? new Date(`${parsed.data.birthDate}T00:00:00.000Z`) : null,
        maxHeartRate: parsed.data.maxHeartRate,
        timezone: parsed.data.timezone,
        notes: parsed.data.notes,
      },
    });
    await prisma.auditLog.create({ data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "update", entityType: "profile", entityId: ctx.userId, after: { timezone: profile.timezone } } });
    return json({ data: { updated: true } });
  });
}

export async function getDashboard(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => json({ data: await dashboard(ctx.userId) }));
}

export async function getRecovery(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => json({ data: await recovery(ctx.userId) }));
}

export async function listWorkouts(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const page = pageParams(new URL(req.url));
    const rows = await loadSessions(ctx.userId, {
      startedAt: { gte: page.from ?? undefined, lte: page.to ?? undefined },
      ...(page.cursor
        ? { OR: [{ startedAt: { lt: new Date(page.cursor.at) } }, { startedAt: new Date(page.cursor.at), id: { lt: page.cursor.id } }] }
        : {}),
    }, page.limit + 1);
    const hasMore = rows.length > page.limit;
    const pageRows = rows.slice(0, page.limit);
    const data = pageRows.map(serializeSession);
    const last = pageRows.at(-1);
    return json({ data, page: { hasMore, nextCursor: hasMore && last ? encodeCursor(last.startedAt.toISOString(), last.id) : null } });
  });
}

export async function postWorkout(req: Request): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(workoutCreateSchema, body);
    if (!parsed.ok) return parsed.response;
    const created = await createWorkout(ctx, parsed.data);
    return json({ data: created }, 201);
  });
}

export async function getWorkoutById(req: Request, id: string): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const row = await getWorkout(ctx.userId, id);
    if (!row) return apiError(404, "not_found", "Workout not found.");
    return json({ data: row });
  });
}

export async function patchWorkoutById(req: Request, id: string): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(workoutPatchSchema, body);
    if (!parsed.ok) return parsed.response;
    const row = await patchWorkout(ctx, id, parsed.data);
    if (!row) return apiError(404, "not_found", "Workout not found.");
    return json({ data: row });
  });
}

export async function postSets(req: Request, id: string): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(addSetsSchema, body);
    if (!parsed.ok) return parsed.response;
    const row = await addSets(ctx, id, parsed.data);
    if (!row) return apiError(404, "not_found", "Workout not found.");
    return json({ data: row }, 201);
  });
}

export async function patchSet(req: Request, sessionId: string, setId: string): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(setSchema, body);
    if (!parsed.ok) return parsed.response;
    const row = await correctSet(ctx, sessionId, setId, parsed.data as SetInput);
    if (!row) return apiError(404, "not_found", "Set not found.");
    return json({ data: row });
  });
}

export async function deleteSet(req: Request, sessionId: string, setId: string): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx) => {
    const row = await removeSet(ctx, sessionId, setId);
    if (!row) return apiError(404, "not_found", "Set not found.");
    return json({ data: row });
  });
}

export async function exerciseHistory(req: Request, id: string): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const sessions = (await loadSessions(ctx.userId)).map(toSessionInput).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const relevant = sessions.filter((session) => session.exercises.some((exercise) => exercise.exerciseId === id));
    return json({
      data: {
        exerciseId: id,
        sessions: relevant,
        comparison: compareExercise(sessions, id),
        records: personalRecords(sessions, id),
        overload: overloadSuggestion(sessions, id),
        muscleExposure: muscleExposure(relevant),
      },
    });
  });
}

export async function getRecords(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const sessions = (await loadSessions(ctx.userId)).map(toSessionInput);
    const slugs = [...new Set(sessions.flatMap((session) => session.exercises.map((exercise) => exercise.exerciseId)))];
    const data = slugs.map((slug) => personalRecords(sessions, slug));
    const weekAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
    return json({
      data,
      training: trainingFrequency(sessions, weekAgo, new Date().toISOString()),
      muscleExposure: muscleExposure(sessions),
    });
  });
}

export async function listMeasurementRoute(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const page = pageParams(new URL(req.url));
    const rows = await listMeasurements(ctx.userId, page);
    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit);
    const last = data.at(-1);
    const tape = await listCircumferences(ctx.userId);
    return json({ data, tape, page: { hasMore, nextCursor: hasMore && last ? encodeCursor(last.recordedAt, last.id) : null } });
  });
}

export async function postMeasurement(req: Request): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(measurementSchema, body);
    if (!parsed.ok) return parsed.response;
    return json({ data: await createMeasurement(ctx, parsed.data) }, 201);
  });
}

export async function patchMeasurement(req: Request, id: string): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(measurementPatchSchema, body);
    if (!parsed.ok) return parsed.response;
    const row = await correctMeasurement(ctx, id, parsed.data.value, parsed.data.note);
    if (!row) return apiError(404, "not_found", "Measurement not found.");
    return json({ data: row });
  });
}

export async function deleteMeasurementRoute(req: Request, id: string): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx) => {
    const row = await deleteMeasurement(ctx, id);
    if (!row) return apiError(404, "not_found", "Measurement not found.");
    return json({ data: row });
  });
}

export async function bodyCompositionTrends(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const page = pageParams(new URL(req.url));
    return json({ data: await bodyTrends(ctx.userId, page.from, page.to) });
  });
}

export async function postNutrition(req: Request): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(nutritionSchema, body);
    if (!parsed.ok) return parsed.response;
    return json({ data: await createNutrition(ctx, parsed.data) }, 201);
  });
}

export async function getNutrition(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const page = pageParams(new URL(req.url));
    return json({ data: await listNutrition(ctx.userId, page.from, page.to) });
  });
}

export async function getGoals(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => json({ data: await listGoals(ctx.userId) }));
}

export async function postGoal(req: Request): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(goalSchema, body);
    if (!parsed.ok) return parsed.response;
    return json({ data: await createGoal(ctx, parsed.data) }, 201);
  });
}

export async function getForecasts(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    const intake = Number(url.searchParams.get("intakeKcal"));
    const tdee = Number(url.searchParams.get("tdeeKcal"));
    const horizon = Number(url.searchParams.get("horizonDays") ?? 28);
    const saved = await prisma.forecastScenario.findMany({ where: { userId: ctx.userId }, orderBy: { calculatedAt: "desc" }, take: 20 });
    const live = mode === "conservative" || mode === "expected" || mode === "aggressive"
      ? await forecastReport(ctx.userId, { mode, intakeKcal: intake, tdeeKcal: tdee, horizonDays: horizon })
      : await forecastReport(ctx.userId);
    return json({
      data: {
        live,
        saved: saved.map((row) => ({ id: row.id, name: row.name, calculatedAt: row.calculatedAt.toISOString(), assumptions: row.assumptions, result: row.result })),
      },
    });
  });
}

export async function postForecast(req: Request): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(forecastSchema, body);
    if (!parsed.ok) return parsed.response;
    return json({ data: await saveForecast(ctx, parsed.data) }, 201);
  });
}

export async function getImports(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const objectKey = new URL(req.url).searchParams.get("object");
    if (objectKey) {
      const owned = await prisma.importFile.findFirst({
        where: { objectKey, batch: { userId: ctx.userId } },
        select: { name: true },
      });
      if (!owned) return apiError(404, "not_found", "Stored import file was not found.");
      const bytes = await getAsset(objectKey);
      const filename = owned.name.replace(/["\r\n]/g, "");
      return new Response(Buffer.from(bytes), {
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }
    return json({ data: await listImports(ctx.userId) });
  });
}

export async function postImport(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
    return withAuth(req, "import", async (ctx) => {
      const declared = Number(req.headers.get("content-length"));
      if (zipNeedsDirectUpload(declared)) {
        return apiError(413, "payload_too_large", "ZIP files over 4 MB must use POST /api/v1/imports/uploads.");
      }
      const bytes = Buffer.from(await req.arrayBuffer());
      if (zipNeedsDirectUpload(bytes.byteLength)) {
        return apiError(413, "payload_too_large", "ZIP files over 4 MB must use POST /api/v1/imports/uploads.");
      }
      const { beginIdempotency, finishIdempotency, releaseIdempotency } = await import("../idempotency");
      const claim = await beginIdempotency({
        userId: ctx.userId,
        key: req.headers.get("idempotency-key"),
        method: "POST",
        path: pathOf(req),
        body: { sha256: createHash("sha256").update(bytes).digest("hex") },
      });
      if (claim instanceof Response) return claim;
      if ("replay" in claim && claim.replay) return claim.replay;
      try {
        const draft = await parseSamsungZip(bytes);
        const result = await persistSamsungImport(ctx, draft, undefined, { archive: bytes });
        return finishIdempotency(ctx.userId, claim.key, json({ data: result }, 201));
      } catch (error) {
        console.error(error);
        await releaseIdempotency(ctx.userId, claim.key);
        return apiError(400, "import_failed", "The archive could not be imported.");
      }
    });
  }
  return withWrite(req, pathOf(req), "import", async (ctx, body) => {
    const parsed = parseBody(importJsonSchema, body);
    if (!parsed.ok) return parsed.response;
    const files = parsed.data.files.map((file) => ({
      name: file.name,
      text: file.text,
      bytes: file.base64 ? Buffer.from(file.base64, "base64") : undefined,
    }));
    const draft = await parseSamsungFiles(files);
    const stored = files.map((file) => ({
      name: file.name,
      body: file.bytes ?? Buffer.from(file.text ?? "", "utf8"),
      contentType: file.name.toLowerCase().endsWith(".json") ? "application/json" : "text/csv",
    }));
    return json({ data: await persistSamsungImport(ctx, draft, parsed.data.label, { files: stored }) }, 201);
  });
}

export async function listTokens(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const tokens = await prisma.apiToken.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" } });
    return json({
      data: tokens.map((token) => ({
        id: token.id,
        name: token.name,
        scopes: token.scopes,
        createdAt: token.createdAt.toISOString(),
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        expiresAt: token.expiresAt?.toISOString() ?? null,
        revokedAt: token.revokedAt?.toISOString() ?? null,
      })),
    });
  });
}

export async function postToken(req: Request): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx, body) => {
    const parsed = parseBody(tokenSchema, body);
    if (!parsed.ok) return parsed.response;
    const generated = generateApiToken();
    const token = await prisma.apiToken.create({
      data: {
        userId: ctx.userId,
        name: parsed.data.name,
        tokenHash: generated.hash,
        scopes: parsed.data.scopes,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
    });
    await prisma.auditLog.create({ data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "token_create", entityType: "api_token", entityId: token.id, after: { name: token.name, scopes: token.scopes } } });
    return json({ data: { id: token.id, token: generated.raw, name: token.name, scopes: token.scopes } }, 201);
  });
}

export async function deleteToken(req: Request, id: string): Promise<Response> {
  return withWrite(req, pathOf(req), "write", async (ctx) => {
    const token = await prisma.apiToken.findFirst({ where: { id, userId: ctx.userId } });
    if (!token) return apiError(404, "not_found", "Token not found.");
    await prisma.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await prisma.auditLog.create({ data: { userId: ctx.userId, actorTokenId: ctx.tokenId, action: "token_revoke", entityType: "api_token", entityId: id } });
    return json({ data: { id, revoked: true } });
  });
}

export async function listAudit(req: Request): Promise<Response> {
  return withAuth(req, "read", async (ctx) => {
    const page = pageParams(new URL(req.url));
    const rows = await prisma.auditLog.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
      take: page.limit,
    });
    return json({
      data: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        createdAt: row.createdAt.toISOString(),
        actorTokenId: row.actorTokenId,
      })),
    });
  });
}
