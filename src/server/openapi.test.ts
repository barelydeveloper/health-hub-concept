import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { workoutCreateSchema } from "./schemas";

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, {
    post?: { parameters?: Array<{ $ref?: string }>; requestBody?: { content?: { "application/json"?: { examples?: { pullups?: { value?: unknown } } } } }; responses?: Record<string, unknown> };
    get?: { responses?: Record<string, unknown> };
  }>;
  security?: unknown[];
  components?: { securitySchemes?: Record<string, { type?: string; scheme?: string }>; responses?: Record<string, { description?: string }> };
}

function collectRoutes(dir: string, prefix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.startsWith("[") && entry.endsWith("]") ? `{${entry.slice(1, -1)}}` : entry;
      found.push(...collectRoutes(full, `${prefix}/${segment}`));
      continue;
    }
    if (entry === "route.ts") found.push(prefix);
  }
  return found;
}

describe("OpenAPI 3.1", () => {
  const spec = parse(readFileSync(path.resolve(process.cwd(), "openapi/openapi.yaml"), "utf8")) as OpenApiDocument;

  it("is OpenAPI 3.1 and lists every public route", () => {
    expect(spec.openapi.startsWith("3.1")).toBe(true);
    expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    const routes = collectRoutes(path.resolve(process.cwd(), "src/app/api"), "/api")
      .filter((route) => !route.startsWith("/api/auth") && route !== "/api/mcp")
      .sort();
    expect(Object.keys(spec.paths).sort()).toEqual(routes);
  });

  it("accepts the documented pull-up write and states auth failures", () => {
    const post = spec.paths["/api/v1/workouts"]?.post;
    const example = post?.requestBody?.content?.["application/json"]?.examples?.pullups?.value;
    expect(workoutCreateSchema.parse(example).exercises[0]?.sets).toHaveLength(3);
    expect(post?.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey")).toBe(true);
    expect(post?.responses?.["401"]).toEqual({ $ref: "#/components/responses/Unauthorized" });
    expect(spec.paths["/api/v1/workouts/{id}"]?.get?.responses?.["401"]).toEqual({ $ref: "#/components/responses/Unauthorized" });
    expect(spec.paths["/api/v1/workouts/{id}"]?.get?.responses?.["404"]).toEqual({ $ref: "#/components/responses/NotFound" });
    expect(spec.paths["/api/v1/exercises/{id}/history"]?.get?.responses?.["401"]).toEqual({ $ref: "#/components/responses/Unauthorized" });
    expect(spec.components?.responses?.Unauthorized.description).toBeTruthy();
    expect(spec.components?.responses?.NotFound.description).toBeTruthy();
  });
});
