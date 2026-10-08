// Synthetic organization: employees, onboarding plans and tasks, orientation sessions and bookings,
// seeded tickets and the six personas. Every date is a day offset from AS_OF; random choices never
// depend on AS_OF, so --as-of shifts dates without changing structure.
import type {
  OnboardingOwnerRole,
  OnboardingTaskCategory,
  OnboardingTaskStatus,
  PersonaKey,
  Region,
  Role,
  SessionFormat,
  SessionRegion,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "../domain.ts";
import { POLICY_CATEGORIES, REGIONS } from "../domain.ts";
import { addDays, atUtc } from "./dates.ts";
import type { Department } from "./names.ts";
import {
  DEPARTMENTS,
  FIRST_NAMES,
  HEAD_TITLES,
  HR_ADMIN_TITLE,
  JOB_TITLES,
  LAST_NAMES,
  MANAGER_TITLES,
  emailFor,
} from "./names.ts";
import { rng } from "./prng.ts";
import type { Rng } from "./prng.ts";

export type OrgEmployee = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  department: Department;
  region: Region;
  jobTitle: string;
  managerId: string | null;
  startDate: string;
  status: "active" | "inactive";
};

export type OnboardingPlan = {
  employeeId: string;
  buddyId: string | null;
  startDate: string;
  targetCompletionDate: string;
};

export type OnboardingTask = {
  id: string;
  employeeId: string;
  ordinal: number;
  title: string;
  category: OnboardingTaskCategory;
  ownerRole: OnboardingOwnerRole;
  dueDate: string;
  status: OnboardingTaskStatus;
  completedAt: string | null;
};

export type OrientationSession = {
  id: string;
  title: string;
  startsAt: string;
  durationMin: number;
  format: SessionFormat;
  region: SessionRegion;
  location: string;
  capacity: number;
  facilitatorId: string;
};

export type OrientationBooking = {
  id: string;
  sessionId: string;
  employeeId: string;
  bookedBy: string;
  createdAt: string;
};

export type SeedTicket = {
  id: string;
  requesterId: string;
  category: TicketCategory;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  relatedPolicyId: string | null;
  createdVia: "seed";
  createdAt: string;
  updatedAt: string;
};

export type Persona = {
  key: PersonaKey;
  employeeId: string;
  email: string;
  fullName: string;
  role: Role;
  description: string;
};

export type Org = {
  asOf: string;
  employees: OrgEmployee[];
  onboardingPlans: OnboardingPlan[];
  onboardingTasks: OnboardingTask[];
  sessions: OrientationSession[];
  bookings: OrientationBooking[];
  tickets: SeedTicket[];
  personas: Persona[];
};

const pad = (n: number, width: number) => String(n).padStart(width, "0");
const employeeId = (n: number) => `E${pad(n, 4)}`;

// Team managers per department (heads are separate). People has no team manager: its ICs and the
// hr_admins report to the head of People.
const TEAM_MANAGERS: ReadonlyArray<Department> = [
  "Engineering",
  "Engineering",
  "Engineering",
  "Sales",
  "Sales",
  "Customer Support",
  "Customer Support",
  "Finance",
  "Operations",
];

const IC_DEPARTMENTS: ReadonlyArray<[Department, number]> = [
  ["Engineering", 34],
  ["Sales", 18],
  ["Customer Support", 20],
  ["Finance", 10],
  ["Operations", 10],
  ["People", 8],
];

/** The manager persona with new hires, and the manager persona without, are fixed by position. */
const MANAGER_WITH_NEW_HIRES = employeeId(7); // first Engineering team manager
const MANAGER_NO_NEW_HIRES = employeeId(14); // the Finance team manager

function uniqueNames(r: Rng, count: number): string[] {
  const names = new Set<string>();
  const firsts = r.shuffle(FIRST_NAMES);
  const lasts = r.shuffle(LAST_NAMES);
  let i = 0;
  while (names.size < count) {
    const first = firsts[i % firsts.length] as string;
    const last = lasts[(i * 7 + Math.floor(i / lasts.length)) % lasts.length] as string;
    i++;
    if (first === last) continue;
    names.add(`${first} ${last}`);
    if (i > count * 50) throw new Error("could not build unique names");
  }
  return [...names];
}

