// GET /api/team/onboarding: per-person task counts against due dates and the stuck checklist steps,
// for exactly the people a manager or HR admin may open one by one. Counts are checked against an
// oracle computed from org.json at the pinned business date (2026-10-01).
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { OnboardingOverviewSchema } from "../../src/shared/api-types.ts";
import type { OnboardingOverview } from "../../src/shared/api-types.ts";
import { addDaysIso } from "../../src/shared/dates.ts";
import { shapeOverview } from "../../src/worker/services/onboarding.ts";
import { approveJson, proposeBooking } from "../helpers/actions.ts";
import { booked, org, persona, planned, reportsOf } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";

const AS_OF = "2026-10-01";
const NEXT7 = addDaysIso(AS_OF, 7);

const overviewAs = async (as: string, query = "") => expectJson(await api(`/api/team/onboarding${query}`, { as }), OnboardingOverviewSchema);

type Task = (typeof org.onboardingTasks)[number];
const tasksOf = (id: string) => org.onboardingTasks.filter((t) => t.employeeId === id);
const isOverdue = (t: Task) => t.status !== "done" && t.dueDate < AS_OF;
const isDueNext7 = (t: Task) => t.status !== "done" && t.dueDate >= AS_OF && t.dueDate <= NEXT7;

/** The per-person counts as the definitions in SPEC section 8 state them, from org.json. */
function oracleTasks(id: string) {
  const ts = tasksOf(id);
  return {
    total: ts.length,
    done: ts.filter((t) => t.status === "done").length,
    overdue: ts.filter(isOverdue).length,
    blocked: ts.filter((t) => t.status === "blocked").length,
    dueNext7: ts.filter(isDueNext7).length,
  };
}

/** The stuck steps for a set of people, in the response's order. */
function oracleSteps(ids: readonly string[]) {
  const groups = new Map<string, { stepKey: number; title: string; ownerRole: string; blocked: number; overdueNotBlocked: number; dueNext7: number; ids: Set<string> }>();
  for (const t of org.onboardingTasks.filter((x) => ids.includes(x.employeeId))) {
    const key = `${t.title}|${t.ownerRole}`;
    const g = groups.get(key) ?? { stepKey: t.ordinal, title: t.title, ownerRole: t.ownerRole, blocked: 0, overdueNotBlocked: 0, dueNext7: 0, ids: new Set<string>() };
    g.stepKey = Math.min(g.stepKey, t.ordinal);
    if (t.status === "blocked") g.blocked++;
    if (t.status !== "done" && t.status !== "blocked" && t.dueDate < AS_OF) g.overdueNotBlocked++;
    if (isDueNext7(t)) g.dueNext7++;
    if (t.status === "blocked" || isOverdue(t)) g.ids.add(t.employeeId);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.blocked + g.overdueNotBlocked > 0)
    .sort((a, b) => b.blocked + b.overdueNotBlocked - (a.blocked + a.overdueNotBlocked) || b.blocked - a.blocked || a.stepKey - b.stepKey)
    .map(({ ids: set, ...g }) => ({ ...g, employeeIds: [...set].sort() }));
}

const deepa = persona("manager_with_new_hires");
const deepaIds = reportsOf(deepa.employeeId)
  .filter((e) => planned.has(e.id))
  .map((e) => e.id);
const allPlanned = org.onboardingPlans.map((p) => p.employeeId).sort();

const byId = (o: OnboardingOverview, id: string) => o.people.find((p) => p.employeeId === id)!;

