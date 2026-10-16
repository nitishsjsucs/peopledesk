// Response fixtures computed from the committed seed (org.json) at the business date the tests pin,
// with the definitions of SPEC section 8, so the web tests show what the personas see locally.
import type { OnboardingOverview, OnboardingProgress, PolicyChanges, Ticket } from "../../src/shared/api-types.ts";
import { addDaysIso, versionStatusAt } from "../../src/shared/dates.ts";
import type { Manifest } from "../../src/shared/synth/dataset.ts";
import type { Org } from "../../src/shared/synth/org.ts";
import manifestJson from "../../data/generated/asof-2026-10-01/manifest.json";
import orgJson from "../../data/generated/asof-2026-10-01/org.json";

export const org = orgJson as unknown as Org;
const manifest = manifestJson as unknown as Manifest;
export const AS_OF = "2026-10-01";
const NEXT7 = addDaysIso(AS_OF, 7);

type SeedTask = Org["onboardingTasks"][number];
const tasksOf = (id: string) => org.onboardingTasks.filter((t) => t.employeeId === id).sort((a, b) => a.ordinal - b.ordinal);
const stuck = (t: SeedTask) => t.status === "blocked" || (t.status !== "done" && t.dueDate < AS_OF);

export const employee = (id: string) => {
  const e = org.employees.find((x) => x.id === id);
  if (!e) throw new Error(`no employee ${id}`);
  return e;
};

export const DEEPA = "E0007";
export const deepaIds = org.employees.filter((e) => e.managerId === DEEPA && org.onboardingPlans.some((p) => p.employeeId === e.id)).map((e) => e.id);
export const everyoneIds = org.onboardingPlans.map((p) => p.employeeId).sort();

/** GET /api/team/onboarding for these people, as the Worker computes it. */
export function overviewFor(ids: readonly string[]): OnboardingOverview {
  const people = [...ids].sort().map((id) => {
    const plan = org.onboardingPlans.find((p) => p.employeeId === id)!;
    const ts = tasksOf(id);
    const booking = org.bookings.find((b) => b.employeeId === id);
    const session = booking ? org.sessions.find((s) => s.id === booking.sessionId) : undefined;
    return {
      employeeId: id,
      fullName: employee(id).fullName,
      startDate: plan.startDate,
      targetCompletionDate: plan.targetCompletionDate,
      tasks: {
        total: ts.length,
        done: ts.filter((t) => t.status === "done").length,
        overdue: ts.filter((t) => t.status !== "done" && t.dueDate < AS_OF).length,
        blocked: ts.filter((t) => t.status === "blocked").length,
        dueNext7: ts.filter((t) => t.status !== "done" && t.dueDate >= AS_OF && t.dueDate <= NEXT7).length,
      },
      orientation: session ? { sessionId: session.id, startsAt: session.startsAt } : null,
      orientationTaskDue: ts.find((t) => t.category === "orientation")?.dueDate ?? null,
    };
  });
  const groups = new Map<string, OnboardingOverview["steps"][number]>();
  for (const t of org.onboardingTasks.filter((x) => ids.includes(x.employeeId))) {
    const key = `${t.title}|${t.ownerRole}`;
    const g = groups.get(key) ?? { stepKey: t.ordinal, title: t.title, ownerRole: t.ownerRole, blocked: 0, overdueNotBlocked: 0, dueNext7: 0, employeeIds: [] };
    g.stepKey = Math.min(g.stepKey, t.ordinal);
    if (t.status === "blocked") g.blocked++;
    if (t.status !== "done" && t.status !== "blocked" && t.dueDate < AS_OF) g.overdueNotBlocked++;
    if (t.status !== "done" && t.dueDate >= AS_OF && t.dueDate <= NEXT7) g.dueNext7++;
    if (stuck(t) && !g.employeeIds.includes(t.employeeId)) g.employeeIds.push(t.employeeId);
    groups.set(key, g);
  }
  const steps = [...groups.values()]
    .filter((g) => g.blocked + g.overdueNotBlocked > 0)
    .sort((a, b) => b.blocked + b.overdueNotBlocked - (a.blocked + a.overdueNotBlocked) || b.blocked - a.blocked || a.stepKey - b.stepKey)
    .slice(0, 20)
    .map((g) => ({ ...g, employeeIds: [...g.employeeIds].sort() }));
  return { asOf: AS_OF, people, steps };
}

