import type { z } from "zod";
import type { GetOnboardingProgressInput, GetOnboardingProgressOutput } from "../../../shared/tool-schemas.ts";
import { can } from "../../authz/policy.ts";
import { ToolError } from "../errors.ts";
import type { ToolContext, ToolOutcome } from "../server.ts";

/** Self, manager of the employee, or hr_admin; otherwise forbidden. No plan: not_found. */
export async function getOnboardingProgress(
  args: z.output<typeof GetOnboardingProgressInput>,
  ctx: ToolContext,
): Promise<ToolOutcome<z.output<typeof GetOnboardingProgressOutput>>> {
  const { principal, services: s } = ctx;
  const employeeId = args.employeeId ?? principal.employeeId;
  const target = await s.employees.get(employeeId);
  if (!target) {
    // Only HR may learn that an id does not exist; everyone else gets the same answer as for a
    // person outside their scope.
    if (principal.role === "hr_admin") throw new ToolError("not_found", "No such employee.");
    throw new ToolError("forbidden", "You can only view onboarding progress for yourself and the people you support.");
  }
  const decision = can(principal, {
    name: "onboarding.read",
    resource: { employeeId, managerId: target.managerId, inOnboarding: await s.onboarding.hasPlan(employeeId) },
  });
  if (!decision.allowed) {
    throw new ToolError("forbidden", "You can only view onboarding progress for yourself and the people you support.");
  }
  const progress = await s.onboarding.progress(employeeId);
  if (!progress) throw new ToolError("not_found", "No onboarding plan exists for this employee.");
  return { structured: progress, target: employeeId };
}
