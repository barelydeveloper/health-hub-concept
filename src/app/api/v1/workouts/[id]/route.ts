import { getWorkoutById, patchWorkoutById } from "@/server/api/v1";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Ctx) { const { id } = await ctx.params; return getWorkoutById(req, id); }
export async function PATCH(req: Request, ctx: Ctx) { const { id } = await ctx.params; return patchWorkoutById(req, id); }
