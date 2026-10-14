import { getImport } from "@/server/imports/uploads";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return getImport(req, id);
}
