import { describe, expect, it } from "vitest";
import { hashPassword, readSession, signSession, verifyPassword } from "./auth";

describe("auth primitives", () => {
  it("verifies a scrypt password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("correct horse", stored)).toBe(true);
    expect(verifyPassword("nope", stored)).toBe(false);
    expect(verifyPassword("correct horse", "plaintext")).toBe(false);
  });

  it("round-trips a session and rejects a tampered signature", () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret";
    const token = signSession("user_1", 1_700_000_000_000);
    expect(readSession(token, 1_700_000_000_000)?.sub).toBe("user_1");
    expect(readSession(`${token}x`, 1_700_000_000_000)).toBeNull();
    expect(readSession(token, 1_700_000_000_000 + 40 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});
