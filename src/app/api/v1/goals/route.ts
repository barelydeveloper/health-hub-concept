import { getGoals, postGoal } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return getGoals(req); }
export function POST(req: Request) { return postGoal(req); }
