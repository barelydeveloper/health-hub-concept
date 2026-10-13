import { describe, expect, it } from "vitest";
import { authenticate, clearSessionCookie, filterScopes, hashPassword, readSession, sessionCookie, signSession, tokenUsable, verifyPassword } from "./auth";

describe("auth primitives", () => {
  it("verifies a scrypt password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse");
    expect(verifyPassword("correct horse", stored)).toBe(true);
    expect(verifyPassword("nope", stored)).toBe(false);
    expect(verifyPassword("correct horse", "plaintext")).toBe(false);
  });

  it("round-trips a session and rejects a tampered or expired token", () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret";
    const issued = 1_700_000_000_000;
    const token = signSession("user_1", issued);
    const exp = issued + 30 * 24 * 60 * 60 * 1000;
    expect(readSession(token, issued)?.sub).toBe("user_1");
    expect(readSession(token, exp - 1)?.sub).toBe("user_1");
    expect(readSession(token, exp)).toBeNull();
    expect(readSession(`${token}x`, issued)).toBeNull();
    const flipped = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(readSession(flipped, issued)).toBeNull();
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "user_2", exp })).toString("base64url");
    expect(readSession(`${forged}.${sig}`, issued)).toBeNull();
  });

  it("keeps unknown scopes out and rejects revoked or expired tokens", () => {
    expect(filterScopes(["read", "admin", "WRITE", "import"])).toEqual(["read", "import"]);
    const now = 1_700_000_000_000;
    expect(tokenUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(tokenUsable({ revokedAt: new Date(now - 1), expiresAt: null }, now)).toBe(false);
    expect(tokenUsable({ revokedAt: null, expiresAt: new Date(now + 1) }, now)).toBe(true);
    expect(tokenUsable({ revokedAt: null, expiresAt: new Date(now) }, now)).toBe(false);
    expect(tokenUsable({ revokedAt: null, expiresAt: new Date(Number.NaN) }, now)).toBe(false);
  });

  it("treats a malformed session cookie as anonymous", async () => {
    const req = new Request("http://localhost/api/v1/me", { headers: { cookie: "fi_session=%E0%A4%A" } });
    await expect(authenticate(req)).resolves.toBeNull();
  });

  it("sets an HttpOnly cookie and encodes header-breaking characters", () => {
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.AUTH_SECRET = env.AUTH_SECRET ?? "test-secret";
    try {
      env.NODE_ENV = "test";
      const token = signSession("user_1", 1_700_000_000_000);
      const dev = sessionCookie(token);
      expect(dev).toContain("HttpOnly");
      expect(dev).toContain("SameSite=Lax");
      expect(dev).toContain("Path=/");
      expect(dev).not.toContain("; Secure");
      expect(dev).not.toMatch(/[\r\n]/);
      env.NODE_ENV = "production";
      expect(sessionCookie(token)).toContain("; Secure");
      expect(clearSessionCookie()).toContain("Max-Age=0");
      expect(clearSessionCookie()).toContain("; Secure");
      const injected = sessionCookie("payload.sig\r\nSet-Cookie: evil=1");
      expect(injected).not.toMatch(/[\r\n]/);
      expect(injected).toContain("%0D%0A");
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
