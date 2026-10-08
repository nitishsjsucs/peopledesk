import { env } from "cloudflare:test";
import { ApproveResponseSchema, PendingActionViewSchema } from "../../src/shared/api-types.ts";
import type { PendingActionView } from "../../src/shared/api-types.ts";
import { api, expectJson } from "./http.ts";

export const ticketArgs = (n = 0) => ({
  category: "it",
  subject: `Laptop will not boot ${n}`,
  description: "My laptop shows a black screen after the logo and will not start.",
  priority: "normal",
});

export async function proposeTicket(as: string, args: Record<string, unknown> = ticketArgs()): Promise<PendingActionView> {
  return expectJson(await api("/api/actions", { as, body: { tool: "create_support_ticket", arguments: args } }), PendingActionViewSchema, 201);
}

export async function proposeBooking(as: string, sessionId: string, employeeId?: string): Promise<PendingActionView> {
  return expectJson(
    await api("/api/actions", {
      as,
      body: { tool: "schedule_orientation_session", arguments: employeeId ? { sessionId, employeeId } : { sessionId } },
    }),
    PendingActionViewSchema,
    201,
  );
}

export const approve = (as: string, actionId: string) => api(`/api/actions/${actionId}/approve`, { as, body: {} });
export const reject = (as: string, actionId: string) => api(`/api/actions/${actionId}/reject`, { as, body: {} });
export const approveJson = async (as: string, actionId: string) => expectJson(await approve(as, actionId), ApproveResponseSchema);

export async function scalar(sql: string, ...params: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...params).first<{ n: number }>();
  return row?.n ?? -1;
}
