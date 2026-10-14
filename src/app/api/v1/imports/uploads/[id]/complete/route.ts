import { postImportUploadComplete } from "@/server/imports/uploads";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return postImportUploadComplete(req, id);
}
