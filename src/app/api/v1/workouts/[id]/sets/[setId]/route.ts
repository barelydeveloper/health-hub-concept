import { deleteSet, patchSet } from "@/server/api/v1";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; setId: string }> };
export async function PATCH(req: Request, ctx: Ctx) { const { id, setId } = await ctx.params; return patchSet(req, id, setId); }
export async function DELETE(req: Request, ctx: Ctx) { const { id, setId } = await ctx.params; return deleteSet(req, id, setId); }
