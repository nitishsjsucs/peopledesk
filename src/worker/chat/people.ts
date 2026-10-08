// The permitted directory slice and deterministic person-name resolution. The chat router sees only
// this slice, so it cannot learn about anyone outside the caller's scope:
// - employee: nobody;
// - manager: direct reports (id, full name, in onboarding, booked);
// - hr_admin: the employees with onboarding plans (id, full name, booked).
// Names resolve only against the slice; an unknown name and an unpermitted name are indistinguishable.
import type { Role } from "../../shared/domain.ts";

export type DirectoryEntry = { employeeId: string; fullName: string; inOnboarding: boolean; booked: boolean };

/** The part of D1Database this module uses (keeps the name resolution importable from Node tests). */
type D1Like = {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> } };
};

export async function directorySlice(
  db: D1Like,
  principal: { employeeId: string; role: Role },
): Promise<DirectoryEntry[]> {
  if (principal.role === "employee") return [];
  const sql =
    principal.role === "manager"
      ? `SELECT e.id, e.full_name,
                EXISTS (SELECT 1 FROM onboarding_plans p WHERE p.employee_id = e.id) AS in_onboarding,
                EXISTS (SELECT 1 FROM orientation_bookings b WHERE b.employee_id = e.id) AS booked
           FROM employees e WHERE e.manager_id = ?1 AND e.status = 'active' ORDER BY e.id`
      : `SELECT e.id, e.full_name, 1 AS in_onboarding,
                EXISTS (SELECT 1 FROM orientation_bookings b WHERE b.employee_id = e.id) AS booked
           FROM onboarding_plans p JOIN employees e ON e.id = p.employee_id
          WHERE e.status = 'active' AND ?1 IS NOT NULL ORDER BY e.id`;
  const { results } = await db
    .prepare(sql)
    .bind(principal.employeeId)
    .all<{ id: string; full_name: string; in_onboarding: number; booked: number }>();
  return results.map((r) => ({
    employeeId: r.id,
    fullName: r.full_name,
    inOnboarding: r.in_onboarding === 1,
    booked: r.booked === 1,
  }));
}

export type PersonResolution = { kind: "self" } | { kind: "person"; employeeId: string } | { kind: "unknown" };

const SELF_WORDS = new Set(["me", "myself", "i", "my", "mine", "self"]);

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Case-insensitive match against the slice: a full name, or a first name that is unique in the
 * slice. The principal's own name (or "me") means self.
 */
export function resolvePerson(
  name: string,
  principal: { employeeId: string; fullName: string },
  slice: readonly DirectoryEntry[],
): PersonResolution {
  const n = normalizeName(name);
  if (n.length === 0) return { kind: "unknown" };
  const selfFull = normalizeName(principal.fullName);
  if (SELF_WORDS.has(n) || n === selfFull) return { kind: "self" };
  const full = slice.filter((e) => normalizeName(e.fullName) === n);
  if (full.length === 1) return { kind: "person", employeeId: (full[0] as DirectoryEntry).employeeId };
  if (!n.includes(" ")) {
    if (n === selfFull.split(" ")[0] && !slice.some((e) => normalizeName(e.fullName).split(" ")[0] === n)) return { kind: "self" };
    const byFirst = slice.filter((e) => normalizeName(e.fullName).split(" ")[0] === n);
    if (byFirst.length === 1) return { kind: "person", employeeId: (byFirst[0] as DirectoryEntry).employeeId };
  }
  return { kind: "unknown" };
}
