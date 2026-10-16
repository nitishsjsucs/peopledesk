// An onboarding checklist as next steps: what the viewer must do now, what is coming, and (for a new
// hire's own checklist) what waits on someone else. One pure function, used by My checklist, the
// manager and HR checklist pane, and Home, so "overdue" means the same everywhere: not done and due
// before the business date (a task due today is not overdue).
import type { OnboardingProgress } from "../../shared/api-types.ts";
import type { OnboardingOwnerRole } from "../../shared/domain.ts";
import { addDaysIso } from "../../shared/dates.ts";
import { daysBetween, plural } from "./dates.ts";
import { formatDate } from "./format.ts";

export type Relation = "self" | "manager" | "hr";
export type GroupKey = "overdue" | "next7" | "later" | "waiting" | "done";
type Task = OnboardingProgress["tasks"][number];

export const GROUP_TITLE: Record<GroupKey, string> = {
  overdue: "Overdue",
  next7: "Due in the next 7 days",
  later: "Later",
  waiting: "Waiting on someone else",
  done: "Done",
};

const GROUP_ORDER: GroupKey[] = ["overdue", "next7", "later", "waiting", "done"];
const VIEWER_ROLE: Record<Relation, OnboardingOwnerRole> = { self: "employee", manager: "manager", hr: "hr_admin" };
const ROLE_ORDER: OnboardingOwnerRole[] = ["employee", "manager", "hr_admin", "it"];

/** Who owns a task, as the viewer would say it. */
export function taskOwner(role: OnboardingOwnerRole, relation: Relation): string {
  if (role === VIEWER_ROLE[relation]) return "You";
  if (role === "it") return "IT";
  if (role === "hr_admin") return "HR";
  if (role === "employee") return "New hire";
  return relation === "self" ? "Your manager" : relation === "hr" ? "Their manager" : "Manager";
}

export type ChecklistItem = {
  task: Task;
  group: GroupKey;
  owner: string;
  /** Not done and due before asOf. */
  overdue: boolean;
  dueToday: boolean;
  /** Book orientation on the unbooked orientation task; Open a ticket on an open IT task. */
  action: "book" | "ticket" | null;
};

export type ChecklistGroup = { key: GroupKey; title: string; items: ChecklistItem[] };

export type GroupedChecklist = {
  groups: ChecklistGroup[];
  total: number;
  done: number;
  overdue: number;
  /** For the viewer's own checklist: open tasks waiting on others, by owner, most first. */
  waiting: Array<{ owner: string; count: number }>;
  /** The orientation task, if the plan has one. */
  orientationTask: Task | null;
};

type Options = {
  relation: Relation;
  asOf: string;
  /** Whether the person has an orientation booking; null when it could not be checked. */
  booked: boolean | null;
};

/**
 * Precedence for each task: done goes to Done. For the viewer's own checklist, the orientation task
 * while the person has no booking is theirs whatever its owner (booking is the hire's action). Other
 * open tasks the viewer owns are Overdue (due before asOf), Due in the next 7 days (asOf to asOf + 7)
 * or Later; on the viewer's own checklist, open tasks owned by someone else wait on them. A manager or
 * HR admin has no waiting group: every open task is placed by its due date, with its owner named.
 */
