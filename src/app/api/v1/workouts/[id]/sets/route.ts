import { postSets } from "@/server/api/v1";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(req: Request, ctx: Ctx) { const { id } = await ctx.params; return postSets(req, id); }
