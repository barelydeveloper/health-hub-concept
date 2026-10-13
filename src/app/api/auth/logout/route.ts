import { logout } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function POST(req: Request) { return logout(req); }
