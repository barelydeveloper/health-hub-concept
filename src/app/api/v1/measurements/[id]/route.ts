import { deleteMeasurementRoute, patchMeasurement } from "@/server/api/v1";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function PATCH(req: Request, ctx: Ctx) { const { id } = await ctx.params; return patchMeasurement(req, id); }
export async function DELETE(req: Request, ctx: Ctx) { const { id } = await ctx.params; return deleteMeasurementRoute(req, id); }
