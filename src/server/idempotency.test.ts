import { describe, expect, it } from "vitest";
import { assessIdempotencyRecord, normalizeIdempotencyKey, requestHash } from "./idempotency";

describe("idempotency decisions", () => {
  it("requires a short key without control characters", () => {
    expect(normalizeIdempotencyKey(null)).toEqual({ ok: false, reason: "missing" });
    expect(normalizeIdempotencyKey("  ")).toEqual({ ok: false, reason: "missing" });
    expect(normalizeIdempotencyKey("  workout-1  ")).toEqual({ ok: true, key: "workout-1" });
    expect(normalizeIdempotencyKey(`bad\nkey`)).toEqual({ ok: false, reason: "invalid" });
    expect(normalizeIdempotencyKey("x".repeat(256))).toEqual({ ok: false, reason: "invalid" });
  });

  it("replays a finished record even when the stored body is empty", () => {
    const hash = requestHash("POST", "/api/v1/workouts", { name: "A" });
    expect(assessIdempotencyRecord(null, hash)).toMatchObject({ type: "conflict" });
    expect(assessIdempotencyRecord({ requestHash: "other", statusCode: null, responseBody: null }, hash)).toMatchObject({
      type: "conflict",
      message: expect.stringContaining("different request body"),
    });
    expect(assessIdempotencyRecord({ requestHash: hash, statusCode: null, responseBody: null }, hash)).toEqual({ type: "pending" });
    expect(assessIdempotencyRecord({ requestHash: hash, statusCode: 201, responseBody: null }, hash)).toEqual({
      type: "replay",
      statusCode: 201,
      responseBody: null,
    });
    expect(assessIdempotencyRecord({ requestHash: hash, statusCode: 200, responseBody: false }, hash)).toEqual({
      type: "replay",
      statusCode: 200,
      responseBody: false,
    });
  });

  it("changes the request hash when the body changes", () => {
    const left = requestHash("POST", "/api/v1/workouts", { name: "A" });
    const right = requestHash("POST", "/api/v1/workouts", { name: "B" });
    expect(left).not.toBe(right);
  });
});
