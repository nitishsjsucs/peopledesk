import { Hono } from "hono";
import type { OnboardingOverview } from "../../shared/api-types.ts";
import { directorySlice } from "../chat/people.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";
import { overviewRows, percentComplete, shapeOverview } from "../services/onboarding.ts";

type TaskTotals = { employee_id: string; total: number; done: number; blocked: number };

const teamViewOnly = () => new AppError(403, "forbidden", "Only managers and HR administrators have a team view.");

/**
 * The same directory slice the chat router sees (direct reports, or all onboarding hires for hr_admin),
 * plus each member's onboarding progress for the team view: one aggregate query over the tasks of the
 * ids the slice returned, so the scope is exactly the slice's.
 */
export const teamRoutes = new Hono<AppEnv>()
  .get("/team", async (c) => {
    const p = c.get("principal");
    if (p.role === "employee") throw teamViewOnly();
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
  })
  // Where the people in that slice who have a plan stand against their task due dates, and which
  // checklist steps are stuck. It reads no parameter, so no request can widen its scope: the ids are
  // the slice's, every person row is re-checked with onboarding.read, and the step counts cover only
  // tasks of people the caller can already open one by one (GET /api/onboarding/:employeeId).
  // Not under /api/onboarding/, where GET /api/onboarding/:employeeId would take the path.
  .get("/team/onboarding", async (c) => {
    const p = c.get("principal");
    if (p.role === "employee") throw teamViewOnly();
    const asOf = c.get("clock").asOf();
    const slice = await directorySlice(c.env.DB, p);
    const ids = slice.filter((m) => m.inOnboarding).map((m) => m.employeeId);
    if (ids.length === 0) return c.json({ asOf, people: [], steps: [] } satisfies OnboardingOverview);
    const { overview, dropped } = shapeOverview(p, asOf, await overviewRows(c.env.DB, ids, asOf));
    if (dropped.length > 0) {
      console.error(JSON.stringify({ msg: "team_onboarding_dropped", requestId: c.get("requestId"), count: dropped.length }));
    }
    return c.json(overview);
  });
