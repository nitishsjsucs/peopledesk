import type { OnboardingOverview, OnboardingOverviewPerson, OnboardingOverviewStep, OnboardingProgress } from "../../shared/api-types.ts";
import { addDaysIso } from "../../shared/dates.ts";
import { can } from "../authz/policy.ts";
import type { AuthzPrincipal } from "../authz/policy.ts";

type TaskRow = {
  id: string;
  title: string;
  category: OnboardingProgress["tasks"][number]["category"];
  owner_role: OnboardingProgress["tasks"][number]["ownerRole"];
  due_date: string;
  status: OnboardingProgress["tasks"][number]["status"];
};

/** Percent of a plan's tasks that are done, as every onboarding view reports it. */
export function percentComplete(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

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
      percentComplete: percentComplete(counts.done, rows.length),
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

// --- Team overview (GET /api/team/onboarding) ---------------------------------------------------

type OverviewPersonRow = {
  employee_id: string;
  full_name: string;
  manager_id: string | null;
  start_date: string;
  target_completion_date: string;
  total: number;
  done: number;
  blocked: number;
  overdue: number;
  due_next7: number;
  orientation_task_due: string | null;
};
type OverviewBookingRow = { employee_id: string; session_id: string; starts_at: string };
type OverviewStepRow = {
  step_key: number;
  title: string;
  owner_role: OnboardingOverviewStep["ownerRole"];
  blocked: number;
  overdue_not_blocked: number;
  due_next7: number;
  stuck_ids: string | null;
};

/** At most this many stuck steps are returned (the checklist template has 12). */
export const MAX_OVERVIEW_STEPS = 20;

/**
 * The person-level and step-level aggregates for the given plan holders, in one D1 batch of three
 * statements whose row counts are bounded by the ids (at most one row per person, one per booking,
 * and 20 steps). Definitions (SPEC section 8): overdue = not done and due strictly before asOf;
 * dueNext7 = not done and asOf <= due <= asOf + 7; blocked = status blocked; a stuck task is blocked,
 * or not done and past due. Authorization is the caller's job (the ids come from directorySlice).
 */
export async function overviewRows(
  db: D1Database,
  ids: readonly string[],
  asOf: string,
): Promise<{ people: OverviewPersonRow[]; bookings: OverviewBookingRow[]; steps: OverviewStepRow[] }> {
  const args = [JSON.stringify(ids), asOf, addDaysIso(asOf, 7)] as const;
  const [people, bookings, steps] = await db.batch([
    db
      .prepare(
        `SELECT p.employee_id, e.full_name, e.manager_id, p.start_date, p.target_completion_date,
                COUNT(t.id) AS total,
                COALESCE(SUM(t.status = 'done'), 0) AS done,
                COALESCE(SUM(t.status = 'blocked'), 0) AS blocked,
                COALESCE(SUM(t.status <> 'done' AND t.due_date < ?2), 0) AS overdue,
                COALESCE(SUM(t.status <> 'done' AND t.due_date >= ?2 AND t.due_date <= ?3), 0) AS due_next7,
                MAX(CASE WHEN t.category = 'orientation' THEN t.due_date END) AS orientation_task_due
           FROM onboarding_plans p
           JOIN employees e ON e.id = p.employee_id
           LEFT JOIN onboarding_tasks t ON t.employee_id = p.employee_id
          WHERE p.employee_id IN (SELECT value FROM json_each(?1))
          GROUP BY p.employee_id
          ORDER BY p.employee_id`,
      )
      .bind(...args),
    db
      .prepare(
        `SELECT b.employee_id, s.id AS session_id, s.starts_at
           FROM orientation_bookings b JOIN orientation_sessions s ON s.id = b.session_id
          WHERE b.employee_id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(args[0]),
    db
      .prepare(
        `SELECT MIN(ordinal) AS step_key, title, owner_role,
                SUM(status = 'blocked') AS blocked,
                SUM(status NOT IN ('done', 'blocked') AND due_date < ?2) AS overdue_not_blocked,
                SUM(status <> 'done' AND due_date >= ?2 AND due_date <= ?3) AS due_next7,
                group_concat(DISTINCT CASE WHEN status = 'blocked' OR (status <> 'done' AND due_date < ?2) THEN employee_id END) AS stuck_ids
           FROM onboarding_tasks
          WHERE employee_id IN (SELECT value FROM json_each(?1))
          GROUP BY title, owner_role
         HAVING blocked + overdue_not_blocked > 0
          ORDER BY blocked + overdue_not_blocked DESC, blocked DESC, step_key
          LIMIT ${MAX_OVERVIEW_STEPS}`,
      )
      .bind(...args),
  ]);
  return {
    people: (people?.results ?? []) as OverviewPersonRow[],
    bookings: (bookings?.results ?? []) as OverviewBookingRow[],
    steps: (steps?.results ?? []) as OverviewStepRow[],
  };
}

/**
 * Shapes the rows into the response. Defense in depth: a person row the principal may not read
 * (onboarding.read) is dropped, and because a step's counts cannot be split by person, any such drop
 * also drops every step (fail closed); the slice and the capability should never disagree.
 */
export function shapeOverview(
  principal: AuthzPrincipal,
  asOf: string,
  rows: { people: OverviewPersonRow[]; bookings: OverviewBookingRow[]; steps: OverviewStepRow[] },
): { overview: OnboardingOverview; dropped: string[] } {
  const booking = new Map(rows.bookings.map((b) => [b.employee_id, { sessionId: b.session_id, startsAt: b.starts_at }]));
  const dropped: string[] = [];
  const people: OnboardingOverviewPerson[] = [];
  for (const r of rows.people) {
    const decision = can(principal, { name: "onboarding.read", resource: { employeeId: r.employee_id, managerId: r.manager_id, inOnboarding: true } });
    if (!decision.allowed) {
      dropped.push(r.employee_id);
      continue;
    }
    people.push({
      employeeId: r.employee_id,
      fullName: r.full_name,
      startDate: r.start_date,
      targetCompletionDate: r.target_completion_date,
      tasks: { total: r.total, done: r.done, overdue: r.overdue, blocked: r.blocked, dueNext7: r.due_next7 },
      orientation: booking.get(r.employee_id) ?? null,
      orientationTaskDue: r.orientation_task_due,
    });
  }
  const allowed = new Set(people.map((p) => p.employeeId));
  const steps: OnboardingOverviewStep[] =
    dropped.length > 0
      ? []
      : rows.steps.map((s) => ({
          stepKey: s.step_key,
          title: s.title,
          ownerRole: s.owner_role,
          blocked: s.blocked,
          overdueNotBlocked: s.overdue_not_blocked,
          dueNext7: s.due_next7,
          employeeIds: (s.stuck_ids ?? "")
            .split(",")
            .filter((id) => allowed.has(id))
            .sort(),
        }));
  return { overview: { asOf, people, steps }, dropped };
}
