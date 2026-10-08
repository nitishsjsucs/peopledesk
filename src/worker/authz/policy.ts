// can(principal, capability, resource): the capability table of SPEC section 9 as one pure function.
// The identity kind is part of the principal, so "a service token can never approve" is a row in
// the table-tested matrix, not a check buried in a route.
import type { Clearance, IdentityKind, Role } from "../../shared/domain.ts";
import { ROLE_CLEARANCE } from "../../shared/domain.ts";

export type AuthzPrincipal = { employeeId: string; role: Role; identityKind: IdentityKind; clearance?: Clearance };

/** The subject of a person-scoped capability: who it affects and who manages them. */
export type PersonResource = { employeeId: string; managerId: string | null; inOnboarding: boolean };

export type Capability =
  | { name: "policy.read"; resource: { audienceRank: Clearance } }
  | { name: "tickets.list_own" }
  | { name: "tickets.create"; resource: { requesterId: string } }
  | { name: "onboarding.read"; resource: PersonResource }
  | { name: "sessions.list" }
  | { name: "orientation.schedule"; resource: PersonResource }
  | { name: "action.approve"; resource: { requesterId: string } }
  | { name: "action.reject"; resource: { requesterId: string } };

export type DenyReason =
  | "clearance"
  | "not_self"
  | "not_report"
  | "not_in_onboarding"
  | "not_requester"
  | "human_approval_required";

export type Decision = { allowed: true } | { allowed: false; reason: DenyReason };

const ALLOW: Decision = { allowed: true };
const deny = (reason: DenyReason): Decision => ({ allowed: false, reason });

export function clearanceOf(p: AuthzPrincipal): Clearance {
  return p.clearance ?? ROLE_CLEARANCE[p.role];
}

export function can(p: AuthzPrincipal, cap: Capability): Decision {
  switch (cap.name) {
    case "policy.read":
      return cap.resource.audienceRank <= clearanceOf(p) ? ALLOW : deny("clearance");
    case "tickets.list_own":
    case "sessions.list":
      return ALLOW;
    case "tickets.create":
      // There is no requester field in the tool: the requester is always the principal.
      return cap.resource.requesterId === p.employeeId ? ALLOW : deny("not_self");
    case "onboarding.read": {
      const r = cap.resource;
      if (r.employeeId === p.employeeId) return ALLOW;
      if (p.role === "hr_admin") return ALLOW; // anyone with a plan (no plan is not_found, not a denial)
      if (p.role === "manager") return r.managerId === p.employeeId ? ALLOW : deny("not_report");
      return deny("not_self");
    }
    case "orientation.schedule": {
      const r = cap.resource;
      const isSelf = r.employeeId === p.employeeId;
      let inScope: Decision;
      if (isSelf || p.role === "hr_admin") inScope = ALLOW;
      else if (p.role === "manager") inScope = r.managerId === p.employeeId ? ALLOW : deny("not_report");
      else inScope = deny("not_self");
      if (!inScope.allowed) return inScope;
      return r.inOnboarding ? ALLOW : deny("not_in_onboarding");
    }
    case "action.approve":
      if (cap.resource.requesterId !== p.employeeId) return deny("not_requester");
      // Only a verified Access *user* identity can approve; a service token can propose, read and
      // reject, never approve.
      return p.identityKind === "user" ? ALLOW : deny("human_approval_required");
    case "action.reject":
      return cap.resource.requesterId === p.employeeId ? ALLOW : deny("not_requester");
  }
}
