import { Hono } from "hono";
import { directorySlice } from "../chat/people.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";
import { percentComplete } from "../services/onboarding.ts";

type TaskTotals = { employee_id: string; total: number; done: number; blocked: number };

/**
 * The same directory slice the chat router sees (direct reports, or all onboarding hires for hr_admin),
 * plus each member's onboarding progress for the team view: one aggregate query over the tasks of the
 * ids the slice returned, so the scope is exactly the slice's.
 */
export const teamRoutes = new Hono<AppEnv>().get("/team", async (c) => {
  const p = c.get("principal");
  if (p.role === "employee") throw new AppError(403, "forbidden", "Only managers and HR administrators have a team view.");
  const slice = await directorySlice(c.env.DB, p);
  const ids = slice.filter((m) => m.inOnboarding).map((m) => m.employeeId);
  const totals = new Map<string, TaskTotals>();
  if (ids.length > 0) {
    const { results } = await c.env.DB.prepare(
      `SELECT employee_id, COUNT(*) AS total,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
         FROM onboarding_tasks WHERE employee_id IN (SELECT value FROM json_each(?1)) GROUP BY employee_id`,
    )
      .bind(JSON.stringify(ids))
      .all<TaskTotals>();
    for (const r of results) totals.set(r.employee_id, r);
  }
  const members = slice.map((m) => {
    const t = totals.get(m.employeeId);
    return {
      ...m,
      percentComplete: m.inOnboarding ? percentComplete(t?.done ?? 0, t?.total ?? 0) : null,
      blockedTasks: t?.blocked ?? 0,
    };
  });
  return c.json({ members });
});
