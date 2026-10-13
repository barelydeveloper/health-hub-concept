import type { AuthContext } from "@/server/auth";
import { authenticate } from "@/server/auth";
import { apiError, json } from "@/server/http";
import { bodyTrends } from "@/server/services/body";
import { dashboard } from "@/server/services/dashboard";
import { listGoals } from "@/server/services/goals";
import { createWorkout, loadSessions, toSessionInput } from "@/server/services/workouts";
import { personalRecords } from "@/domain/strength/calculate";

const tools = [
  { name: "get_dashboard", description: "Read the current dashboard summary.", inputSchema: { type: "object", properties: {} } },
  { name: "list_workouts", description: "List recent workout sessions.", inputSchema: { type: "object", properties: {} } },
  { name: "get_body_trends", description: "Read raw and hydration-normalized body-composition trends.", inputSchema: { type: "object", properties: {} } },
  { name: "get_personal_records", description: "Read personal records for one exercise slug.", inputSchema: { type: "object", properties: { exerciseSlug: { type: "string" } }, required: ["exerciseSlug"] } },
  { name: "list_goals", description: "Read goals and estimated progress.", inputSchema: { type: "object", properties: {} } },
  { name: "create_workout", description: "Create a workout session. Requires the write scope.", inputSchema: { type: "object", properties: { startedAt: { type: "string" }, name: { type: "string" }, exercises: { type: "array" } }, required: ["startedAt", "exercises"] } },
];

async function callTool(ctx: AuthContext, name: string, args: Record<string, unknown>) {
  if (name === "get_dashboard") return dashboard(ctx.userId);
  if (name === "list_workouts") return (await loadSessions(ctx.userId, {}, 20)).map(toSessionInput);
  if (name === "get_body_trends") return bodyTrends(ctx.userId);
  if (name === "list_goals") return listGoals(ctx.userId);
  if (name === "get_personal_records") {
    const slug = String(args.exerciseSlug ?? "");
    const sessions = (await loadSessions(ctx.userId)).map(toSessionInput);
    return personalRecords(sessions, slug);
  }
  if (name === "create_workout") {
    if (!ctx.scopes.includes("write")) throw new Error("Missing write scope.");
    return createWorkout(ctx, args as never);
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function POST(req: Request): Promise<Response> {
  const ctx = await authenticate(req);
  if (!ctx) return apiError(401, "unauthorized", "Authentication is required.");
  const message = await req.json().catch(() => null) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } } | null;
  if (!message?.method) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }, 400);
  if (message.method === "initialize") {
    return json({ jsonrpc: "2.0", id: message.id ?? null, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fitness-intelligence", version: "2.0.0" } } });
  }
  if (message.method === "tools/list") return json({ jsonrpc: "2.0", id: message.id ?? null, result: { tools } });
  if (message.method === "tools/call") {
    try {
      const result = await callTool(ctx, message.params?.name ?? "", message.params?.arguments ?? {});
      return json({ jsonrpc: "2.0", id: message.id ?? null, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
    } catch (error) {
      return json({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32000, message: error instanceof Error ? error.message : "Tool failed" } });
    }
  }
  return json({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32601, message: "Method not found" } });
}