function buildEmployees(asOf: string): OrgEmployee[] {
  const r = rng("org/employees");
  const names = uniqueNames(rng("org/names"), 120);
  const regionPool: Region[] = [];
  for (const [region, n] of [
    ["US", 60],
    ["IN", 40],
    ["UK", 20],
  ] as const) {
    for (let i = 0; i < n; i++) regionPool.push(region);
  }
  const regions = rng("org/regions").shuffle(regionPool);
  const employees: OrgEmployee[] = [];
  const make = (
    n: number,
    role: Role,
    department: Department,
    jobTitle: string,
    managerId: string | null,
    tenureDays: number,
  ): OrgEmployee => {
    const fullName = names[n - 1] as string;
    return {
      id: employeeId(n),
      email: emailFor(fullName),
      fullName,
      role,
      department,
      region: regions[n - 1] as Region,
      jobTitle,
      managerId,
      startDate: addDays(asOf, -tenureDays),
      status: "active",
    };
  };

  // Heads E0001..E0006, one per department.
  DEPARTMENTS.forEach((dept, i) => employees.push(make(i + 1, "manager", dept, HEAD_TITLES[dept], null, r.int(1500, 3200))));
  const headOf = (dept: Department) => employeeId(DEPARTMENTS.indexOf(dept) + 1);
  // Team managers E0007..E0015.
  TEAM_MANAGERS.forEach((dept, i) =>
    employees.push(make(7 + i, "manager", dept, MANAGER_TITLES[dept], headOf(dept), r.int(700, 2600))),
  );
  // HR admins E0016..E0020, reporting to the head of People.
  for (let i = 0; i < 5; i++) employees.push(make(16 + i, "hr_admin", "People", HR_ADMIN_TITLE, headOf("People"), r.int(400, 2400)));
  // Individual contributors E0021..E0120.
  let n = 21;
  for (const [dept, count] of IC_DEPARTMENTS) {
    const managers = TEAM_MANAGERS.map((d, i) => (d === dept ? employeeId(7 + i) : null)).filter(
      (x): x is string => x !== null,
    );
    const pool = managers.length > 0 ? managers : [headOf(dept)];
    const titles = JOB_TITLES[dept];
    for (let i = 0; i < count; i++) {
      employees.push(make(n, "employee", dept, r.pick(titles), pool[i % pool.length] as string, r.int(100, 2800)));
      n++;
    }
  }
  return employees;
}

type TaskTemplate = {
  title: string;
  category: OnboardingTaskCategory;
  ownerRole: OnboardingOwnerRole;
  dueOffset: number;
};

export const ONBOARDING_TASK_TEMPLATES: readonly TaskTemplate[] = [
  { title: "Sign employment agreement", category: "paperwork", ownerRole: "employee", dueOffset: -7 },
  { title: "Laptop and accounts setup", category: "it_setup", ownerRole: "it", dueOffset: 0 },
  { title: "Enroll in multi-factor authentication", category: "it_setup", ownerRole: "employee", dueOffset: 1 },
  { title: "Submit tax and payroll forms", category: "paperwork", ownerRole: "employee", dueOffset: 3 },
  { title: "Meet your onboarding buddy", category: "meet_people", ownerRole: "employee", dueOffset: 5 },
  { title: "First one-on-one with your manager", category: "meet_people", ownerRole: "manager", dueOffset: 7 },
  { title: "Team introductions", category: "meet_people", ownerRole: "manager", dueOffset: 10 },
  { title: "Security awareness training", category: "training", ownerRole: "employee", dueOffset: 14 },
  { title: "Code of conduct training", category: "training", ownerRole: "employee", dueOffset: 14 },
  { title: "Benefits enrollment", category: "paperwork", ownerRole: "employee", dueOffset: 30 },
  { title: "Attend new hire orientation", category: "orientation", ownerRole: "hr_admin", dueOffset: 45 },
  { title: "30-day check-in with HR", category: "meet_people", ownerRole: "hr_admin", dueOffset: 30 },
];

function taskStatus(r: Rng, dueDate: string, startDate: string, asOf: string): OnboardingTaskStatus {
  if (startDate > asOf) return dueDate < asOf && r.chance(0.7) ? "done" : "pending";
  if (dueDate < asOf) {
    const x = r.next();
    if (x < 0.82) return "done";
    if (x < 0.92) return "in_progress";
    return "blocked";
  }
  if (dueDate <= addDays(asOf, 7)) return r.chance(0.5) ? "in_progress" : "pending";
  return "pending";
}

