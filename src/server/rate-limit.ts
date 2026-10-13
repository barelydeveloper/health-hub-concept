const hits = new Map<string, number[]>();
let limitPerMinute = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 120);

export function setRateLimitForTests(value: number): void {
  limitPerMinute = value;
  hits.clear();
}

export function resetRateLimit(): void {
  hits.clear();
}

export function consumeRate(key: string, now = Date.now()): boolean {
  const windowMs = 60_000;
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limitPerMinute) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
