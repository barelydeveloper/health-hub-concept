import { health } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET() { return health(); }
