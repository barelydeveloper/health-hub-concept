import { getRecords } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return getRecords(req); }
