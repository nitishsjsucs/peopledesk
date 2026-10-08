// buildMcpServer(ctx): a fresh McpServer per request with the six tools, binding the verified
// principal and the request's services to the module-scope tool definitions (tool-defs.ts).
// The chat agent reaches the same server through the in-process client, so the UI and external MCP
// clients share one validation and authorization path.
import { McpServer } from "@modelcontextprotocol/server";
import { APP_VERSION } from "../../shared/domain.ts";
import type { ToolName } from "../../shared/domain.ts";
import type { Principal } from "../auth/principal.ts";
import type { Services } from "../container.ts";
import { toolErrorResult, ToolError } from "./errors.ts";
import { TOOL_DEFS } from "./tool-defs.ts";
import { getOnboardingProgress } from "./tools/get-onboarding-progress.ts";
import { listMyTickets } from "./tools/list-my-tickets.ts";
import { listOrientationSessions } from "./tools/list-orientation-sessions.ts";
import { searchPolicies } from "./tools/search-policies.ts";

export type ToolContext = {
  principal: Principal;
  services: Services;
  /** Origin used for approvalUrl: https://<APP_HOSTNAME> in access mode, the request origin in dev. */
  approvalOrigin: string;
  /** Chat source when the call comes from the in-process client, mcp otherwise. */
  source: "chat" | "mcp";
  conversationId?: string;
  signal?: AbortSignal;
};

export type ToolOutcome<T> = { structured: T; meta?: Record<string, unknown>; target?: string };

type Impl<A, T> = (args: A, ctx: ToolContext) => Promise<ToolOutcome<T>>;

function wrap<A, T extends Record<string, unknown>>(name: ToolName, impl: Impl<A, T>, ctx: ToolContext) {
  return async (args: A) => {
    const actorId = ctx.principal.employeeId;
    try {
      const out = await impl(args, ctx);
      await ctx.services.audit.write({
        actorId,
        event: "tool_call",
        tool: name,
        target: out.target ?? null,
        outcome: "ok",
        detail: { source: ctx.source },
      });
      return {
        content: [{ type: "text" as const, text: JSON.stringify(out.structured) }],
        structuredContent: out.structured,
        ...(out.meta ? { _meta: out.meta } : {}),
      };
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      await ctx.services.audit.write({
        actorId,
        event: err.code === "forbidden" ? "authz_denied" : "tool_call",
        tool: name,
        target: null,
        outcome: err.code,
        detail: { source: ctx.source, args: redactArgs(args) },
      });
      return toolErrorResult(err.code, err.message);
    }
  };
}

/** Keeps ids and enums for the audit trail, drops free text. */
function redactArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 40) continue;
    if (k === "description" || k === "query") continue;
    out[k] = v;
  }
  return out;
}

export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "peopledesk", version: APP_VERSION });
  const reg = <N extends ToolName>(name: N) => {
    const d = TOOL_DEFS[name];
    return { title: d.title, description: d.description, annotations: d.annotations } as const;
  };
  server.registerTool(
    "search_policies",
    { ...reg("search_policies"), inputSchema: TOOL_DEFS.search_policies.input, outputSchema: TOOL_DEFS.search_policies.output },
    wrap("search_policies", searchPolicies, ctx),
  );
  server.registerTool(
    "list_my_tickets",
    { ...reg("list_my_tickets"), inputSchema: TOOL_DEFS.list_my_tickets.input, outputSchema: TOOL_DEFS.list_my_tickets.output },
    wrap("list_my_tickets", listMyTickets, ctx),
  );
  server.registerTool(
    "get_onboarding_progress",
    {
      ...reg("get_onboarding_progress"),
      inputSchema: TOOL_DEFS.get_onboarding_progress.input,
      outputSchema: TOOL_DEFS.get_onboarding_progress.output,
    },
    wrap("get_onboarding_progress", getOnboardingProgress, ctx),
  );
  server.registerTool(
    "list_orientation_sessions",
    {
      ...reg("list_orientation_sessions"),
      inputSchema: TOOL_DEFS.list_orientation_sessions.input,
      outputSchema: TOOL_DEFS.list_orientation_sessions.output,
    },
    wrap("list_orientation_sessions", listOrientationSessions, ctx),
  );
  return server;
}
