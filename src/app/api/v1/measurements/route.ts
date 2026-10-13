import { listMeasurementRoute, postMeasurement } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return listMeasurementRoute(req); }
export function POST(req: Request) { return postMeasurement(req); }
