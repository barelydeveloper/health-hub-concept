import { processStoredImport } from "../../src/server/imports/worker";

export default async function handler(req: Request): Promise<Response> {
  let batchId: unknown = null;
  try {
    const body = await req.json() as { batchId?: unknown };
    batchId = body.batchId;
  } catch {
    batchId = null;
  }
  if (typeof batchId !== "string" || batchId.length === 0 || batchId.length > 200) {
    return Response.json({ error: "batchId is required" }, { status: 400 });
  }
  await processStoredImport(batchId);
  return Response.json({ ok: true });
}
