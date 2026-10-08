import type { z } from "zod";
import type { ApprovalRequiredOutput, ScheduleOrientationSessionInput } from "../../../shared/tool-schemas.ts";
import type { ToolContext, ToolOutcome } from "../server.ts";

/**
 * Self in onboarding; manager for a direct report in onboarding; hr_admin for anyone in onboarding.
 * Proposal-time checks (session exists and starts after the business date, target not booked, seats
 * remaining) run in ActionService.propose and again at approval. Writes nothing to bookings.
 */
export async function scheduleOrientationSession(
  args: z.output<typeof ScheduleOrientationSessionInput>,
  ctx: ToolContext,
): Promise<ToolOutcome<z.output<typeof ApprovalRequiredOutput>>> {
  const { approval } = await ctx.services.actions.propose(ctx.principal, "schedule_orientation_session", args, ctx.source, {
    approvalOrigin: ctx.approvalOrigin,
    conversationId: ctx.conversationId ?? null,
  });
  return { structured: approval, target: approval.actionId };
}
