import { listTokens, postToken } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return listTokens(req); }
export function POST(req: Request) { return postToken(req); }
