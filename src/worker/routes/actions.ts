// Pending actions over HTTP. POST /api/actions is the forms path into the same ActionService.propose
// the MCP write tools use. Approval happens only here, through an authenticated, same-origin POST by
// the requesting human; there is no approve tool and no chat path to approval.
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  ActionListQuerySchema,
  ApproveRequestSchema,
  ProposeActionRequestSchema,
  RejectRequestSchema,
} from "../../shared/api-types.ts";
import { UUID_RE } from "../../shared/domain.ts";
import type { ApiErrorCode, ToolErrorCode } from "../../shared/domain.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";
import { ToolError } from "../mcp/errors.ts";
import { approvalOriginFor } from "../mcp/route.ts";
import { validate } from "../validation.ts";

const TOOL_TO_HTTP: Record<ToolErrorCode, [ContentfulStatusCode, ApiErrorCode]> = {
  validation_error: [400, "validation_error"],
  forbidden: [403, "forbidden"],
  not_found: [404, "not_found"],
  rate_limited: [429, "rate_limited"],
  conflict: [409, "conflict"],
  not_in_onboarding: [409, "conflict"],
  session_full: [409, "conflict"],
  already_booked: [409, "conflict"],
  session_in_past: [409, "conflict"],
  retrieval_unavailable: [503, "internal"],
};

const notFound = () => new AppError(404, "not_found", "Action not found.");

export const actionRoutes = new Hono<AppEnv>()
  .post("/actions", validate("json", ProposeActionRequestSchema), async (c) => {
    const p = c.get("principal");
    const s = c.get("services");
    const body = c.req.valid("json");
    try {
      const { view } = await s.actions.propose(p, body.tool, body.arguments, "form", {
        approvalOrigin: approvalOriginFor(s.config, c.req.url),
        supersedes: body.supersedes,
      });
      return c.json(view, 201);
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      await s.audit.write({
        actorId: p.employeeId,
        event: err.code === "forbidden" ? "authz_denied" : "tool_call",
        tool: body.tool,
        outcome: err.code,
        detail: { source: "form" },
      });
      const [status, code] = TOOL_TO_HTTP[err.code];
      throw new AppError(status, code, err.message, { reason: err.code });
    }
  })
  .get("/actions", validate("query", ActionListQuerySchema), async (c) => {
    const { status } = c.req.valid("query");
    return c.json({ actions: await c.get("services").actions.list(c.get("principal"), status) });
  })
  .post("/actions/:id/approve", validate("json", ApproveRequestSchema), async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw notFound();
    return c.json(await c.get("services").actions.approve(c.get("principal"), id));
  })
  .post("/actions/:id/reject", validate("json", RejectRequestSchema), async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) throw notFound();
    const { reason } = c.req.valid("json");
    return c.json(await c.get("services").actions.reject(c.get("principal"), id, reason));
  });
