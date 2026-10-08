import { describe, expect, it } from "vitest";
import { EXPECTED_COUNTS } from "../../src/shared/synth/counts.ts";
import { generateOrg } from "../../src/shared/synth/org.ts";

const AS_OF = "2026-10-01";
const org = generateOrg(AS_OF);
const count = <T>(items: T[], key: (t: T) => string) =>
  items.reduce<Record<string, number>>((acc, t) => {
    acc[key(t)] = (acc[key(t)] ?? 0) + 1;
    return acc;
  }, {});

describe("synthetic org", () => {
  it("has 120 employees with the exact role, region and department splits", () => {
    expect(org.employees).toHaveLength(EXPECTED_COUNTS.employees);
    expect(count(org.employees, (e) => e.role)).toEqual(EXPECTED_COUNTS.roles);
    expect(count(org.employees, (e) => e.region)).toEqual(EXPECTED_COUNTS.regions);
    expect(new Set(org.employees.map((e) => e.department)).size).toBe(EXPECTED_COUNTS.departments);
  });

  it("has unique ids, emails and full names on the reserved .test TLD", () => {
    expect(new Set(org.employees.map((e) => e.id)).size).toBe(120);
    expect(new Set(org.employees.map((e) => e.email)).size).toBe(120);
    expect(new Set(org.employees.map((e) => e.fullName)).size).toBe(120);
    for (const e of org.employees) {
      expect(e.id).toMatch(/^E\d{4}$/);
      expect(e.email).toMatch(/^[a-z]+\.[a-z]+@peopledesk\.test$/);
    }
  });

  it("has a valid manager hierarchy where managers precede their reports", () => {
    const index = new Map(org.employees.map((e, i) => [e.id, i]));
    const byId = new Map(org.employees.map((e) => [e.id, e]));
    for (const e of org.employees) {
      if (e.managerId === null) {
        expect(e.role).toBe("manager");
        continue;
      }
      const m = byId.get(e.managerId);
      expect(m?.role).toBe("manager");
      expect(index.get(e.managerId)).toBeLessThan(index.get(e.id) as number);
    }
  });

  it("has 30 onboarding plans with 12 tasks each and start dates in the window", () => {
    expect(org.onboardingPlans).toHaveLength(EXPECTED_COUNTS.onboardingPlans);
    expect(org.onboardingTasks).toHaveLength(EXPECTED_COUNTS.onboardingTasks);
    for (const p of org.onboardingPlans) {
      expect(p.startDate >= "2026-07-18" && p.startDate <= "2026-10-21").toBe(true);
      expect(org.onboardingTasks.filter((t) => t.employeeId === p.employeeId)).toHaveLength(12);
    }
    expect(new Set(org.onboardingTasks.map((t) => t.id)).size).toBe(360);
    for (const t of org.onboardingTasks) expect(t.status === "done").toBe(t.completedAt !== null);
  });

  it("has 24 sessions, 3 per week from AS_OF+14 to AS_OF+67, with 18 bookings and 2 exactly full sessions", () => {
    expect(org.sessions).toHaveLength(EXPECTED_COUNTS.orientationSessions);
    const dates = org.sessions.map((s) => s.startsAt.slice(0, 10)).sort();
    expect(dates[0]).toBe("2026-10-15");
    expect(dates[dates.length - 1]).toBe("2026-12-07");
    for (const s of org.sessions) {
      expect(s.capacity).toBeGreaterThanOrEqual(6);
      expect(s.capacity).toBeLessThanOrEqual(20);
    }
    expect(org.bookings).toHaveLength(EXPECTED_COUNTS.seededBookings);
    const perSession = count(org.bookings, (b) => b.sessionId);
    const full = org.sessions.filter((s) => (perSession[s.id] ?? 0) >= s.capacity);
    expect(full).toHaveLength(EXPECTED_COUNTS.fullSessions);
    for (const s of full) expect(s.capacity).toBe(6);
    const planned = new Set(org.onboardingPlans.map((p) => p.employeeId));
    for (const b of org.bookings) expect(planned.has(b.employeeId)).toBe(true);
    expect(new Set(org.bookings.map((b) => b.employeeId)).size).toBe(18);
    expect(org.onboardingPlans.filter((p) => !org.bookings.some((b) => b.employeeId === p.employeeId))).toHaveLength(
      EXPECTED_COUNTS.unbookedNewHires,
    );
  });

  it("has 150 tickets across 6 categories and 4 statuses with sequential ids", () => {
    expect(org.tickets).toHaveLength(EXPECTED_COUNTS.seededTickets);
    expect(org.tickets[0]?.id).toBe("TKT-000001");
    expect(org.tickets[149]?.id).toBe("TKT-000150");
    expect(Object.keys(count(org.tickets, (t) => t.category)).sort()).toEqual(
      ["access_request", "benefits", "facilities", "hr_general", "it", "payroll"],
    );
    expect(Object.keys(count(org.tickets, (t) => t.status)).sort()).toEqual(["closed", "in_progress", "open", "resolved"]);
    for (const t of org.tickets) expect(t.updatedAt >= t.createdAt).toBe(true);
  });

  it("has six personas that meet their definitions", () => {
    expect(org.personas).toHaveLength(EXPECTED_COUNTS.personas);
    const p = Object.fromEntries(org.personas.map((x) => [x.key, x]));
    const planned = new Set(org.onboardingPlans.map((x) => x.employeeId));
    const booked = new Set(org.bookings.map((b) => b.employeeId));
    const reports = (id: string) => org.employees.filter((e) => e.managerId === id);

    expect(p.new_hire_unbooked?.role).toBe("employee");
    expect(planned.has(p.new_hire_unbooked?.employeeId ?? "")).toBe(true);
    expect(booked.has(p.new_hire_unbooked?.employeeId ?? "")).toBe(false);

    expect(planned.has(p.new_hire_booked?.employeeId ?? "")).toBe(true);
    expect(booked.has(p.new_hire_booked?.employeeId ?? "")).toBe(true);

    expect(p.tenured_employee?.role).toBe("employee");
    expect(planned.has(p.tenured_employee?.employeeId ?? "")).toBe(false);

    const mgr = reports(p.manager_with_new_hires?.employeeId ?? "").filter((e) => planned.has(e.id));
    expect(p.manager_with_new_hires?.role).toBe("manager");
    expect(mgr.length).toBeGreaterThanOrEqual(3);
    expect(mgr.filter((e) => !booked.has(e.id)).length).toBeGreaterThanOrEqual(2);

    expect(p.manager_no_new_hires?.role).toBe("manager");
    expect(reports(p.manager_no_new_hires?.employeeId ?? "").length).toBeGreaterThan(0);
    expect(reports(p.manager_no_new_hires?.employeeId ?? "").filter((e) => planned.has(e.id))).toHaveLength(0);

    expect(p.hr_admin?.role).toBe("hr_admin");
    for (const persona of org.personas) {
      expect(org.tickets.filter((t) => t.requesterId === persona.employeeId).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps structure identical for other business dates", () => {
    for (const asOf of ["2027-03-15", "2028-01-31"]) {
      const other = generateOrg(asOf);
      expect(other.employees.map((e) => [e.id, e.fullName, e.role, e.managerId])).toEqual(
        org.employees.map((e) => [e.id, e.fullName, e.role, e.managerId]),
      );
      expect(other.personas.map((x) => x.employeeId)).toEqual(org.personas.map((x) => x.employeeId));
      expect(other.bookings.map((b) => [b.sessionId, b.employeeId])).toEqual(org.bookings.map((b) => [b.sessionId, b.employeeId]));
    }
  });
});
