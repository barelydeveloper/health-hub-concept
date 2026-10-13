import { ZodError, type ZodType } from "zod";
import type { AuthContext, Scope } from "./auth";
import { authenticate, touchApiToken } from "./auth";
import { beginIdempotency, finishIdempotency, releaseIdempotency } from "./idempotency";
import { apiError } from "./http";
import { consumeRate } from "./rate-limit";

export function authDecision(hasUser: boolean, underRateLimit: boolean, hasScope: boolean): 200 | 401 | 403 | 429 {
  if (!hasUser) return 401;
  if (!underRateLimit) return 429;
  if (!hasScope) return 403;
  return 200;
}

export async function withAuth(req: Request, scope: Scope, fn: (ctx: AuthContext) => Promise<Response>): Promise<Response> {
  try {
    const ctx = await authenticate(req, { touch: false });
    const underRateLimit = ctx ? consumeRate(ctx.tokenId ?? `session:${ctx.userId}`) : false;
    const decision = authDecision(ctx != null, underRateLimit, ctx?.scopes.includes(scope) ?? false);
    if (!ctx || decision === 401) return apiError(401, "unauthorized", "Authentication is required.");
    if (decision === 429) return apiError(429, "rate_limited", "Too many requests.");
    if (decision === 403) return apiError(403, "forbidden", `The token is missing the ${scope} scope.`);
    if (ctx.tokenId) await touchApiToken(ctx.tokenId);
    return await fn(ctx);
  } catch (error) {
    console.error(error);
    return apiError(500, "internal_error", "The request failed.");
  }
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
      try {
        return await finishIdempotency(ctx.userId, claim.key, response);
      } catch (error) {
        console.error(error);
        return response;
      }
    } catch (error) {
      console.error(error);
      await releaseIdempotency(ctx.userId, claim.key);
      return apiError(500, "internal_error", "The request failed.");
    }
  });
}
