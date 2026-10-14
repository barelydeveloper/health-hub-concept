import { postImportUpload } from "@/server/imports/uploads";

export const dynamic = "force-dynamic";
export function POST(req: Request) { return postImportUpload(req); }