describe("GET /api/team/onboarding", () => {
  it("is forbidden for an employee, exactly as /api/team", async () => {
    await expectError(await api("/api/team/onboarding", { as: "tenured_employee" }), 403, "forbidden");
    await expectError(await api("/api/team/onboarding", { as: "new_hire_unbooked" }), 403, "forbidden");
    await expectError(await api("/api/team/onboarding"), 401, "unauthenticated");
  });

  it("gives a manager exactly her reports in onboarding, with the seeded counts", async () => {
    const o = await overviewAs(deepa.key);
    expect(o.asOf).toBe(AS_OF);
    expect(deepaIds).toEqual(["E0024", "E0030", "E0033", "E0036", "E0051"]);
    expect(o.people.map((p) => p.employeeId)).toEqual(deepaIds);
    for (const p of o.people) expect(p.tasks, p.employeeId).toEqual(oracleTasks(p.employeeId));
    // The literal values the plan was checked against.
    expect(byId(o, "E0024").tasks).toMatchObject({ total: 12, done: 7, overdue: 2, blocked: 0 });
    expect(byId(o, "E0036").tasks).toMatchObject({ done: 6, overdue: 3, blocked: 0 });
    expect(byId(o, "E0030").tasks).toMatchObject({ done: 7, overdue: 2, blocked: 1 });
    expect(byId(o, "E0051")).toMatchObject({ startDate: "2026-10-16", tasks: { done: 0, overdue: 0, blocked: 0 } });
    const plan = org.onboardingPlans.find((p) => p.employeeId === "E0024")!;
    expect(byId(o, "E0024")).toMatchObject({ fullName: "Olivia Morgan", startDate: plan.startDate, targetCompletionDate: plan.targetCompletionDate, orientation: null });
    expect(byId(o, "E0024").orientationTaskDue).toBe(tasksOf("E0024").find((t) => t.category === "orientation")!.dueDate);
    for (const p of o.people) expect(p.orientationTaskDone, p.employeeId).toBe(false);
    for (const p of o.people) expect(p.orientation === null, p.employeeId).toBe(!booked.has(p.employeeId));
  });

  it("gives a manager without reports in onboarding nothing, without a batch", async () => {
    expect(await overviewAs("manager_no_new_hires")).toEqual({ asOf: AS_OF, people: [], steps: [] });
  });

  it("gives HR everyone with a plan: 12 unbooked (4 of them with the orientation task done), 14 with blocked tasks, 19 with overdue tasks", async () => {
    const o = await overviewAs("hr_admin");
    expect(o.people.map((p) => p.employeeId)).toEqual(allPlanned);
    expect(o.people).toHaveLength(30);
    expect(o.people.filter((p) => p.orientation === null)).toHaveLength(12);
    // orientationTaskDone against the oracle, and the four the seed has done without a booking.
    for (const p of o.people) {
      expect(p.orientationTaskDone, p.employeeId).toBe(tasksOf(p.employeeId).some((t) => t.category === "orientation" && t.status === "done"));
    }
    expect(o.people.filter((p) => p.orientation === null && p.orientationTaskDone).map((p) => p.employeeId)).toEqual(["E0064", "E0084", "E0085", "E0107"]);
    expect(o.people.filter((p) => p.orientation !== null && p.orientationTaskDone).map((p) => p.employeeId)).toEqual(["E0082", "E0086"]);
    expect(o.people.filter((p) => p.tasks.blocked > 0)).toHaveLength(14);
    expect(o.people.filter((p) => p.tasks.overdue > 0)).toHaveLength(19);
    for (const p of o.people) expect(p.tasks, p.employeeId).toEqual(oracleTasks(p.employeeId));
    const seeded = org.bookings.find((b) => b.employeeId === "E0022")!;
    const session = org.sessions.find((s) => s.id === seeded.sessionId)!;
    expect(byId(o, "E0022").orientation).toEqual({ sessionId: session.id, startsAt: session.startsAt });
  });

  it("ignores query parameters: none widens or changes the scope", async () => {
    const plain = await overviewAs(deepa.key);
    expect(await overviewAs(deepa.key, "?employeeId=E0001&role=hr_admin&managerId=E0016")).toEqual(plain);
  });

  it("lists HR's stuck steps as the oracle computes them, most stuck first", async () => {
    const o = await overviewAs("hr_admin");
    expect(o.steps).toEqual(oracleSteps(allPlanned));
    expect(o.steps).toHaveLength(12);
    expect(o.steps.slice(0, 2)).toEqual([
      expect.objectContaining({ title: "Enroll in multi-factor authentication", ownerRole: "employee", blocked: 3, overdueNotBlocked: 6 }),
      expect.objectContaining({ title: "First one-on-one with your manager", ownerRole: "manager", blocked: 4, overdueNotBlocked: 2 }),
    ]);
    expect(o.steps[0]!.employeeIds).toHaveLength(9);
    expect(o.steps[1]!.employeeIds).toHaveLength(6);
    expect(o.steps.slice(2, 5).map((s) => [s.title, s.blocked, s.overdueNotBlocked])).toEqual([
      ["Submit tax and payroll forms", 2, 3],
      ["Code of conduct training", 1, 4],
      ["Security awareness training", 0, 5],
    ]);
    const blocked = o.steps.reduce((n, s) => n + s.blocked, 0);
    const overdue = o.steps.reduce((n, s) => n + s.overdueNotBlocked, 0);
    expect([blocked, overdue]).toEqual([20, 26]);
    // Every step id is one of the people, and a step with nothing stuck is left out (HAVING).
    const people = new Set(o.people.map((p) => p.employeeId));
    for (const s of o.steps) {
      expect(s.blocked + s.overdueNotBlocked).toBeGreaterThan(0);
      expect(s.employeeIds.every((id) => people.has(id))).toBe(true);
    }
  });

  it("counts only a manager's reports' tasks in her steps", async () => {
    const o = await overviewAs(deepa.key);
    expect(o.steps).toEqual(oracleSteps(deepaIds));
    expect(o.steps).toHaveLength(6);
    expect(o.steps[0]).toMatchObject({ title: "Submit tax and payroll forms", blocked: 0, overdueNotBlocked: 2, employeeIds: ["E0024", "E0036"] });
    expect(o.steps.find((s) => s.title === "First one-on-one with your manager")).toMatchObject({ ownerRole: "manager", employeeIds: ["E0036"] });
    const ids = new Set(deepaIds);
    for (const s of o.steps) expect(s.employeeIds.every((id) => ids.has(id))).toBe(true);
  });

  it("drops a person row the principal may not read, and then every step (fail closed)", () => {
    const row = (id: string, managerId: string) => ({
      employee_id: id,
      full_name: `Person ${id}`,
      manager_id: managerId,
      start_date: "2026-09-01",
      target_completion_date: "2026-11-30",
      total: 12,
      done: 1,
      blocked: 1,
      overdue: 1,
      due_next7: 0,
      orientation_task_due: null,
      orientation_task_done: 0,
    });
    const step = { step_key: 3, title: "Step", owner_role: "employee" as const, blocked: 1, overdue_not_blocked: 1, due_next7: 0, stuck_ids: "E0024,E9001" };
    const principal = { employeeId: deepa.employeeId, role: "manager" as const, identityKind: "user" as const };
    const ok = shapeOverview(principal, AS_OF, { people: [row("E0024", deepa.employeeId)], bookings: [], steps: [step] });
    expect(ok.dropped).toEqual([]);
    expect(ok.overview.steps[0]?.employeeIds).toEqual(["E0024"]);
    const mixed = shapeOverview(principal, AS_OF, { people: [row("E0024", deepa.employeeId), row("E9001", "E0099")], bookings: [], steps: [step] });
    expect(mixed.dropped).toEqual(["E9001"]);
    expect(mixed.overview.people.map((p) => p.employeeId)).toEqual(["E0024"]);
    expect(mixed.overview.steps).toEqual([]);
  });

  // The tests below change D1; each puts back what it changed.
  it("never shows a booking of someone outside the manager's slice", async () => {
    const outsider = org.onboardingPlans.map((p) => p.employeeId).find((id) => !deepaIds.includes(id) && !booked.has(id))!;
    await env.DB.prepare("INSERT INTO orientation_bookings (id, session_id, employee_id, booked_by, created_at) VALUES ('BKG-test-x', 'ORI-004', ?1, ?1, '2026-10-01T00:00:00.000Z')")
      .bind(outsider)
      .run();
    try {
      const o = await overviewAs(deepa.key);
      expect(o.people.map((p) => p.employeeId)).toEqual(deepaIds);
      expect(JSON.stringify(o)).not.toContain(outsider);
      expect(byId(await overviewAs("hr_admin"), outsider).orientation?.sessionId).toBe("ORI-004");
    } finally {
      await env.DB.prepare("DELETE FROM orientation_bookings WHERE id = 'BKG-test-x'").run();
    }
  });

  it("counts a task due today as due in the next 7 days, not overdue, and one due in 8 days as neither", async () => {
    const id = "E0033";
    const before = byId(await overviewAs(deepa.key), id).tasks;
    const open = tasksOf(id).filter((t) => t.status !== "done" && t.status !== "blocked" && t.dueDate > NEXT7);
    const [a, b] = open as [Task, Task];
    try {
      await env.DB.prepare("UPDATE onboarding_tasks SET due_date = ?2 WHERE id = ?1").bind(a.id, AS_OF).run();
      await env.DB.prepare("UPDATE onboarding_tasks SET due_date = ?2 WHERE id = ?1").bind(b.id, addDaysIso(AS_OF, 8)).run();
      const after = byId(await overviewAs(deepa.key), id).tasks;
      expect(after).toEqual({ ...before, dueNext7: before.dueNext7 + 1 });
    } finally {
      await env.DB.prepare("UPDATE onboarding_tasks SET due_date = ?2 WHERE id = ?1").bind(a.id, a.dueDate).run();
      await env.DB.prepare("UPDATE onboarding_tasks SET due_date = ?2 WHERE id = ?1").bind(b.id, b.dueDate).run();
    }
  });

  it("changes HR's step counts and not the manager's when another manager's report's task is blocked", async () => {
    const other = org.onboardingTasks.find((t) => !deepaIds.includes(t.employeeId) && t.status === "pending" && t.dueDate > NEXT7)!;
    const hrBefore = await overviewAs("hr_admin");
    const deepaBefore = await overviewAs(deepa.key);
    try {
      await env.DB.prepare("UPDATE onboarding_tasks SET status = 'blocked' WHERE id = ?1").bind(other.id).run();
      const hrAfter = await overviewAs("hr_admin");
      const step = (o: OnboardingOverview) => o.steps.find((s) => s.title === other.title && s.ownerRole === other.ownerRole);
      expect((step(hrAfter)?.blocked ?? 0) - (step(hrBefore)?.blocked ?? 0)).toBe(1);
      expect(step(hrAfter)?.employeeIds).toContain(other.employeeId);
      expect(await overviewAs(deepa.key)).toEqual(deepaBefore);
    } finally {
      await env.DB.prepare("UPDATE onboarding_tasks SET status = ?2 WHERE id = ?1").bind(other.id, other.status).run();
    }
  });

  it("reports the orientation task as done once it is, and only that person's", async () => {
    const task = tasksOf("E0033").find((t) => t.category === "orientation")!;
    expect(task.status).not.toBe("done");
    try {
      await env.DB.prepare("UPDATE onboarding_tasks SET status = 'done', completed_at = '2026-09-30T12:00:00.000Z' WHERE id = ?1").bind(task.id).run();
      const o = await overviewAs(deepa.key);
      expect(o.people.filter((p) => p.orientationTaskDone).map((p) => p.employeeId)).toEqual(["E0033"]);
      expect(byId(o, "E0033").orientation).toBeNull();
    } finally {
      await env.DB.prepare("UPDATE onboarding_tasks SET status = ?2, completed_at = NULL WHERE id = ?1").bind(task.id, task.status).run();
    }
    expect(byId(await overviewAs(deepa.key), "E0033").orientationTaskDone).toBe(false);
  });

  it("shows a booking once it is approved", async () => {
    const proposed = await proposeBooking(deepa.key, "ORI-004", "E0024");
    expect((await approveJson(deepa.key, proposed.actionId)).status).toBe("executed");
    const session = org.sessions.find((s) => s.id === "ORI-004")!;
    expect(byId(await overviewAs(deepa.key), "E0024").orientation).toEqual({ sessionId: "ORI-004", startsAt: session.startsAt });
  });
});
