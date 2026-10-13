import { afterEach, describe, expect, it } from "vitest";
import { consumeRate, resetRateLimit, setRateLimitForTests } from "./rate-limit";

describe("rate limit", () => {
  afterEach(() => {
    resetRateLimit();
  });

  it("blocks the request that exceeds a finite limit", () => {
    setRateLimitForTests(2);
    expect(consumeRate("token-a", 1_000)).toBe(true);
    expect(consumeRate("token-a", 1_000)).toBe(true);
    expect(consumeRate("token-a", 1_000)).toBe(false);
    expect(consumeRate("token-b", 1_000)).toBe(true);
  });

  it("does not disable the limiter when the configured limit is not finite", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      setRateLimitForTests(value);
      let allowed = 0;
      for (let i = 0; i < 121; i += 1) {
        if (consumeRate("same", 5_000)) allowed += 1;
      }
      expect(allowed).toBe(120);
    }
  });

  it("rejects a new bucket when every tracked key is still inside the window", () => {
    setRateLimitForTests(5, { maxKeys: 1 });
    expect(consumeRate("first", 0)).toBe(true);
    expect(consumeRate("second", 1_000)).toBe(false);
    expect(consumeRate("first", 1_000)).toBe(true);
    expect(consumeRate("second", 61_000)).toBe(true);
  });
});
