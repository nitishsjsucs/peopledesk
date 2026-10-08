// ALL /mcp: requireAuth runs first (app.ts), then the agents stateless MCP handler serves a fresh
// McpServer bound to the verified principal. The real JWT is never placed in authInfo.token.
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import type { StatelessMcpHandler } from "agents/mcp/server";
import { Hono } from "hono";
import type { Principal } from "../auth/principal.ts";
import type { AppConfig } from "../env.ts";
import type { AppEnv } from "../hono-env.ts";
import { buildMcpServer } from "./server.ts";
import type { ToolContext } from "./server.ts";

export const IN_PROCESS_HOST = "mcp.internal";

export function mcpHandlerFor(ctx: ToolContext): StatelessMcpHandler {
  return createMcpHandler(() => buildMcpServer(ctx), {
    route: "/mcp",
    allowedHostnames: [ctx.services.config.appHostname, "localhost", "127.0.0.1", IN_PROCESS_HOST],
    corsOptions: false,
    authContext: { props: { employeeId: ctx.principal.employeeId } },
  });
}

export function authInfoFor(principal: Principal): AuthInfo {
  return { token: "access-verified", clientId: principal.employeeId, scopes: [principal.role] };
}

/** approvalUrl origin: the configured hostname in access mode; the request origin in dev (port unknown). */
export function approvalOriginFor(cfg: AppConfig, requestUrl: string): string {
  return cfg.authMode === "access" ? `https://${cfg.appHostname}` : new URL(requestUrl).origin;
}

export const mcpRoutes = new Hono<AppEnv>().all("/mcp", async (c) => {
  const principal = c.get("principal");
  const services = c.get("services");
  const handler = mcpHandlerFor({
    principal,
    services,
    approvalOrigin: approvalOriginFor(services.config, c.req.url),
    source: "mcp",
  });
  return handler.fetch(c.req.raw, { authInfo: authInfoFor(principal) });
});
