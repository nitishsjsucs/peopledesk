import type { OnboardingProgress } from "../../shared/api-types.ts";

type TaskRow = {
  id: string;
  title: string;
  category: OnboardingProgress["tasks"][number]["category"];
  owner_role: OnboardingProgress["tasks"][number]["ownerRole"];
  due_date: string;
  status: OnboardingProgress["tasks"][number]["status"];
};

export class OnboardingService {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  async hasPlan(employeeId: string): Promise<boolean> {
    return (await this.db.prepare("SELECT 1 AS ok FROM onboarding_plans WHERE employee_id = ?1").bind(employeeId).first()) !== null;
  }

  /** Progress for one employee, or null when there is no onboarding plan. Authorization is the caller's job. */
  async progress(employeeId: string): Promise<OnboardingProgress | null> {
    const [plan, tasks] = await this.db.batch([
      this.db
        .prepare(
          `SELECT p.employee_id, p.start_date, p.target_completion_date, e.full_name
             FROM onboarding_plans p JOIN employees e ON e.id = p.employee_id WHERE p.employee_id = ?1`,
        )
        .bind(employeeId),
      this.db
        .prepare("SELECT id, title, category, owner_role, due_date, status FROM onboarding_tasks WHERE employee_id = ?1 ORDER BY ordinal")
        .bind(employeeId),
    ]);
    const p = plan?.results[0] as
      | { employee_id: string; start_date: string; target_completion_date: string; full_name: string }
      | undefined;
    if (!p) return null;
    const rows = (tasks?.results ?? []) as TaskRow[];
    const counts = { done: 0, inProgress: 0, pending: 0, blocked: 0 };
    for (const t of rows) {
      if (t.status === "done") counts.done++;
      else if (t.status === "in_progress") counts.inProgress++;
      else if (t.status === "blocked") counts.blocked++;
      else counts.pending++;
    }
    return {
      employeeId: p.employee_id,
      fullName: p.full_name,
      startDate: p.start_date,
      targetCompletionDate: p.target_completion_date,
      percentComplete: rows.length === 0 ? 0 : Math.round((counts.done / rows.length) * 100),
      counts,
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        ownerRole: t.owner_role,
        dueDate: t.due_date,
        status: t.status,
      })),
    };
  }
}
