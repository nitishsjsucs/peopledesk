// The approval checkpoint. Storage is isolated per test file only, so every scenario below uses its own
// requester or session and none depends on the order of the others.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ActionListSchema, PendingActionViewSchema } from "../../src/shared/api-types.ts";
import { approve, approveJson, proposeBooking, proposeTicket, reject, scalar, ticketArgs } from "../helpers/actions.ts";
import { booked, org, persona, planned, reportsOf, spareEmployees } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";
import { call, mcpClient } from "../helpers/mcp.ts";

const spares = spareEmployees(14, (e) => !planned.has(e.id));
const spare = (i: number) => spares[i]!.email;
const unbookedHires = org.onboardingPlans
  .map((p) => p.employeeId)
  .filter((id) => !booked.has(id) && id !== persona("new_hire_unbooked").employeeId)
  .filter((id) => !reportsOf(persona("manager_with_new_hires").employeeId).some((e) => e.id === id));
const emailOf = (id: string) => org.employees.find((e) => e.id === id)!.email;

async function openSession(minSeats = 2): Promise<string> {
  const { results } = await env.DB.prepare(
    `SELECT s.id FROM orientation_sessions s
      WHERE s.capacity - (SELECT COUNT(*) FROM orientation_bookings b WHERE b.session_id = s.id) >= ?1 ORDER BY s.id`,
  )
    .bind(minSeats)
    .all<{ id: string }>();
  return results[0]!.id;
}

describe("proposals never write", () => {
  it("creates awaiting_approval rows and no ticket or booking", async () => {
    const tickets = await scalar("SELECT COUNT(*) AS n FROM tickets");
    const bookings = await scalar("SELECT COUNT(*) AS n FROM orientation_bookings");
    const t = await proposeTicket(spare(0));
    expect(t.status).toBe("awaiting_approval");
    const r = await call(await mcpClient("new_hire_unbooked"), "schedule_orientation_session", { sessionId: await openSession() });
    expect(r.structuredContent).toMatchObject({ status: "approval_required" });
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets")).toBe(tickets);
    expect(await scalar("SELECT COUNT(*) AS n FROM orientation_bookings")).toBe(bookings);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_proposed' AND target = ?1", t.actionId)).toBe(1);
  });
});

