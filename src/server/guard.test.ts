import { describe, expect, it } from "vitest";
import { authDecision } from "./guard";

describe("auth gate order", () => {
  it("rate-limits an authenticated caller before it reports a missing scope", () => {
    expect(authDecision(false, false, false)).toBe(401);
    expect(authDecision(true, false, false)).toBe(429);
    expect(authDecision(true, true, false)).toBe(403);
    expect(authDecision(true, true, true)).toBe(200);
  });
});