/** GET /api/onboarding(/:id) for one person. */
export function progressFor(id: string): OnboardingProgress {
  const plan = org.onboardingPlans.find((p) => p.employeeId === id)!;
  const ts = tasksOf(id);
  const counts = { done: 0, inProgress: 0, pending: 0, blocked: 0 };
  for (const t of ts) {
    if (t.status === "done") counts.done++;
    else if (t.status === "in_progress") counts.inProgress++;
    else if (t.status === "blocked") counts.blocked++;
    else counts.pending++;
  }
  return {
    employeeId: id,
    fullName: employee(id).fullName,
    startDate: plan.startDate,
    targetCompletionDate: plan.targetCompletionDate,
    percentComplete: Math.round((counts.done / ts.length) * 100),
    counts,
    tasks: ts.map((t) => ({ id: t.id, title: t.title, category: t.category, ownerRole: t.ownerRole, dueDate: t.dueDate, status: t.status })),
  };
}

/** GET /api/orientation-booking for one person. */
export function bookingFor(id: string) {
  const b = org.bookings.find((x) => x.employeeId === id);
  const s = b ? org.sessions.find((x) => x.id === b.sessionId) : undefined;
  return {
    booking: s ? { sessionId: s.id, title: s.title, startsAt: s.startsAt, durationMin: s.durationMin, format: s.format, region: s.region, location: s.location } : null,
  };
}

/** GET /api/tickets for one requester, newest first. */
export function ticketsFor(id: string): Ticket[] {
  return org.tickets
    .filter((t) => t.requesterId === id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((t) => ({ ...t }) as Ticket);
}

/** GET /api/orientation-sessions with the default 60-day window, with seats remaining. */
export function sessionsAt() {
  const to = addDaysIso(AS_OF, 60);
  return {
    sessions: org.sessions
      .filter((s) => s.startsAt.slice(0, 10) >= AS_OF && s.startsAt.slice(0, 10) <= to)
      .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id < b.id ? -1 : 1))
      .map((s) => ({
        id: s.id,
        title: s.title,
        startsAt: s.startsAt,
        durationMin: s.durationMin,
        format: s.format,
        region: s.region,
        location: s.location,
        capacity: s.capacity,
        seatsRemaining: Math.max(0, s.capacity - org.bookings.filter((b) => b.sessionId === s.id).length),
      })),
  };
}

/** GET /api/policy-changes for a clearance, from the committed manifest. */
export function policyChangesFor(rank: 1 | 2 | 3, category?: string): PolicyChanges {
  const lo = addDaysIso(AS_OF, -90);
  const hi = addDaysIso(AS_OF, 365);
  const changes = manifest.documents
    .filter((d) => d.rank <= rank && (category === undefined || d.category === category))
    .flatMap((d) => d.versions.filter((v) => v.effectiveFrom > lo && v.effectiveFrom <= hi).map((v) => ({ d, v })))
    .sort((a, b) => (a.v.effectiveFrom === b.v.effectiveFrom ? (a.d.docId < b.d.docId ? -1 : 1) : a.v.effectiveFrom < b.v.effectiveFrom ? -1 : 1))
    .map(({ d, v }) => ({
      docId: d.docId,
      title: d.title,
      category: d.category,
      audience: d.audience,
      version: v.version,
      effectiveFrom: v.effectiveFrom,
      status: versionStatusAt({ effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo }, AS_OF),
      changeSummary: v.changeSummary,
    }));
  return { asOf: AS_OF, changes: changes.slice(0, 50), truncated: changes.length > 50 };
}
