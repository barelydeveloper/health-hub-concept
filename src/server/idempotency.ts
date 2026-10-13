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

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function beginIdempotency(options: {
  userId: string;
  key: string | null;
  method: string;
  path: string;
  body: unknown;
}): Promise<{ replay?: Response; key: string } | Response> {
  if (!options.key) {
    return apiError(400, "idempotency_key_required", "Idempotency-Key header is required for this write.");
  }
  const hash = requestHash(options.method, options.path, options.body);
  try {
    await prisma.idempotencyKey.create({
      data: {
        userId: options.userId,
        key: options.key,
        method: options.method,
        path: options.path,
        requestHash: hash,
      },
    });
    return { key: options.key };
  } catch (error) {
    if (!isUniqueError(error)) throw error;
    return waitForReplay(options.userId, options.key, hash);
  }
}

async function waitForReplay(userId: string, key: string, hash: string): Promise<{ replay: Response; key: string } | Response> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const existing = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (!existing) return apiError(409, "idempotency_conflict", "Idempotency key is in use.");
    if (existing.requestHash !== hash) {
      return apiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request body.");
    }
    if (existing.statusCode && existing.responseBody) {
      return {
        key,
        replay: Response.json(existing.responseBody, {
          status: existing.statusCode,
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
