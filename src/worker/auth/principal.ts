// Maps a verified identity to an employee record and role in D1. Request bodies never carry
// identity: this is the only way a request acquires a Principal.
import type { Clearance, IdentityKind, Region, Role } from "../../shared/domain.ts";
import { ROLE_CLEARANCE } from "../../shared/domain.ts";
import { AppError } from "../errors.ts";
import type { VerifiedIdentity } from "./identity.ts";

export type Principal = {
  employeeId: string;
  email: string;
  fullName: string;
  role: Role;
  region: Region;
  department: string;
  managerId: string | null;
  clearance: Clearance;
  identityKind: IdentityKind;
  /** The verified identity string: a lowercased email, or a service token common_name. */
  identity: string;
};

type EmployeeRow = {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  region: Region;
  department: string;
  manager_id: string | null;
  status: "active" | "inactive";
};

const EMPLOYEE_COLUMNS = "e.id, e.email, e.full_name, e.role, e.region, e.department, e.manager_id, e.status";

export async function resolvePrincipal(
  db: D1Database,
  identity: VerifiedIdentity,
  opts: { allowServiceTokens: boolean },
): Promise<Principal> {
  let row: EmployeeRow | null;
  if (identity.kind === "user") {
    row = await db
      .prepare(
        `SELECT ${EMPLOYEE_COLUMNS}, 0 AS via FROM employees e WHERE e.email = ?1
         UNION ALL
         SELECT ${EMPLOYEE_COLUMNS}, 1 AS via FROM identity_links l JOIN employees e ON e.id = l.employee_id
          WHERE l.identity = ?1 AND l.kind = 'email'
         ORDER BY via LIMIT 1`,
      )
      .bind(identity.email.toLowerCase())
      .first<EmployeeRow>();
  } else {
    if (!opts.allowServiceTokens) throw new AppError(403, "forbidden", "Service tokens are not enabled.");
    row = await db
      .prepare(
        `SELECT ${EMPLOYEE_COLUMNS} FROM identity_links l JOIN employees e ON e.id = l.employee_id
          WHERE l.identity = ?1 AND l.kind = 'service_token'`,
      )
      .bind(identity.commonName)
      .first<EmployeeRow>();
  }
  if (!row) throw new AppError(403, "forbidden", "No employee record for this identity.");
  if (row.status !== "active") throw new AppError(403, "forbidden", "This employee record is inactive.");
  return {
    employeeId: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    region: row.region,
    department: row.department,
    managerId: row.manager_id,
    clearance: ROLE_CLEARANCE[row.role],
    identityKind: identity.kind,
    identity: identity.kind === "user" ? identity.email.toLowerCase() : identity.commonName,
  };
}

/** Re-reads the principal's employee row (used to re-authorize at approval time). */
export async function reloadPrincipal(db: D1Database, principal: Principal): Promise<Principal | null> {
  const row = await db
    .prepare(`SELECT ${EMPLOYEE_COLUMNS} FROM employees e WHERE e.id = ?1`)
    .bind(principal.employeeId)
    .first<EmployeeRow>();
  if (!row || row.status !== "active") return null;
  return {
    ...principal,
    fullName: row.full_name,
    role: row.role,
    region: row.region,
    department: row.department,
    managerId: row.manager_id,
    clearance: ROLE_CLEARANCE[row.role],
  };
}
