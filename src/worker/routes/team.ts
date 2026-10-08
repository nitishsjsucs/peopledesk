import { Hono } from "hono";
import { directorySlice } from "../chat/people.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";

/** The same directory slice the chat router sees: direct reports, or all onboarding hires for hr_admin. */
export const teamRoutes = new Hono<AppEnv>().get("/team", async (c) => {
  const p = c.get("principal");
  if (p.role === "employee") throw new AppError(403, "forbidden", "Only managers and HR administrators have a team view.");
  const members = await directorySlice(c.env.DB, p);
  return c.json({ members });
});
