// Persona and org lookups from the committed default dataset (the one every workerd test file seeds).
import type { PersonaKey } from "../../src/shared/domain.ts";
import type { Manifest } from "../../src/shared/synth/dataset.ts";
import type { Org, OrgEmployee, Persona } from "../../src/shared/synth/org.ts";
import manifestJson from "../../data/generated/asof-2026-10-01/manifest.json";
import orgJson from "../../data/generated/asof-2026-10-01/org.json";

export const manifest = manifestJson as unknown as Manifest;
export const org = orgJson as unknown as Org;

export function persona(key: PersonaKey): Persona {
  const p = org.personas.find((x) => x.key === key);
  if (!p) throw new Error(`no persona ${key}`);
  return p;
}

export function employee(id: string): OrgEmployee {
  const e = org.employees.find((x) => x.id === id);
  if (!e) throw new Error(`no employee ${id}`);
  return e;
}

export const planned = new Set(org.onboardingPlans.map((p) => p.employeeId));
export const booked = new Set(org.bookings.map((b) => b.employeeId));

export function reportsOf(managerId: string): OrgEmployee[] {
  return org.employees.filter((e) => e.managerId === managerId);
}

/** Employees with role employee that no persona uses, for tests that need a fresh identity. */
export function spareEmployees(count: number, filter: (e: OrgEmployee) => boolean = () => true): OrgEmployee[] {
  const used = new Set(org.personas.map((p) => p.employeeId));
  const out = org.employees.filter((e) => e.role === "employee" && !used.has(e.id) && filter(e));
  if (out.length < count) throw new Error("not enough spare employees");
  return out.slice(0, count);
}
