import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { apiError } from "./http";

export function requestHash(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(JSON.stringify({ method, path, body })).digest("hex");
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function normalizeIdempotencyKey(key: string | null): { ok: true; key: string } | { ok: false; reason: "missing" | "invalid" } {
  if (key == null || key.trim() === "") return { ok: false, reason: "missing" };
  const trimmed = key.trim();
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, key: trimmed };
}

export type IdempotencyVerdict =
  | { type: "replay"; statusCode: number; responseBody: unknown }
  | { type: "conflict"; message: string }
  | { type: "pending" };

export function assessIdempotencyRecord(
  existing: { requestHash: string; statusCode: number | null; responseBody: unknown } | null,
  hash: string,
): IdempotencyVerdict {
  if (!existing) return { type: "conflict", message: "Idempotency key is in use." };
  if (existing.requestHash !== hash) {
    return { type: "conflict", message: "This Idempotency-Key was already used with a different request body." };
  }
  if (existing.statusCode != null) {
    return { type: "replay", statusCode: existing.statusCode, responseBody: existing.responseBody ?? null };
  }
  return { type: "pending" };
}

export async function beginIdempotency(options: {
  userId: string;
  key: string | null;
  method: string;
  path: string;
  body: unknown;
}): Promise<{ replay?: Response; key: string } | Response> {
  const normalized = normalizeIdempotencyKey(options.key);
  if (!normalized.ok) {
    if (normalized.reason === "missing") {
      return apiError(400, "idempotency_key_required", "Idempotency-Key header is required for this write.");
    }
    return apiError(400, "idempotency_key_invalid", "Idempotency-Key must be 255 characters or fewer and must not contain control characters.");
  }
  const hash = requestHash(options.method, options.path, options.body);
  try {
    await prisma.idempotencyKey.create({
      data: {
        userId: options.userId,
        key: normalized.key,
        method: options.method,
        path: options.path,
        requestHash: hash,
      },
    });
    return { key: normalized.key };
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    return waitForReplay(options.userId, normalized.key, hash);
  }
}

async function waitForReplay(userId: string, key: string, hash: string): Promise<{ replay: Response; key: string } | Response> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    const verdict = assessIdempotencyRecord(existing, hash);
    if (verdict.type === "conflict") return apiError(409, "idempotency_conflict", verdict.message);
    if (verdict.type === "replay") {
      return {
        key,
        replay: Response.json(verdict.responseBody, {
          status: verdict.statusCode,
          headers: { "Idempotent-Replayed": "true" },
        }),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return apiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still in progress.");
}

export async function finishIdempotency(userId: string, key: string, response: Response): Promise<Response> {
  const responseBody = await response.clone().json().catch(() => ({ nonJson: true }));
  await prisma.idempotencyKey.update({
    where: { userId_key: { userId, key } },
    data: { statusCode: response.status, responseBody },
  });
  return response;
}

export async function releaseIdempotency(userId: string, key: string): Promise<void> {
  await prisma.idempotencyKey.deleteMany({ where: { userId, key, statusCode: null } });
}