export function groupChecklist(progress: OnboardingProgress, { relation, asOf, booked }: Options): GroupedChecklist {
  const next7 = addDaysIso(asOf, 7);
  const items: ChecklistItem[] = progress.tasks.map((task) => {
    // A done orientation task needs no booking, so it keeps its owner and has no Book link.
    const unbookedOrientation = task.category === "orientation" && booked === false && task.status !== "done";
    const overdue = task.status !== "done" && task.dueDate < asOf;
    const dueToday = task.dueDate === asOf;
    const mine = (relation === "self" && unbookedOrientation) || task.ownerRole === VIEWER_ROLE[relation];
    let group: GroupKey;
    if (task.status === "done") group = "done";
    else if (relation === "self" && !mine) group = "waiting";
    else group = overdue ? "overdue" : task.dueDate <= next7 ? "next7" : "later";
    const action = task.status === "done" ? null : unbookedOrientation ? "book" : task.ownerRole === "it" ? "ticket" : null;
    return { task, group, owner: relation === "self" && unbookedOrientation ? "You" : taskOwner(task.ownerRole, relation), overdue, dueToday, action };
  });
  const groups = GROUP_ORDER.map((key) => ({
    key,
    title: GROUP_TITLE[key],
    // By due date; tasks due the same day keep the checklist's order (Array.prototype.sort is stable).
    items: items.filter((i) => i.group === key).sort((a, b) => (a.task.dueDate < b.task.dueDate ? -1 : a.task.dueDate > b.task.dueDate ? 1 : 0)),
  })).filter((g) => g.items.length > 0);
  const waitingByRole = new Map<OnboardingOwnerRole, number>();
  for (const i of items) if (i.group === "waiting") waitingByRole.set(i.task.ownerRole, (waitingByRole.get(i.task.ownerRole) ?? 0) + 1);
  return {
    groups,
    total: progress.tasks.length,
    done: items.filter((i) => i.task.status === "done").length,
    overdue: items.filter((i) => i.overdue).length,
    waiting: [...waitingByRole.entries()]
      .sort((a, b) => b[1] - a[1] || ROLE_ORDER.indexOf(a[0]) - ROLE_ORDER.indexOf(b[0]))
      .map(([role, count]) => ({ owner: taskOwner(role, relation), count })),
    orientationTask: progress.tasks.find((t) => t.category === "orientation") ?? null,
  };
}

/** The first task the viewer should do: their own open tasks in group order, then by due date. */
export function nextForYou(grouped: GroupedChecklist): ChecklistItem | null {
  for (const g of grouped.groups) {
    if (g.key === "waiting" || g.key === "done") continue;
    const first = g.items[0];
    if (first) return first;
  }
  return null;
}

/** "2 waiting on your manager", or "4 waiting on others: your manager 2, HR 2"; null when nothing waits. */
export function waitingText(waiting: GroupedChecklist["waiting"]): string | null {
  const total = waiting.reduce((n, w) => n + w.count, 0);
  if (total === 0) return null;
  const lower = (owner: string) => (owner === "Your manager" ? "your manager" : owner);
  if (waiting.length === 1) return `${total} waiting on ${lower((waiting[0] as { owner: string }).owner)}`;
  return `${total} waiting on others: ${waiting.map((w) => `${lower(w.owner)} ${w.count}`).join(", ")}`;
}

/**
 * The plan line above a checklist: "Day 55 of 90 · target Nov 5, 2026 · 9 of 12 done · 3 overdue".
 * Before the start date it says when the plan starts; after the target date, by how many days it ran
 * past it. Day N counts whole days since the start date.
 */
export function planLine(progress: Pick<OnboardingProgress, "startDate" | "targetCompletionDate">, grouped: Pick<GroupedChecklist, "total" | "done" | "overdue">, asOf: string): string {
  const day = daysBetween(progress.startDate, asOf);
  const length = daysBetween(progress.startDate, progress.targetCompletionDate);
  let phase: string;
  if (day < 0) phase = `Starts ${formatDate(progress.startDate)}, in ${plural(-day, "day")}`;
  else if (day === 0) phase = `Starts today, ${formatDate(progress.startDate)}`;
  else if (asOf > progress.targetCompletionDate)
    phase = `${plural(daysBetween(progress.targetCompletionDate, asOf), "day")} past the target date of ${formatDate(progress.targetCompletionDate)}`;
  else phase = `Day ${day} of ${length} · target ${formatDate(progress.targetCompletionDate)}`;
  const parts = [phase, `${grouped.done} of ${grouped.total} done`];
  if (grouped.overdue > 0) parts.push(`${grouped.overdue} overdue`);
  return parts.join(" · ");
}
