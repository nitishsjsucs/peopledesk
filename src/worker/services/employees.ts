import type { Me } from "../../shared/api-types.ts";
import type { Principal } from "../auth/principal.ts";

export type EmployeeRecord = {
  id: string;
  email: string;
  fullName: string;
  role: Principal["role"];
  department: string;
  region: Principal["region"];
  jobTitle: string;
  managerId: string | null;
  startDate: string;
  status: "active" | "inactive";
};

type Row = {
  id: string;
  email: string;
  full_name: string;
  role: Principal["role"];
  department: string;
  region: Principal["region"];
  job_title: string;
  manager_id: string | null;
  start_date: string;
  status: "active" | "inactive";
};

const toRecord = (r: Row): EmployeeRecord => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  role: r.role,
  department: r.department,
  region: r.region,
  jobTitle: r.job_title,
  managerId: r.manager_id,
  startDate: r.start_date,
  status: r.status,
});

export class EmployeeService {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async get(employeeId: string): Promise<EmployeeRecord | null> {
    const row = await this.db.prepare("SELECT * FROM employees WHERE id = ?1").bind(employeeId).first<Row>();
    return row ? toRecord(row) : null;
  }

  async directReportIds(managerId: string): Promise<string[]> {
    const { results } = await this.db
      .prepare("SELECT id FROM employees WHERE manager_id = ?1 AND status = 'active' ORDER BY id")
      .bind(managerId)
      .all<{ id: string }>();
    return results.map((r) => r.id);
  }

  async me(principal: Principal): Promise<Me> {
    const [row, reports, plan] = await this.db.batch([
      this.db.prepare("SELECT * FROM employees WHERE id = ?1").bind(principal.employeeId),
      this.db.prepare("SELECT id FROM employees WHERE manager_id = ?1 AND status = 'active' ORDER BY id").bind(principal.employeeId),
      this.db.prepare("SELECT 1 AS ok FROM onboarding_plans WHERE employee_id = ?1").bind(principal.employeeId),
    ]);
    const e = (row?.results[0] as Row | undefined) ?? null;
    if (!e) throw new Error("principal has no employee row");
    return {
      employeeId: e.id,
      email: e.email,
      fullName: e.full_name,
      role: e.role,
      region: e.region,
      department: e.department,
      jobTitle: e.job_title,
      managerId: e.manager_id,
      startDate: e.start_date,
      inOnboarding: (plan?.results.length ?? 0) > 0,
      directReportIds: ((reports?.results ?? []) as Array<{ id: string }>).map((r) => r.id),
      identityKind: principal.identityKind,
    };
  }
}
