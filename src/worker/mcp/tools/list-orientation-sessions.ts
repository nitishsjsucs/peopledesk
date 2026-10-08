import type { z } from "zod";
import type { ListOrientationSessionsInput, ListOrientationSessionsOutput } from "../../../shared/tool-schemas.ts";
import type { ToolContext, ToolOutcome } from "../server.ts";

/** Any principal; no personal data returned. Defaults: asOf to asOf + 60 days. */
export async function listOrientationSessions(
  args: z.output<typeof ListOrientationSessionsInput>,
  ctx: ToolContext,
): Promise<ToolOutcome<z.output<typeof ListOrientationSessionsOutput>>> {
  const s = ctx.services;
  const sessions = await s.orientation.list(s.clock.asOf(), {
    from: args.fromDate,
    to: args.toDate,
    format: args.format,
    region: args.region,
  });
  return { structured: { sessions } };
}
