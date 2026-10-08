import type { z } from "zod";
import type { ListMyTicketsInput, ListMyTicketsOutput } from "../../../shared/tool-schemas.ts";
import type { ToolContext, ToolOutcome } from "../server.ts";

/** WHERE requester_id = principal.employeeId; there is no parameter to name another person. */
export async function listMyTickets(
  args: z.output<typeof ListMyTicketsInput>,
  ctx: ToolContext,
): Promise<ToolOutcome<z.output<typeof ListMyTicketsOutput>>> {
  const tickets = await ctx.services.tickets.listOwn(ctx.principal.employeeId, { status: args.status, limit: args.limit });
  return {
    structured: {
      tickets: tickets.map((t) => ({
        id: t.id,
        category: t.category,
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    },
  };
}
