// Builds ActionService directly with a constructor-only afterCommit hook that throws, simulating a
// crash right after the approval batch commits. No HTTP path can set the hook.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ActionService } from "../../src/worker/services/actions.ts";
import { approveJson, scalar, ticketArgs } from "../helpers/actions.ts";
import { booked, org, persona, planned, spareEmployees } from "../helpers/fixtures.ts";
import { principalFor, testServices } from "../helpers/services.ts";

describe("crash after commit", () => {
  it("leaves a fully consistent executed row, one ticket and one audit row, and replays on retry", async () => {
    const s = testServices();
    const crashing = new ActionService({
      db: env.DB,
      clock: s.clock,
      audit: s.audit,
      employees: s.employees,
      onboarding: s.onboarding,
      orientation: s.orientation,
      ttlSeconds: 900,
      hooks: {
        afterCommit: () => {
          throw new Error("simulated crash after commit");
        },
      },
    });
    const who = spareEmployees(1, (e) => !planned.has(e.id))[0]!;
    const principal = await principalFor(who.email);
    const { view } = await crashing.propose(principal, "create_support_ticket", ticketArgs(), "chat", {
      approvalOrigin: "http://localhost",
    });

    await expect(crashing.approve(principal, view.actionId)).rejects.toThrow("simulated crash after commit");

    const row = await env.DB.prepare("SELECT status, result_json, error_code FROM pending_actions WHERE id = ?1")
      .bind(view.actionId)
      .first<{ status: string; result_json: string | null; error_code: string | null }>();
    expect(row?.status).toBe("executed");
    expect(row?.error_code).toBeNull();
    const ticketId = (JSON.parse(row?.result_json ?? "{}") as { ticketId?: string }).ticketId;
    expect(ticketId).toMatch(/^TKT-\d{6}$/);
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", view.actionId)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_executed' AND target = ?1", view.actionId)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM pending_actions WHERE status = 'executing'")).toBe(0);

    const replay = await approveJson(who.email, view.actionId);
    expect(replay).toEqual({ status: "executed", result: { ticketId }, replayed: true });
    expect(await scalar("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1", view.actionId)).toBe(1);
  });

  it("reconciles a row observed in executing outside a transaction", async () => {
    const s = testServices();
    const who = spareEmployees(2, (e) => !planned.has(e.id))[1]!;
    const principal = await principalFor(who.email);
    const { view } = await s.actions.propose(principal, "create_support_ticket", ticketArgs(1), "form", { approvalOrigin: "http://localhost" });
    // Simulate an impossible half state: claimed, nothing written.
    await env.DB.prepare("UPDATE pending_actions SET status = 'executing', claim_id = 'x', decided_by = ?2 WHERE id = ?1")
      .bind(view.actionId, principal.employeeId)
      .run();
    expect(await s.actions.approve(principal, view.actionId)).toEqual({ status: "failed", errorCode: "stale_execution", replayed: true });
    expect(
      await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_failed' AND target = ?1 AND detail_json LIKE '%reconciled%'", view.actionId),
    ).toBe(1);
  });

  it("reconciles an executing row whose booking exists as executed, with the batch's result shape", async () => {
    const s = testServices();
    const hr = await principalFor("hr_admin");
    const hire = org.onboardingPlans.map((p) => p.employeeId).find((id) => !booked.has(id) && id !== persona("new_hire_unbooked").employeeId)!;
    const session = await env.DB.prepare(
      `SELECT s.id FROM orientation_sessions s
        WHERE s.capacity > (SELECT COUNT(*) FROM orientation_bookings b WHERE b.session_id = s.id) ORDER BY s.id DESC`,
    ).first<{ id: string }>();
    const { view } = await s.actions.propose(hr, "schedule_orientation_session", { sessionId: session!.id, employeeId: hire }, "form", {
      approvalOrigin: "http://localhost",
    });
    // Simulate an impossible half state: claimed, and the booking written, but never finalized.
    const bookingId = `BKG-${view.actionId}`;
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO orientation_bookings (id, session_id, employee_id, booked_by, action_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      ).bind(bookingId, session!.id, hire, hr.employeeId, view.actionId, "2026-10-01T09:00:00.000Z"),
      env.DB.prepare("UPDATE pending_actions SET status = 'executing', claim_id = 'x', decided_by = ?2 WHERE id = ?1").bind(
        view.actionId,
        hr.employeeId,
      ),
    ]);

    expect(await s.actions.approve(hr, view.actionId)).toEqual({
      status: "executed",
      result: { bookingId, sessionId: session!.id },
      replayed: true,
    });
    expect(await scalar("SELECT COUNT(*) AS n FROM orientation_bookings WHERE action_id = ?1", view.actionId)).toBe(1);
    expect(
      await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_executed' AND target = ?1 AND detail_json LIKE '%reconciled%'", view.actionId),
    ).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_failed' AND target = ?1", view.actionId)).toBe(0);
    // A second approve replays the stored outcome and writes nothing more.
    expect(await approveJson(persona("hr_admin").email, view.actionId)).toEqual({
      status: "executed",
      result: { bookingId, sessionId: session!.id },
      replayed: true,
    });
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_executed' AND target = ?1", view.actionId)).toBe(1);
  });

  it("reconciles an executing row whose ticket exists as executed", async () => {
    const s = testServices();
    const who = spareEmployees(3, (e) => !planned.has(e.id))[2]!;
    const principal = await principalFor(who.email);
    const { view } = await s.actions.propose(principal, "create_support_ticket", ticketArgs(2), "form", { approvalOrigin: "http://localhost" });
    const ticketId = "TKT-990001";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tickets (id, requester_id, category, subject, description, priority, status, related_policy_id, created_via,
                              action_id, created_at, updated_at)
         VALUES (?1, ?2, 'it', 'Laptop will not boot 2', 'My laptop shows a black screen.', 'normal', 'open', NULL, 'form', ?3, ?4, ?4)`,
      ).bind(ticketId, who.id, view.actionId, "2026-10-01T09:00:00.000Z"),
      env.DB.prepare("UPDATE pending_actions SET status = 'executing', claim_id = 'x', decided_by = ?2 WHERE id = ?1").bind(
        view.actionId,
        principal.employeeId,
      ),
    ]);

    expect(await s.actions.approve(principal, view.actionId)).toEqual({ status: "executed", result: { ticketId }, replayed: true });
    expect(
      await scalar("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'action_executed' AND target = ?1 AND detail_json LIKE '%reconciled%'", view.actionId),
    ).toBe(1);
  });
});
