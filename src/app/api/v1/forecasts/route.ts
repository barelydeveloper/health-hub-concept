import { getForecasts, postForecast } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return getForecasts(req); }
export function POST(req: Request) { return postForecast(req); }
