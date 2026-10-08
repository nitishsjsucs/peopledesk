// Every cell of the capability table in SPEC section 9, for both identity kinds.
import { describe, expect, it } from "vitest";
import type { IdentityKind, Role } from "../../src/shared/domain.ts";
import { can } from "../../src/worker/authz/policy.ts";
import type { AuthzPrincipal, PersonResource } from "../../src/worker/authz/policy.ts";

const ROLES: Role[] = ["employee", "manager", "hr_admin"];
const KINDS: IdentityKind[] = ["user", "service_token"];
const ME = "E0100";
const REPORT = "E0101";
const OTHER = "E0102";

type Target = "self" | "report" | "other";
const person = (who: Target, inOnboarding: boolean): PersonResource => ({
  employeeId: who === "self" ? ME : who === "report" ? REPORT : OTHER,
  managerId: who === "report" ? ME : who === "self" ? "E0001" : "E0002",
  inOnboarding,
});

// Expected values straight from the table.
const CLEARANCE: Record<Role, number> = { employee: 1, manager: 2, hr_admin: 3 };
const ONBOARDING_READ: Record<Role, Record<Target, boolean>> = {
  employee: { self: true, report: false, other: false },
  manager: { self: true, report: true, other: false },
  hr_admin: { self: true, report: true, other: true },
};
const SCHEDULE: Record<Role, Record<Target, boolean>> = {
  employee: { self: true, report: false, other: false },
  manager: { self: true, report: true, other: false },
  hr_admin: { self: true, report: true, other: true },
};

describe.each(ROLES)("role %s", (role) => {
  describe.each(KINDS)("identity %s", (identityKind) => {
    const p: AuthzPrincipal = { employeeId: ME, role, identityKind };

    it("reads policies up to its clearance only", () => {
      for (const rank of [1, 2, 3] as const) {
        expect(can(p, { name: "policy.read", resource: { audienceRank: rank } }).allowed).toBe(rank <= CLEARANCE[role]);
      }
    });

    it("lists its own tickets and the orientation sessions", () => {
      expect(can(p, { name: "tickets.list_own" }).allowed).toBe(true);
      expect(can(p, { name: "sessions.list" }).allowed).toBe(true);
    });

    it("creates tickets only as itself", () => {
      expect(can(p, { name: "tickets.create", resource: { requesterId: ME } }).allowed).toBe(true);
      expect(can(p, { name: "tickets.create", resource: { requesterId: OTHER } })).toEqual({ allowed: false, reason: "not_self" });
    });

    it.each<Target>(["self", "report", "other"])("reads onboarding progress for %s per the table", (target) => {
      expect(can(p, { name: "onboarding.read", resource: person(target, true) }).allowed).toBe(ONBOARDING_READ[role][target]);
    });

    it.each<Target>(["self", "report", "other"])("schedules orientation for %s only when in onboarding", (target) => {
      expect(can(p, { name: "orientation.schedule", resource: person(target, true) }).allowed).toBe(SCHEDULE[role][target]);
      const notOnboarding = can(p, { name: "orientation.schedule", resource: person(target, false) });
      expect(notOnboarding.allowed).toBe(false);
      if (SCHEDULE[role][target]) expect(notOnboarding).toEqual({ allowed: false, reason: "not_in_onboarding" });
    });

    it("approves only its own actions, and only as a user identity", () => {
      const own = can(p, { name: "action.approve", resource: { requesterId: ME } });
      expect(own.allowed).toBe(identityKind === "user");
      if (identityKind === "service_token") expect(own).toEqual({ allowed: false, reason: "human_approval_required" });
      expect(can(p, { name: "action.approve", resource: { requesterId: OTHER } })).toEqual({
        allowed: false,
        reason: "not_requester",
      });
    });

    it("rejects only its own actions, with either identity kind", () => {
      expect(can(p, { name: "action.reject", resource: { requesterId: ME } }).allowed).toBe(true);
      expect(can(p, { name: "action.reject", resource: { requesterId: OTHER } }).allowed).toBe(false);
    });
  });
});

describe("deny reasons", () => {
  it("distinguishes a manager's non-report from an employee's other person", () => {
    const manager: AuthzPrincipal = { employeeId: ME, role: "manager", identityKind: "user" };
    const employee: AuthzPrincipal = { employeeId: ME, role: "employee", identityKind: "user" };
    expect(can(manager, { name: "onboarding.read", resource: person("other", true) })).toEqual({ allowed: false, reason: "not_report" });
    expect(can(employee, { name: "onboarding.read", resource: person("report", true) })).toEqual({ allowed: false, reason: "not_self" });
    expect(can(employee, { name: "policy.read", resource: { audienceRank: 2 } })).toEqual({ allowed: false, reason: "clearance" });
  });
});
