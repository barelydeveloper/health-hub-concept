import { sweepImports } from "../../src/server/imports/worker";

export default async function handler(): Promise<Response> {
  const processed = await sweepImports();
  return Response.json({ ok: true, processed });
}
