import type { z } from "zod";
import type { ApprovalRequiredOutput, CreateSupportTicketInput } from "../../../shared/tool-schemas.ts";
import type { ToolContext, ToolOutcome } from "../server.ts";

/**
 * Requester is always the principal (no requester field exists). Proposes a pending action through
 * ActionService.propose (at most 5 awaiting per requester); writes nothing to tickets.
 */
export async function createSupportTicket(
  args: z.output<typeof CreateSupportTicketInput>,
  ctx: ToolContext,
): Promise<ToolOutcome<z.output<typeof ApprovalRequiredOutput>>> {
  const { approval } = await ctx.services.actions.propose(ctx.principal, "create_support_ticket", args, ctx.source, {
    approvalOrigin: ctx.approvalOrigin,
    conversationId: ctx.conversationId ?? null,
  });
  return { structured: approval, target: approval.actionId };
}
