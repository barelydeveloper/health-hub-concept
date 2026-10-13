import { getNutrition, postNutrition } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return getNutrition(req); }
export function POST(req: Request) { return postNutrition(req); }