function buildOnboarding(
  asOf: string,
  employees: OrgEmployee[],
): { plans: OnboardingPlan[]; tasks: OnboardingTask[]; newHireIds: string[]; managerHireIds: string[] } {
  const r = rng("org/onboarding");
  const ics = employees.filter((e) => e.role === "employee");
  const managerReports = ics.filter((e) => e.managerId === MANAGER_WITH_NEW_HIRES).map((e) => e.id);
  const excluded = new Set(ics.filter((e) => e.managerId === MANAGER_NO_NEW_HIRES).map((e) => e.id));
  const managerHireIds = r.shuffle(managerReports).slice(0, 5);
  const managerHireSet = new Set(managerHireIds);
  const others = r
    .shuffle(ics.filter((e) => !managerHireSet.has(e.id) && !excluded.has(e.id) && e.managerId !== MANAGER_WITH_NEW_HIRES))
    .slice(0, 25)
    .map((e) => e.id);
  const newHireIds = [...managerHireIds, ...others].sort();
  const byId = new Map(employees.map((e) => [e.id, e]));

  const plans: OnboardingPlan[] = [];
  const tasks: OnboardingTask[] = [];
  for (const id of newHireIds) {
    const e = byId.get(id) as OrgEmployee;
    const pr = rng(`org/onboarding/${id}`);
    const startDate = addDays(asOf, pr.int(-75, 20));
    e.startDate = startDate;
    const buddies = employees.filter(
      (b) => b.department === e.department && b.role === "employee" && !newHireIds.includes(b.id),
    );
    plans.push({
      employeeId: id,
      buddyId: buddies.length > 0 ? pr.pick(buddies).id : null,
      startDate,
      targetCompletionDate: addDays(startDate, 90),
    });
    ONBOARDING_TASK_TEMPLATES.forEach((t, i) => {
      const dueDate = addDays(startDate, t.dueOffset);
      const status = taskStatus(pr, dueDate, startDate, asOf);
      tasks.push({
        id: `ONB-${id}-${pad(i + 1, 2)}`,
        employeeId: id,
        ordinal: i + 1,
        title: t.title,
        category: t.category,
        ownerRole: t.ownerRole,
        dueDate,
        status,
        completedAt: status === "done" ? atUtc(dueDate < asOf ? dueDate : addDays(asOf, -1), 15) : null,
      });
    });
  }
  return { plans, tasks, newHireIds, managerHireIds };
}

const IN_PERSON_LOCATIONS: Record<Region, string> = {
  US: "Austin Office, Training Room 2",
  IN: "Bengaluru Office, Room 4B",
  UK: "London Office, Room 3",
};
const SESSION_HOUR_UTC: Record<SessionRegion, number> = { GLOBAL: 15, US: 16, IN: 5, UK: 10 };

function buildSessions(asOf: string, employees: OrgEmployee[]): OrientationSession[] {
  const r = rng("org/sessions");
  const facilitators = employees.filter((e) => e.role === "hr_admin").map((e) => e.id);
  const sessions: OrientationSession[] = [];
  for (let week = 0; week < 8; week++) {
    for (let j = 0; j < 3; j++) {
      const index = week * 3 + j;
      const format: SessionFormat = j === 1 ? "in_person" : "virtual";
      const region: SessionRegion = j === 0 ? "GLOBAL" : (REGIONS[(week + j) % 3] as Region);
      const date = addDays(asOf, 14 + week * 7 + j * 2);
      const regionLabel = region === "GLOBAL" ? "Global" : region;
      sessions.push({
        id: `ORI-${pad(index + 1, 3)}`,
        title: `New Hire Orientation (${regionLabel}, ${format === "virtual" ? "virtual" : "in person"})`,
        startsAt: atUtc(date, SESSION_HOUR_UTC[region]),
        durationMin: format === "virtual" ? 90 : 120,
        format,
        region,
        location:
          format === "virtual" ? "Video call (link sent after booking)" : IN_PERSON_LOCATIONS[region as Region],
        capacity: r.int(8, 20),
        facilitatorId: facilitators[index % facilitators.length] as string,
      });
    }
  }
  return sessions;
}

