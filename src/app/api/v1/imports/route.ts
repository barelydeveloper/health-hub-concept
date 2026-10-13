import { getImports, postImport } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return getImports(req); }
export function POST(req: Request) { return postImport(req); }
