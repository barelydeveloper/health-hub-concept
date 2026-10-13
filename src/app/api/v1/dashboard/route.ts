import { getDashboard } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return getDashboard(req); }
