import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";

const COOKIE = "fi_session";
export type Scope = "read" | "write" | "import";

export interface AuthContext {
  userId: string;
  tokenId: string | null;
  scopes: Scope[];
  via: "session" | "token";
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required");
  return value;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiToken(): { raw: string; hash: string } {
  const raw = `fihub_${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashToken(raw) };
}

export function signSession(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: now + 30 * 24 * 60 * 60 * 1000 })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readSession(token: string, now = Date.now()): { sub: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const actual = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (actual.length !== expectedBuf.length) return null;
  try {
    if (!timingSafeEqual(actual, expectedBuf)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub?: unknown; exp?: unknown };
    if (typeof parsed.sub !== "string" || parsed.sub.length === 0) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp) || parsed.exp <= now) return null;
    return { sub: parsed.sub };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function isScope(value: string): value is Scope {
  return value === "read" || value === "write" || value === "import";
}

export function filterScopes(values: readonly string[]): Scope[] {
  return values.filter(isScope);
}

export function tokenUsable(token: { revokedAt: Date | null; expiresAt: Date | null }, now = Date.now()): boolean {
  if (token.revokedAt) return false;
  if (!token.expiresAt) return true;
  const expiresAt = token.expiresAt.getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export async function touchApiToken(tokenId: string): Promise<void> {
  await prisma.apiToken.update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } });
}

export async function authenticate(req: Request, options?: { touch?: boolean }): Promise<AuthContext | null> {
  const header = req.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const raw = header.slice(7).trim();
    if (!raw) return null;
    const token = await prisma.apiToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!token || !tokenUsable(token)) return null;
    if (options?.touch !== false) await touchApiToken(token.id);
    return { userId: token.userId, tokenId: token.id, scopes: filterScopes(token.scopes), via: "token" };
  }
  const cookie = readCookie(req, COOKIE);
  if (!cookie) return null;
  const session = readSession(cookie);
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.sub }, select: { id: true } });
  if (!user) return null;
  return { userId: user.id, tokenId: null, scopes: ["read", "write", "import"], via: "session" };
}
