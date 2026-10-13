const DEFAULT_LIMIT = 120;
const DEFAULT_MAX_KEYS = 10_000;
const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();
let limitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_LIMIT);
let maxKeys = DEFAULT_MAX_KEYS;

export function setRateLimitForTests(value: number, options?: { maxKeys?: number }): void {
  limitPerMinute = value;
  maxKeys = options?.maxKeys ?? DEFAULT_MAX_KEYS;
  hits.clear();
}

export function resetRateLimit(): void {
  hits.clear();
  limitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_LIMIT);
  maxKeys = DEFAULT_MAX_KEYS;
}

function effectiveLimit(): number {
  if (!Number.isFinite(limitPerMinute)) return DEFAULT_LIMIT;
  return Math.floor(limitPerMinute);
}

function evictStale(now: number): boolean {
  for (const [key, stamps] of hits) {
    if (!stamps.some((stamp) => now - stamp < WINDOW_MS)) hits.delete(key);
    if (hits.size < maxKeys) return true;
  }
  return hits.size < maxKeys;
}

export function consumeRate(key: string, now = Date.now()): boolean {
  const limit = effectiveLimit();
  if (limit <= 0) return false;
  const known = hits.has(key);
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= limit) {
    if (known) hits.set(key, recent);
    return false;
  }
  if (!known && hits.size >= maxKeys && !evictStale(now)) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}