function buildBookings(
  asOf: string,
  employees: OrgEmployee[],
  sessions: OrientationSession[],
  newHireIds: string[],
  managerHireIds: string[],
): OrientationBooking[] {
  const r = rng("org/bookings");
  const byId = new Map(employees.map((e) => [e.id, e]));
  // Two sessions are made exactly full (capacity 6, six bookings each).
  const fullIndexes = r.shuffle(sessions.map((_, i) => i)).slice(0, 2).sort((a, b) => a - b);
  for (const i of fullIndexes) (sessions[i] as OrientationSession).capacity = 6;
  const managerBooked = managerHireIds.slice(0, 2);
  const otherHires = r.shuffle(newHireIds.filter((id) => !managerHireIds.includes(id)));
  const booked = [...managerBooked, ...otherHires.slice(0, 16)];
  const order = r.shuffle(booked);
  const others = sessions.map((_, i) => i).filter((i) => !fullIndexes.includes(i));
  const bookings: OrientationBooking[] = [];
  order.forEach((employeeIdValue, k) => {
    const sessionIndex = k < 12 ? (fullIndexes[Math.floor(k / 6)] as number) : (r.pick(others) as number);
    const session = sessions[sessionIndex] as OrientationSession;
    const e = byId.get(employeeIdValue) as OrgEmployee;
    bookings.push({
      id: `BKG-seed-${pad(k + 1, 3)}`,
      sessionId: session.id,
      employeeId: employeeIdValue,
      bookedBy: r.chance(0.6) ? employeeIdValue : (e.managerId ?? employeeIdValue),
      createdAt: atUtc(addDays(asOf, -r.int(1, 20)), 9 + r.int(0, 8)),
    });
  });
  return bookings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function pickPersonas(
  employees: OrgEmployee[],
  plans: OnboardingPlan[],
  bookings: OrientationBooking[],
  managerHireIds: string[],
  asOf: string,
): Persona[] {
  const booked = new Set(bookings.map((b) => b.employeeId));
  const planned = new Map(plans.map((p) => [p.employeeId, p]));
  const byId = new Map(employees.map((e) => [e.id, e]));
  const managerHires = new Set(managerHireIds);
  const sortedIds = employees.map((e) => e.id).sort();
  const first = (pred: (e: OrgEmployee) => boolean): OrgEmployee => {
    for (const id of sortedIds) {
      const e = byId.get(id) as OrgEmployee;
      if (pred(e)) return e;
    }
    throw new Error("persona not found");
  };
  const started = (e: OrgEmployee) => (planned.get(e.id)?.startDate ?? "9999") <= asOf;
  const unbooked = first(
    (e) => e.role === "employee" && planned.has(e.id) && !booked.has(e.id) && started(e) && !managerHires.has(e.id),
  );
  const bookedHire = first((e) => e.role === "employee" && planned.has(e.id) && booked.has(e.id) && !managerHires.has(e.id));
  const tenured = first((e) => e.role === "employee" && !planned.has(e.id) && e.managerId !== MANAGER_WITH_NEW_HIRES);
  const hr = first((e) => e.role === "hr_admin");
  const mk = (key: PersonaKey, e: OrgEmployee, description: string): Persona => ({
    key,
    employeeId: e.id,
    email: e.email,
    fullName: e.fullName,
    role: e.role,
    description,
  });
  return [
    mk("new_hire_unbooked", unbooked, "Employee in onboarding with no orientation booking"),
    mk("new_hire_booked", bookedHire, "Employee in onboarding who already booked orientation"),
    mk("tenured_employee", tenured, "Employee with no onboarding plan"),
    mk(
      "manager_with_new_hires",
      byId.get(MANAGER_WITH_NEW_HIRES) as OrgEmployee,
      "Manager with five direct reports in onboarding, three of them unbooked",
    ),
    mk("manager_no_new_hires", byId.get(MANAGER_NO_NEW_HIRES) as OrgEmployee, "Manager with no direct reports in onboarding"),
    mk("hr_admin", hr, "HR administrator with policy clearance 3"),
  ];
}

const TICKET_TEMPLATES: Record<TicketCategory, ReadonlyArray<[string, string]>> = {
  it: [
    ["Laptop will not boot", "My laptop shows a black screen after the logo and will not start."],
    ["VPN disconnects every few minutes", "The VPN client drops the connection about every five minutes."],
    ["Monitor not detected", "My second monitor is not detected after the latest system update."],
    ["Password reset loop", "The password reset page keeps sending me back to the login screen."],
  ],
  payroll: [
    ["Missing overtime on pay statement", "Overtime from last month is not on my latest pay statement."],
    ["Update direct deposit account", "I need to change the bank account for my direct deposit."],
    ["Tax withholding question", "My tax withholding looks different from last month."],
  ],
  benefits: [
    ["Add a dependent to health plan", "I would like to add my newborn child to my health insurance plan."],
    ["Wellness stipend claim status", "I submitted a wellness stipend claim and have not heard back."],
    ["Retirement contribution change", "I want to change my retirement plan contribution rate."],
  ],
  facilities: [
    ["Desk chair is broken", "The height adjustment on my desk chair no longer works."],
    ["Badge does not open the third floor", "My access badge does not open the third floor doors."],
    ["Meeting room display broken", "The display in the large meeting room does not turn on."],
  ],
  hr_general: [
    ["Question about leave balance", "My leave balance looks lower than I expected."],
    ["Update emergency contact", "I need to update my emergency contact details."],
    ["Request employment verification letter", "I need an employment verification letter for a rental application."],
  ],
  access_request: [
    ["Access to the analytics dashboard", "I need read access to the analytics dashboard for my new project."],
    ["Shared drive permissions", "Please grant me edit access to the team shared drive."],
    ["Admin rights for build tools", "I need admin rights to install the approved build tools."],
  ],
};
const TICKET_CATEGORY_LIST = Object.keys(TICKET_TEMPLATES) as TicketCategory[];
const PERSONA_TICKET_COUNTS: Record<PersonaKey, number> = {
  new_hire_unbooked: 3,
  new_hire_booked: 3,
  tenured_employee: 5,
  manager_with_new_hires: 4,
  manager_no_new_hires: 3,
  hr_admin: 3,
};

function buildTickets(asOf: string, employees: OrgEmployee[], personas: Persona[]): SeedTicket[] {
  const r = rng("org/tickets");
  const personaIds = new Set(personas.map((p) => p.employeeId));
  const requesters: string[] = [];
  for (const p of personas) for (let i = 0; i < PERSONA_TICKET_COUNTS[p.key]; i++) requesters.push(p.employeeId);
  const pool = employees.filter((e) => !personaIds.has(e.id)).map((e) => e.id);
  while (requesters.length < 150) requesters.push(r.pick(pool));
  const drafts = requesters.map((requesterId, i) => {
    const tr = rng(`org/tickets/${i}`);
    const category = tr.pick(TICKET_CATEGORY_LIST);
    const [subject, description] = tr.pick(TICKET_TEMPLATES[category]);
    const createdDaysAgo = tr.int(1, 200);
    const x = tr.next();
    const status: TicketStatus = x < 0.25 ? "open" : x < 0.45 ? "in_progress" : x < 0.8 ? "resolved" : "closed";
    const y = tr.next();
    const priority: TicketPriority = y < 0.3 ? "low" : y < 0.85 ? "normal" : "high";
    const createdAt = atUtc(addDays(asOf, -createdDaysAgo), tr.int(8, 18), tr.int(0, 59));
    const updatedDaysAgo = status === "open" ? createdDaysAgo : Math.max(0, createdDaysAgo - tr.int(0, Math.min(30, createdDaysAgo)));
    const relatedCategory = category === "benefits" ? "benefits" : category === "payroll" ? "compensation" : null;
    const relatedPolicyId =
      relatedCategory && tr.chance(0.5)
        ? `POL-${pad(POLICY_CATEGORIES.indexOf(relatedCategory) * 10 + tr.int(1, 7), 3)}`
        : null;
    return {
      requesterId,
      category,
      subject,
      description,
      priority,
      status,
      relatedPolicyId,
      createdAt,
      updatedAt: atUtc(addDays(asOf, -updatedDaysAgo), tr.int(8, 18), tr.int(0, 59)),
      tieBreak: i,
    };
  });
  drafts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.tieBreak - b.tieBreak));
  return drafts.map((d, i) => ({
    id: `TKT-${pad(i + 1, 6)}`,
    requesterId: d.requesterId,
    category: d.category,
    subject: d.subject,
    description: d.description,
    priority: d.priority,
    status: d.status,
    relatedPolicyId: d.relatedPolicyId,
    createdVia: "seed",
    createdAt: d.createdAt,
    updatedAt: d.updatedAt < d.createdAt ? d.createdAt : d.updatedAt,
  }));
}

export function generateOrg(asOf: string): Org {
  const employees = buildEmployees(asOf);
  const { plans, tasks, newHireIds, managerHireIds } = buildOnboarding(asOf, employees);
  const sessions = buildSessions(asOf, employees);
  const bookings = buildBookings(asOf, employees, sessions, newHireIds, managerHireIds);
  const personas = pickPersonas(employees, plans, bookings, managerHireIds, asOf);
  const tickets = buildTickets(asOf, employees, personas);
  return { asOf, employees, onboardingPlans: plans, onboardingTasks: tasks, sessions, bookings, tickets, personas };
}

/** Employees whose manager is `managerId`. */
export function directReports(org: Pick<Org, "employees">, managerId: string): OrgEmployee[] {
  return org.employees.filter((e) => e.managerId === managerId);
}