describe("approve", () => {
  it("executes once for the requester, with one ticket and one action_executed audit row", async () => {
    const t = await proposeTicket(spare(1));
    const out = await approveJson(spare(1), t.actionId);
    expect(out).toMatchObject({ status: "executed", replayed: false });
    const ticketId = String(out.status === "executed" ? out.result["ticketId"] : "");
    expect(ticketId).toMatch(/^TKT-\d{6}$/);
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1 AND id = ?2", t.actionId, ticketId)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_executed' AND target = ?1", t.actionId)).toBe(1);
    const row = await env.DB.prepare("SELECT requester_id, created_via, status FROM tickets WHERE id = ?1").bind(ticketId).first();
    expect(row).toMatchObject({ requester_id: spares[1]!.id, created_via: "form", status: "open" });
  });

  it("gives one execution under two concurrent approves (the other replays or gets 409)", async () => {
    const t = await proposeTicket(spare(2));
    const [a, b] = await Promise.all([approve(spare(2), t.actionId), approve(spare(2), t.actionId)]);
    const bodies = [await a.json(), await b.json()] as Array<{ status?: string; replayed?: boolean }>;
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);
    expect(bodies.filter((x) => x.status === "executed" && x.replayed === false)).toHaveLength(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", t.actionId)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_executed' AND target = ?1", t.actionId)).toBe(1);
  });

  it("replays the stored outcome on a retried approve", async () => {
    const t = await proposeTicket(spare(3));
    const first = await approveJson(spare(3), t.actionId);
    const second = await approveJson(spare(3), t.actionId);
    expect(second).toEqual({ ...first, replayed: true });
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", t.actionId)).toBe(1);
  });

  it("answers 404 to anyone but the requester", async () => {
    const t = await proposeTicket(spare(4));
    await expectError(await approve("hr_admin", t.actionId), 404, "not_found");
    await expectError(await approve(spare(5), t.actionId), 404, "not_found");
    await expectError(await approve(spare(4), crypto.randomUUID()), 404, "not_found");
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", t.actionId)).toBe(0);
  });

  it("answers 410 for an expired action and records it as expired", async () => {
    const t = await proposeTicket(spare(5));
    await env.DB.prepare("UPDATE pending_actions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1").bind(t.actionId).run();
    await expectError(await approve(spare(5), t.actionId), 410, "expired");
    expect(await scalar("SELECT COUNT(*) AS n FROM pending_actions WHERE id = ?1 AND status = 'expired'", t.actionId)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", t.actionId)).toBe(0);
  });

  it("rejects, after which approve is 409 not_pending", async () => {
    const t = await proposeTicket(spare(6));
    expect(await (await reject(spare(6), t.actionId)).json()).toEqual({ status: "rejected" });
    await expectError(await approve(spare(6), t.actionId), 409, "not_pending");
    await expectError(await reject(spare(6), t.actionId), 409, "not_pending");
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_rejected' AND target = ?1", t.actionId)).toBe(1);
  });

  it("refuses a tampered arguments_json (digest mismatch) with 409 and writes nothing", async () => {
    const t = await proposeTicket(spare(7));
    await env.DB.prepare("UPDATE pending_actions SET arguments_json = ?2 WHERE id = ?1")
      .bind(t.actionId, JSON.stringify({ ...ticketArgs(), subject: "Give me admin rights" }))
      .run();
    await expectError(await approve(spare(7), t.actionId), 409, "conflict");
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", t.actionId)).toBe(0);
  });

  it("re-authorizes at approval time: a downgraded role yields failed with forbidden", async () => {
    const mgr = persona("manager_with_new_hires");
    const report = reportsOf(mgr.employeeId).find((e) => planned.has(e.id) && !booked.has(e.id))!;
    const proposal = await proposeBooking(mgr.key, await openSession(), report.id);
    await env.DB.prepare("UPDATE employees SET role = 'employee' WHERE id = ?1").bind(mgr.employeeId).run();
    try {
      expect(await approveJson(mgr.key, proposal.actionId)).toEqual({ status: "failed", errorCode: "forbidden", replayed: false });
      expect(await scalar("SELECT COUNT(*) AS n FROM orientation_bookings WHERE employee_id = ?1", report.id)).toBe(0);
      expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_failed' AND target = ?1", proposal.actionId)).toBe(1);
    } finally {
      await env.DB.prepare("UPDATE employees SET role = 'manager' WHERE id = ?1").bind(mgr.employeeId).run();
    }
  });

  it("finalizes a full session as failed session_full with an action_failed audit row, never action_executed", async () => {
    const hire = unbookedHires[0]!;
    const session = await openSession(2);
    const proposal = await proposeBooking(emailOf(hire), session);
    // Fill the session after the proposal: shrink capacity to the current bookings plus one, then take
    // the last seat with someone else.
    const taken = await scalar("SELECT COUNT(*) AS n FROM orientation_bookings WHERE session_id = ?1", session);
    await env.DB.prepare("UPDATE orientation_sessions SET capacity = ?2 WHERE id = ?1").bind(session, taken + 1).run();
    await env.DB.prepare(
      "INSERT INTO orientation_bookings (id, session_id, employee_id, booked_by, action_id, created_at) VALUES ('BKG-fill', ?1, ?2, ?2, NULL, '2026-10-01T00:00:00Z')",
    )
      .bind(session, unbookedHires[1])
      .run();
    expect(await approveJson(emailOf(hire), proposal.actionId)).toEqual({ status: "failed", errorCode: "session_full", replayed: false });
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_failed' AND target = ?1", proposal.actionId)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_executed' AND target = ?1", proposal.actionId)).toBe(0);
    expect(await scalar("SELECT COUNT(*) AS n FROM orientation_bookings WHERE employee_id = ?1", hire)).toBe(0);
  });

  it("finalizes a second booking for the same employee as already_booked", async () => {
    const hire = unbookedHires[2]!;
    const s1 = await openSession(2);
    const { results } = await env.DB.prepare(
      `SELECT s.id FROM orientation_sessions s WHERE s.id != ?1
          AND s.capacity - (SELECT COUNT(*) FROM orientation_bookings b WHERE b.session_id = s.id) >= 2 ORDER BY s.id DESC`,
    )
      .bind(s1)
      .all<{ id: string }>();
    const first = await proposeBooking("hr_admin", s1, hire);
    const second = await proposeBooking("hr_admin", results[0]!.id, hire);
    expect((await approveJson("hr_admin", first.actionId)).status).toBe("executed");
    expect(await approveJson("hr_admin", second.actionId)).toEqual({ status: "failed", errorCode: "already_booked", replayed: false });
    expect(await scalar("SELECT COUNT(*) AS n FROM orientation_bookings WHERE employee_id = ?1", hire)).toBe(1);
  });

  it("books through the single batch and records the booking id", async () => {
    const hire = unbookedHires[3]!;
    const session = await openSession(2);
    const proposal = await proposeBooking(emailOf(hire), session);
    const out = await approveJson(emailOf(hire), proposal.actionId);
    expect(out).toEqual({
      status: "executed",
      result: { bookingId: `BKG-${proposal.actionId}`, sessionId: session },
      replayed: false,
    });
    expect(await scalar("SELECT COUNT(*) AS n FROM pending_actions WHERE status = 'executing'")).toBe(0);
  });
});

