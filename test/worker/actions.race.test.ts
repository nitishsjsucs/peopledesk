// Deterministic races on the approval checkpoint. Two SELF.fetch approvals run one after the other in
// practice, so the second one replays from its JS-side read before the claim gate is ever needed.
// These tests build ActionService directly over a D1 proxy that holds batch() calls at a barrier, so
// both approvals pass every JS check before either batch commits, and only the single-batch claim
// (status = 'awaiting_approval' plus a fresh claim_id) decides the winner.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { AppError } from "../../src/worker/errors.ts";
import { ToolError } from "../../src/worker/mcp/errors.ts";
import { ActionService } from "../../src/worker/services/actions.ts";
import type { ApproveOutcome } from "../../src/worker/services/actions.ts";
import { scalar, ticketArgs } from "../helpers/actions.ts";
import { booked, org, persona, planned, spareEmployees } from "../helpers/fixtures.ts";
import { principalFor, testServices } from "../helpers/services.ts";

const origin = { approvalOrigin: "http://localhost" };
const spares = spareEmployees(4, (e) => !planned.has(e.id));

/** Forwards every call to the real D1 binding, with `this` bound to the binding. */
function d1Proxy(batch: (target: D1Database, statements: D1PreparedStatement[]) => Promise<D1Result[]>): D1Database {
  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "batch") return (statements: D1PreparedStatement[]) => batch(target, statements);
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** The first `parties` batch() calls wait until all of them have arrived, then run. */
function barrierDb(parties: number): D1Database {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => (release = resolve));
  return d1Proxy(async (target, statements) => {
    if (arrived < parties) {
      arrived += 1;
      if (arrived === parties) release();
      await allArrived;
    }
    return target.batch(statements);
  });
}

function serviceOver(db: D1Database): ActionService {
  const s = testServices();
  return new ActionService({
    db,
    clock: s.clock,
    audit: s.audit,
    employees: s.employees,
    onboarding: s.onboarding,
    orientation: s.orientation,
    ttlSeconds: 900,
  });
}

async function auditCount(event: string, actionId: string): Promise<number> {
  return scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = ?1 AND target = ?2", event, actionId);
}

/** One approval executed for real; the other replayed the stored outcome or got 409. */
function expectOneExecution(settled: PromiseSettledResult<ApproveOutcome>[]): void {
  const fresh = settled.filter((r) => r.status === "fulfilled" && r.value.status === "executed" && !r.value.replayed);
  expect(fresh).toHaveLength(1);
  const other = settled.find((r) => r !== fresh[0])!;
  if (other.status === "fulfilled") {
    expect(other.value).toMatchObject({ status: "executed", replayed: true });
  } else {
    expect(other.reason).toBeInstanceOf(AppError);
    expect((other.reason as AppError).status).toBe(409);
  }
}

async function actionRow(id: string) {
  return env.DB.prepare("SELECT status, error_code, superseded_by FROM pending_actions WHERE id = ?1")
    .bind(id)
    .first<{ status: string; error_code: string | null; superseded_by: string | null }>();
}

describe("two approvals racing past every JS check", () => {
  it("executes a ticket once: one ticket, one action_executed, no action_failed", async () => {
    const principal = await principalFor(spares[0]!.email);
    const { view } = await testServices().actions.propose(principal, "create_support_ticket", ticketArgs(), "form", origin);
    const racing = serviceOver(barrierDb(2));

    const settled = await Promise.allSettled([racing.approve(principal, view.actionId), racing.approve(principal, view.actionId)]);

    expectOneExecution(settled);
    expect(await actionRow(view.actionId)).toMatchObject({ status: "executed", error_code: null });
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", view.actionId)).toBe(1);
    expect(await auditCount("action_executed", view.actionId)).toBe(1);
    expect(await auditCount("action_failed", view.actionId)).toBe(0);
    expect(await scalar("SELECT COUNT(*) AS n FROM pending_actions WHERE status = 'executing'")).toBe(0);
  });

  it("executes a booking once: one booking, one action_executed, no action_failed", async () => {
    const hire = org.onboardingPlans.map((p) => p.employeeId).find((id) => !booked.has(id) && id !== persona("new_hire_unbooked").employeeId)!;
    const { results } = await env.DB.prepare(
      `SELECT s.id FROM orientation_sessions s
        WHERE s.capacity - (SELECT COUNT(*) FROM orientation_bookings b WHERE b.session_id = s.id) >= 2 ORDER BY s.id`,
    ).all<{ id: string }>();
    const hr = await principalFor("hr_admin");
    const { view } = await testServices().actions.propose(
      hr,
      "schedule_orientation_session",
      { sessionId: results[0]!.id, employeeId: hire },
      "form",
      origin,
    );
    const racing = serviceOver(barrierDb(2));

    const settled = await Promise.allSettled([racing.approve(hr, view.actionId), racing.approve(hr, view.actionId)]);

    expectOneExecution(settled);
    expect(await actionRow(view.actionId)).toMatchObject({ status: "executed", error_code: null });
    expect(await scalar("SELECT COUNT(*) AS n FROM orientation_bookings WHERE employee_id = ?1", hire)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM orientation_bookings WHERE action_id = ?1", view.actionId)).toBe(1);
    expect(await auditCount("action_executed", view.actionId)).toBe(1);
    expect(await auditCount("action_failed", view.actionId)).toBe(0);
  });
});

describe("an edit racing an approval of the request it replaces", () => {
  it("refuses the edit with conflict when the original is approved first, and writes nothing", async () => {
    const who = spares[1]!;
    const principal = await principalFor(who.email);
    const s = testServices();
    const ticketsBefore = await scalar("SELECT COUNT(*) AS n FROM tickets WHERE requester_id = ?1", who.id);
    const { view: old } = await s.actions.propose(principal, "create_support_ticket", ticketArgs(1), "form", origin);
    // The edit passes its JS check (the original is still awaiting); then, just before its batch, the
    // original is approved elsewhere (another tab).
    let approvedFirst = false;
    const editing = serviceOver(
      d1Proxy(async (target, statements) => {
        if (!approvedFirst) {
          approvedFirst = true;
          await s.actions.approve(principal, old.actionId);
        }
        return target.batch(statements);
      }),
    );

    const attempt = editing.propose(principal, "create_support_ticket", ticketArgs(2), "form", { ...origin, supersedes: old.actionId });

    await expect(attempt).rejects.toBeInstanceOf(ToolError);
    await expect(attempt).rejects.toMatchObject({ code: "conflict" });
    expect(await actionRow(old.actionId)).toMatchObject({ status: "executed", superseded_by: null });
    expect(await scalar("SELECT COUNT(*) AS n FROM pending_actions WHERE requester_id = ?1", who.id)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE requester_id = ?1", who.id)).toBe(ticketsBefore + 1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_proposed' AND actor_id = ?1", who.id)).toBe(1);
  });
});
