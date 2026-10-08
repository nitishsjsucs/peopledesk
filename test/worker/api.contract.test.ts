// Every route's response validates against its shared zod schema, and errors use one envelope.
import { describe, expect, it } from "vitest";
import {
  HealthSchema,
  MeSchema,
  OnboardingProgressSchema,
  SessionListSchema,
  TeamSchema,
  TicketListSchema,
} from "../../src/shared/api-types.ts";
import { org, persona, planned, reportsOf } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";

describe("read routes", () => {
  it("GET /api/health and /api/me", async () => {
    await expectJson(await api("/api/health", { as: "hr_admin" }), HealthSchema);
    const me = await expectJson(await api("/api/me", { as: "manager_with_new_hires" }), MeSchema);
    expect(me.directReportIds).toEqual(reportsOf(me.employeeId).map((e) => e.id));
    expect((await expectJson(await api("/api/me", { as: "new_hire_unbooked" }), MeSchema)).inOnboarding).toBe(true);
  });

  it("GET /api/tickets returns only the caller's tickets, newest first", async () => {
    const p = persona("tenured_employee");
    const body = await expectJson(await api("/api/tickets", { as: p.key }), TicketListSchema);
    const expected = org.tickets.filter((t) => t.requesterId === p.employeeId);
    expect(body.tickets.map((t) => t.id).sort()).toEqual(expected.map((t) => t.id).sort());
    expect(body.tickets.every((t) => t.requesterId === p.employeeId)).toBe(true);
    const sorted = [...body.tickets].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    expect(body.tickets.map((t) => t.id)).toEqual(sorted.map((t) => t.id));
    const open = await expectJson(await api("/api/tickets?status=open", { as: p.key }), TicketListSchema);
    expect(open.tickets.every((t) => t.status === "open")).toBe(true);
    await expectError(await api("/api/tickets?status=lost", { as: p.key }), 400, "validation_error");
  });

  it("GET /api/onboarding for self, and 404 without a plan", async () => {
    const p = persona("new_hire_unbooked");
    const body = await expectJson(await api("/api/onboarding", { as: p.key }), OnboardingProgressSchema);
    expect(body.employeeId).toBe(p.employeeId);
    expect(body.tasks).toHaveLength(12);
    expect(body.counts.done + body.counts.inProgress + body.counts.pending + body.counts.blocked).toBe(12);
    expect(body.percentComplete).toBe(Math.round((body.counts.done / 12) * 100));
    await expectError(await api("/api/onboarding", { as: "tenured_employee" }), 404, "not_found");
  });

  it("GET /api/onboarding/:employeeId for self, manager of, and hr_admin; 404 otherwise", async () => {
    const mgr = persona("manager_with_new_hires");
    const report = reportsOf(mgr.employeeId).find((e) => planned.has(e.id))!;
    const stranger = org.onboardingPlans.find((p) => !reportsOf(mgr.employeeId).some((e) => e.id === p.employeeId))!;
    await expectJson(await api(`/api/onboarding/${report.id}`, { as: mgr.key }), OnboardingProgressSchema);
    await expectJson(await api(`/api/onboarding/${stranger.employeeId}`, { as: "hr_admin" }), OnboardingProgressSchema);
    const self = persona("new_hire_booked");
    await expectJson(await api(`/api/onboarding/${self.employeeId}`, { as: self.key }), OnboardingProgressSchema);
    await expectError(await api(`/api/onboarding/${stranger.employeeId}`, { as: mgr.key }), 404, "not_found");
    await expectError(await api(`/api/onboarding/${report.id}`, { as: "tenured_employee" }), 404, "not_found");
    await expectError(await api("/api/onboarding/E9999", { as: "hr_admin" }), 404, "not_found");
  });

  it("GET /api/team returns the directory slice", async () => {
    const mgr = persona("manager_with_new_hires");
    const team = await expectJson(await api("/api/team", { as: mgr.key }), TeamSchema);
    expect(team.members.map((m) => m.employeeId)).toEqual(reportsOf(mgr.employeeId).map((e) => e.id));
    expect(team.members.filter((m) => m.inOnboarding)).toHaveLength(5);
    const hr = await expectJson(await api("/api/team", { as: "hr_admin" }), TeamSchema);
    expect(hr.members).toHaveLength(30);
    expect(hr.members.filter((m) => !m.booked)).toHaveLength(12);
    await expectError(await api("/api/team", { as: "tenured_employee" }), 403, "forbidden");
  });

  it("GET /api/orientation-sessions reports seats remaining", async () => {
    const all = await expectJson(await api("/api/orientation-sessions?to=2026-12-31", { as: "new_hire_unbooked" }), SessionListSchema);
    expect(all.sessions).toHaveLength(24);
    expect(all.sessions.filter((s) => s.seatsRemaining === 0)).toHaveLength(2);
    expect(all.sessions.reduce((n, s) => n + (s.capacity - s.seatsRemaining), 0)).toBe(18);
    const def = await expectJson(await api("/api/orientation-sessions", { as: "new_hire_unbooked" }), SessionListSchema);
    expect(def.sessions.every((s) => s.startsAt.slice(0, 10) <= "2026-11-30")).toBe(true);
    const virtual = await expectJson(await api("/api/orientation-sessions?format=virtual&to=2026-12-31", { as: "hr_admin" }), SessionListSchema);
    expect(virtual.sessions.every((s) => s.format === "virtual")).toBe(true);
    await expectError(await api("/api/orientation-sessions?from=yesterday", { as: "hr_admin" }), 400, "validation_error");
  });
});

describe("error envelope", () => {
  it("uses one shape for 401, 403, 404 and unknown routes", async () => {
    await expectError(await api("/api/me"), 401, "unauthenticated");
    await expectError(await api("/api/team", { as: "tenured_employee" }), 403, "forbidden");
    await expectError(await api("/api/nope", { as: "tenured_employee" }), 404, "not_found");
  });
});
