import { Hono } from "hono";
import { SessionListQuerySchema } from "../../shared/api-types.ts";
import type { AppEnv } from "../hono-env.ts";
import { validate } from "../validation.ts";

export const orientationRoutes = new Hono<AppEnv>().get(
  "/orientation-sessions",
  validate("query", SessionListQuerySchema),
  async (c) => {
    const s = c.get("services");
    return c.json({ sessions: await s.orientation.list(s.clock.asOf(), c.req.valid("query")) });
  },
);