describe("rate limit", () => {
  it("lets exactly 5 of 7 concurrent proposals through and rate-limits the other 2", async () => {
    const who = spare(8);
    const responses = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        api("/api/actions", { as: who, body: { tool: "create_support_ticket", arguments: ticketArgs(i) } }),
      ),
    );
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429]);
    expect(await scalar("SELECT COUNT(*) AS n FROM pending_actions WHERE requester_id = ?1", spares[8]!.id)).toBe(5);
  });

  it("does not count expired rows toward the limit", async () => {
    const who = spare(9);
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await proposeTicket(who, ticketArgs(i)));
    await expectError(
      await api("/api/actions", { as: who, body: { tool: "create_support_ticket", arguments: ticketArgs(9) } }),
      429,
      "rate_limited",
    );
    await env.DB.prepare("UPDATE pending_actions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id IN (?1, ?2)")
      .bind(made[0]!.actionId, made[1]!.actionId)
      .run();
    await proposeTicket(who, ticketArgs(10));
    const list = await expectJson(await api("/api/actions", { as: who }), ActionListSchema);
    expect(list.actions.filter((a) => a.status === "expired")).toHaveLength(2);
    expect(list.actions.filter((a) => a.status === "awaiting_approval")).toHaveLength(4);
  });
});

describe("editing (supersedes)", () => {
  it("replaces an awaiting request: the old one is rejected and points at the new one", async () => {
    const who = spare(12);
    const old = await proposeTicket(who, ticketArgs(1));
    const next = await expectJson(
      await api("/api/actions", { as: who, body: { tool: "create_support_ticket", arguments: ticketArgs(2), supersedes: old.actionId } }),
      PendingActionViewSchema,
      201,
    );
    const list = await expectJson(await api("/api/actions", { as: who }), ActionListSchema);
    expect(list.actions.find((a) => a.actionId === old.actionId)).toMatchObject({ status: "rejected", supersededBy: next.actionId });
    expect(list.actions.find((a) => a.actionId === next.actionId)?.status).toBe("awaiting_approval");
    await expectError(await approve(who, old.actionId), 409, "not_pending");
  });

  it("does not count the request being replaced toward the limit of 5", async () => {
    const who = spare(13);
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await proposeTicket(who, ticketArgs(i)));
    const replaced = made[2]!;
    const next = await expectJson(
      await api("/api/actions", { as: who, body: { tool: "create_support_ticket", arguments: ticketArgs(7), supersedes: replaced.actionId } }),
      PendingActionViewSchema,
      201,
    );
    const list = await expectJson(await api("/api/actions", { as: who }), ActionListSchema);
    expect(list.actions.find((a) => a.actionId === replaced.actionId)).toMatchObject({ status: "rejected", supersededBy: next.actionId });
    expect(list.actions.filter((a) => a.status === "awaiting_approval")).toHaveLength(5);
  });
});

describe("listing", () => {
  it("lists only the caller's actions", async () => {
    const t = await proposeTicket(spare(10));
    const mine = await expectJson(await api("/api/actions", { as: spare(10) }), ActionListSchema);
    expect(mine.actions.map((a) => a.actionId)).toEqual([t.actionId]);
    const theirs = await expectJson(await api("/api/actions", { as: spare(11) }), ActionListSchema);
    expect(theirs.actions.some((a) => a.actionId === t.actionId)).toBe(false);
    PendingActionViewSchema.parse(mine.actions[0]);
  });
});
