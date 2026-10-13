import { ready } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET() { return ready(); }
