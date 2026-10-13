import { me, patchProfile } from "@/server/api/v1";
export const dynamic = "force-dynamic";
export function GET(req: Request) { return me(req); }
export function PATCH(req: Request) { return patchProfile(req); }
