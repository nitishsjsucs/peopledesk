// Builds ActionService directly with a constructor-only afterCommit hook that throws, simulating a
// crash right after the approval batch commits. No HTTP path can set the hook.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ActionService } from "../../src/worker/services/actions.ts";
import { approveJson, scalar, ticketArgs } from "../helpers/actions.ts";
import { planned, spareEmployees } from "../helpers/fixtures.ts";
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
});
