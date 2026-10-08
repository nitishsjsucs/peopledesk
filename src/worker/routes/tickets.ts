import { Hono } from "hono";
import { TicketListQuerySchema } from "../../shared/api-types.ts";
import type { AppEnv } from "../hono-env.ts";
import { validate } from "../validation.ts";

/** Own tickets only: the requester is always the principal. */
export const ticketRoutes = new Hono<AppEnv>().get("/tickets", validate("query", TicketListQuerySchema), async (c) => {
  const { status } = c.req.valid("query");
  return c.json({ tickets: await c.get("services").tickets.listOwn(c.get("principal").employeeId, { status }) });
});
