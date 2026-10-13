import { ZodError, type ZodType } from "zod";
import type { AuthContext, Scope } from "./auth";
import { authenticate } from "./auth";
import { beginIdempotency, finishIdempotency, releaseIdempotency } from "./idempotency";
import { apiError } from "./http";
import { consumeRate } from "./rate-limit";

export async function withAuth(req: Request, scope: Scope, fn: (ctx: AuthContext) => Promise<Response>): Promise<Response> {
  const ctx = await authenticate(req);
  if (!ctx) return apiError(401, "unauthorized", "Authentication is required.");
  if (!ctx.scopes.includes(scope)) return apiError(403, "forbidden", `The token is missing the ${scope} scope.`);
  const bucket = ctx.tokenId ?? `session:${ctx.userId}`;
  if (!consumeRate(bucket)) return apiError(429, "rate_limited", "Too many requests.");
  return fn(ctx);
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): { ok: true; data: T } | { ok: false; response: Response } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, response: validationError(parsed.error) };
  return { ok: true, data: parsed.data };
}

export function validationError(error: ZodError): Response {
  return apiError(400, "validation_error", "The request body is invalid.", error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })));
}

export async function withWrite(
  req: Request,
  path: string,
  scope: Scope,
  fn: (ctx: AuthContext, body: unknown) => Promise<Response>,
): Promise<Response> {
  return withAuth(req, scope, async (ctx) => {
    const contentType = req.headers.get("content-type") ?? "";
    let body: unknown = {};
    if (contentType.includes("application/json")) {
      try {
        body = await req.json();
      } catch {
        return apiError(400, "invalid_json", "Request body must be JSON.");
      }
    }
    const claim = await beginIdempotency({
      userId: ctx.userId,
      key: req.headers.get("idempotency-key"),
      method: req.method,
      path,
      body,
    });
    if (claim instanceof Response) return claim;
    if ("replay" in claim && claim.replay) return claim.replay;
    try {
      const response = await fn(ctx, body);
      if (response.status >= 500) {
        await releaseIdempotency(ctx.userId, claim.key);
        return response;
      }
      return finishIdempotency(ctx.userId, claim.key, response);
    } catch (error) {
      console.error(error);
      await releaseIdempotency(ctx.userId, claim.key);
      return apiError(500, "internal_error", "The request failed.");
    }
  });
}
