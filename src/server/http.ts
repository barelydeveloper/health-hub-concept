export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

export function apiError(status: number, code: string, message: string, details?: unknown): Response {
  return json({ error: { code, message, details: details ?? null } }, status);
}

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}\n${id}`).toString("base64url");
}

export function decodeCursor(cursor: string | null): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString().split("\n");
    if (!at || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function pageParams(url: URL): { limit: number; cursor: { at: string; id: string } | null; from: Date | null; to: Date | null } {
  const limitRaw = Number(url.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 50;
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  return {
    limit,
    cursor: decodeCursor(url.searchParams.get("cursor")),
    from: from && !Number.isNaN(from.getTime()) ? from : null,
    to: to && !Number.isNaN(to.getTime()) ? to : null,
  };
}
