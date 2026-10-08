import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ARCHETYPES, fillTemplate } from "../../src/shared/synth/archetypes.ts";
import { manifest, org, persona, planned, reportsOf } from "../helpers/fixtures.ts";
import { call, errorCode, mcpClient } from "../helpers/mcp.ts";

const mgr = persona("manager_with_new_hires");
const report = reportsOf(mgr.employeeId).find((e) => planned.has(e.id))!;
const nonReport = org.onboardingPlans.find((p) => !reportsOf(mgr.employeeId).some((e) => e.id === p.employeeId))!.employeeId;

async function deniedRows(actorId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_id = ?1 AND event = 'authz_denied'")
    .bind(actorId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("get_onboarding_progress authorization", () => {
  it("allows self", async () => {
    const p = persona("new_hire_unbooked");
    const r = await call(await mcpClient(p.key), "get_onboarding_progress", {});
    expect(r.structuredContent?.["employeeId"]).toBe(p.employeeId);
  });

  it("forbids an employee reading someone else, and audits the denial", async () => {
    const p = persona("new_hire_booked");
    const before = await deniedRows(p.employeeId);
    const r = await call(await mcpClient(p.key), "get_onboarding_progress", { employeeId: report.id });
    expect(r.isError).toBe(true);
    expect(errorCode(r)).toBe("forbidden");
    expect(await deniedRows(p.employeeId)).toBe(before + 1);
  });

  it("allows a manager for a direct report and forbids a non-report", async () => {
    const client = await mcpClient(mgr.key);
    expect((await call(client, "get_onboarding_progress", { employeeId: report.id })).structuredContent?.["employeeId"]).toBe(report.id);
    const before = await deniedRows(mgr.employeeId);
    const denied = await call(client, "get_onboarding_progress", { employeeId: nonReport });
    expect(errorCode(denied)).toBe("forbidden");
    expect(await deniedRows(mgr.employeeId)).toBe(before + 1);
  });

  it("allows hr_admin for anyone with a plan; no plan is not_found", async () => {
    const client = await mcpClient("hr_admin");
    expect((await call(client, "get_onboarding_progress", { employeeId: nonReport })).structuredContent?.["employeeId"]).toBe(nonReport);
    expect(errorCode(await call(client, "get_onboarding_progress", { employeeId: persona("tenured_employee").employeeId }))).toBe(
      "not_found",
    );
  });

  it("answers forbidden, not not_found, for a nonexistent id unless the caller is HR", async () => {
    expect(errorCode(await call(await mcpClient("tenured_employee"), "get_onboarding_progress", { employeeId: "E9999" }))).toBe("forbidden");
    expect(errorCode(await call(await mcpClient("hr_admin"), "get_onboarding_progress", { employeeId: "E9999" }))).toBe("not_found");
  });
});

describe("list_my_tickets scoping", () => {
  it("returns only the caller's ticket ids", async () => {
    for (const key of ["tenured_employee", "manager_no_new_hires", "hr_admin"] as const) {
      const p = persona(key);
      const r = await call(await mcpClient(key), "list_my_tickets", { limit: 50 });
      const ids = (r.structuredContent?.["tickets"] as Array<{ id: string }>).map((t) => t.id).sort();
      expect(ids).toEqual(org.tickets.filter((t) => t.requesterId === p.employeeId).map((t) => t.id).sort());
    }
  });
});

describe("search_policies scoping", () => {
  it("never returns passages above the caller's clearance, even when asked for restricted facts", async () => {
    const client = await mcpClient("tenured_employee");
    const rank = new Map(manifest.documents.map((d) => [d.docId, d.rank]));
    for (const d of manifest.documents.filter((x) => x.rank > 1)) {
      const f = d.versions.find((v) => v.status === "current")!.facts[0]!;
      const r = await call(client, "search_policies", { query: fillTemplate(ARCHETYPES[f.archetype].questions[0], { subject: f.subject }) });
      for (const p of r.structuredContent?.["passages"] as Array<{ docId: string }>) expect(rank.get(p.docId), p.docId).toBe(1);
    }
  });

  it("returns cited-ready passages with effective dates for permitted questions", async () => {
    const r = await call(await mcpClient("hr_admin"), "search_policies", { query: "paid time off accrue", topK: 3 });
    const passages = r.structuredContent?.["passages"] as Array<Record<string, unknown>>;
    expect(passages).toHaveLength(3);
    expect(passages[0]).toMatchObject({ docId: "POL-001", section: "Policy" });
    expect(passages[0]?.["effectiveFrom"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.structuredContent?.["asOf"]).toBe("2026-10-01");
  });
});

describe("schedule_orientation_session authorization", () => {
  const unbookedReport = reportsOf(mgr.employeeId).find((e) => planned.has(e.id) && !org.bookings.some((b) => b.employeeId === e.id))!;
  const session = "ORI-010";

  it("lets a new hire propose for self and refuses another employee", async () => {
    const p = persona("new_hire_unbooked");
    const client = await mcpClient(p.key);
    expect((await call(client, "schedule_orientation_session", { sessionId: session })).structuredContent).toMatchObject({
      status: "approval_required",
    });
    const before = await deniedRows(p.employeeId);
    expect(errorCode(await call(client, "schedule_orientation_session", { sessionId: session, employeeId: unbookedReport.id }))).toBe(
      "forbidden",
    );
    expect(await deniedRows(p.employeeId)).toBe(before + 1);
  });

  it("refuses self-scheduling outside onboarding, and an already booked hire", async () => {
    expect(errorCode(await call(await mcpClient("tenured_employee"), "schedule_orientation_session", { sessionId: session }))).toBe(
      "not_in_onboarding",
    );
    expect(errorCode(await call(await mcpClient("new_hire_booked"), "schedule_orientation_session", { sessionId: session }))).toBe(
      "already_booked",
    );
  });

  it("lets a manager propose for an unbooked report in onboarding and refuses a non-report", async () => {
    const client = await mcpClient(mgr.key);
    expect(
      (await call(client, "schedule_orientation_session", { sessionId: session, employeeId: unbookedReport.id })).structuredContent,
    ).toMatchObject({ status: "approval_required" });
    expect(errorCode(await call(client, "schedule_orientation_session", { sessionId: session, employeeId: nonReport }))).toBe("forbidden");
  });

  it("lets hr_admin propose for anyone in onboarding, but not for someone outside onboarding", async () => {
    const client = await mcpClient("hr_admin");
    const unbookedStranger = org.onboardingPlans.find(
      (p) => !org.bookings.some((b) => b.employeeId === p.employeeId) && p.employeeId !== persona("new_hire_unbooked").employeeId,
    )!.employeeId;
    expect(
      (await call(client, "schedule_orientation_session", { sessionId: "ORI-011", employeeId: unbookedStranger })).structuredContent,
    ).toMatchObject({ status: "approval_required" });
    expect(
      errorCode(await call(client, "schedule_orientation_session", { sessionId: "ORI-011", employeeId: persona("tenured_employee").employeeId })),
    ).toBe("not_in_onboarding");
  });

  it("refuses full sessions and unknown sessions at proposal time", async () => {
    const full = org.sessions.find((s) => s.capacity === 6)!.id;
    const client = await mcpClient("hr_admin");
    const target = unbookedReport.id;
    expect(errorCode(await call(client, "schedule_orientation_session", { sessionId: full, employeeId: target }))).toBe("session_full");
    expect(errorCode(await call(client, "schedule_orientation_session", { sessionId: "ORI-999", employeeId: target }))).toBe("not_found");
  });
});
