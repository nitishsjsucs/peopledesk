import { Hono } from "hono";
import { EMPLOYEE_ID_RE } from "../../shared/domain.ts";
import { can } from "../authz/policy.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";

const notFound = () => new AppError(404, "not_found", "No onboarding plan found.");

export const onboardingRoutes = new Hono<AppEnv>()
  .get("/onboarding", async (c) => {
    const progress = await c.get("services").onboarding.progress(c.get("principal").employeeId);
    if (!progress) throw notFound();
    return c.json(progress);
  })
  .get("/onboarding/:employeeId", async (c) => {
    const employeeId = c.req.param("employeeId");
    if (!EMPLOYEE_ID_RE.test(employeeId)) throw notFound();
    const p = c.get("principal");
    const s = c.get("services");
    const target = await s.employees.get(employeeId);
    const inOnboarding = target ? await s.onboarding.hasPlan(employeeId) : false;
    const decision = target
      ? can(p, { name: "onboarding.read", resource: { employeeId, managerId: target.managerId, inOnboarding } })
      : { allowed: false as const, reason: "not_self" as const };
    // Self, manager of, or hr_admin; anything else is a 404, the same as a missing plan.
    if (!decision.allowed) {
      await s.audit.write({
        actorId: p.employeeId,
        event: "authz_denied",
        target: employeeId,
        outcome: decision.reason,
        detail: { route: "GET /api/onboarding/:employeeId" },
      });
      throw notFound();
    }
    const progress = await s.onboarding.progress(employeeId);
    if (!progress) throw notFound();
    return c.json(progress);
  });
