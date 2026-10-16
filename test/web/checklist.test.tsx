// groupChecklist: the one definition of overdue, due soon and waiting that My checklist, the manager
// and HR checklist pane and Home share.
import { describe, expect, it } from "vitest";
import type { OnboardingProgress } from "../../src/shared/api-types.ts";
import { addDaysIso } from "../../src/shared/dates.ts";
import { groupChecklist, nextForYou, planLine, taskOwner, waitingText } from "../../src/web/lib/checklist.ts";
import type { GroupedChecklist } from "../../src/web/lib/checklist.ts";
import { AS_OF, progressFor } from "./seed.ts";

type Task = OnboardingProgress["tasks"][number];
const task = (id: string, over: Partial<Task>): Task => ({ id, title: `Task ${id}`, category: "paperwork", ownerRole: "employee", dueDate: AS_OF, status: "pending", ...over });
const plan = (tasks: Task[]): OnboardingProgress => ({
  employeeId: "E0101",
  fullName: "Ana Lima",
  startDate: "2026-09-01",
  targetCompletionDate: "2026-11-30",
  percentComplete: 0,
  counts: { done: 0, inProgress: 0, pending: tasks.length, blocked: 0 },
  tasks,
});
const titles = (g: GroupedChecklist) => Object.fromEntries(g.groups.map((x) => [x.key, x.items.map((i) => i.task.title)]));

describe("groupChecklist", () => {
  it("places open tasks by due date at the edges: asOf - 1 overdue, asOf and asOf + 7 in the next 7 days, asOf + 8 later", () => {
    const g = groupChecklist(
      plan([
        task("a", { title: "Yesterday", dueDate: addDaysIso(AS_OF, -1) }),
        task("b", { title: "Today", dueDate: AS_OF }),
        task("c", { title: "In seven", dueDate: addDaysIso(AS_OF, 7) }),
        task("d", { title: "In eight", dueDate: addDaysIso(AS_OF, 8) }),
      ]),
      { relation: "self", asOf: AS_OF, booked: true },
    );
    expect(titles(g)).toEqual({ overdue: ["Yesterday"], next7: ["Today", "In seven"], later: ["In eight"] });
    const today = g.groups[1]!.items[0]!;
    expect([today.overdue, today.dueToday]).toEqual([false, true]);
    expect(g.overdue).toBe(1);
  });

  it("files every status: done to Done, and pending, in progress and blocked by date", () => {
    const g = groupChecklist(
      plan([
        task("a", { title: "Done late", status: "done", dueDate: addDaysIso(AS_OF, -20) }),
        task("b", { title: "Blocked", status: "blocked", dueDate: addDaysIso(AS_OF, -2) }),
        task("c", { title: "Started", status: "in_progress", dueDate: addDaysIso(AS_OF, 3) }),
        task("d", { title: "Not started", status: "pending", dueDate: addDaysIso(AS_OF, 30) }),
      ]),
      { relation: "self", asOf: AS_OF, booked: true },
    );
    expect(titles(g)).toEqual({ overdue: ["Blocked"], next7: ["Started"], later: ["Not started"], done: ["Done late"] });
    // A done task is never overdue, whatever its due date.
    expect(g.overdue).toBe(1);
    expect(g.done).toBe(1);
  });

  it("names owners relative to the viewer", () => {
    expect(["employee", "manager", "hr_admin", "it"].map((r) => taskOwner(r as Task["ownerRole"], "self"))).toEqual(["You", "Your manager", "HR", "IT"]);
    expect(["employee", "manager", "hr_admin", "it"].map((r) => taskOwner(r as Task["ownerRole"], "manager"))).toEqual(["New hire", "You", "HR", "IT"]);
    expect(["employee", "manager", "hr_admin", "it"].map((r) => taskOwner(r as Task["ownerRole"], "hr"))).toEqual(["New hire", "Their manager", "You", "IT"]);
  });

  it("makes an unbooked orientation task the hire's own, with Book orientation, and waits on HR once booked", () => {
    const orientation = task("o", { title: "Attend new hire orientation", category: "orientation", ownerRole: "hr_admin", dueDate: addDaysIso(AS_OF, 20) });
    const unbooked = groupChecklist(plan([orientation]), { relation: "self", asOf: AS_OF, booked: false });
    expect(unbooked.groups.map((x) => x.key)).toEqual(["later"]);
    expect(unbooked.groups[0]!.items[0]).toMatchObject({ owner: "You", action: "book" });
    const booked = groupChecklist(plan([orientation]), { relation: "self", asOf: AS_OF, booked: true });
    expect(booked.groups.map((x) => x.key)).toEqual(["waiting"]);
    expect(booked.groups[0]!.items[0]).toMatchObject({ owner: "HR", action: null });
    expect(booked.waiting).toEqual([{ owner: "HR", count: 1 }]);
    // A manager sees it by date, owned by HR, with Book orientation while unbooked.
    const manager = groupChecklist(plan([orientation]), { relation: "manager", asOf: AS_OF, booked: false });
    expect(manager.groups[0]!.items[0]).toMatchObject({ owner: "HR", action: "book", group: "later" });
  });

  it("offers Open a ticket on an open IT task only", () => {
    const g = groupChecklist(
      plan([task("i", { ownerRole: "it", category: "it_setup" }), task("j", { ownerRole: "it", category: "it_setup", status: "done" })]),
      { relation: "self", asOf: AS_OF, booked: true },
    );
    expect(g.groups.flatMap((x) => x.items.map((i) => i.action))).toEqual(["ticket", null]);
  });

  it("has no waiting group for a manager or HR, and leaves out empty groups", () => {
    const g = groupChecklist(progressFor("E0036"), { relation: "manager", asOf: AS_OF, booked: false });
    expect(g.groups.map((x) => x.key)).toEqual(["overdue", "next7", "later", "done"]);
    expect(g.groups[0]!.items.map((i) => [i.task.title, i.owner])).toEqual([
      ["Submit tax and payroll forms", "New hire"],
      ["First one-on-one with your manager", "You"],
      ["Code of conduct training", "New hire"],
    ]);
    expect(g.groups[2]!.items.map((i) => [i.task.title, i.action])).toEqual([["Attend new hire orientation", "book"]]);
    expect(groupChecklist(progressFor("E0036"), { relation: "hr", asOf: AS_OF, booked: false }).groups[0]!.items[1]!.owner).toBe("Their manager");
    expect(groupChecklist(plan([]), { relation: "self", asOf: AS_OF, booked: true }).groups).toEqual([]);
  });

  it("groups Nadia's seeded checklist: 1 overdue of her own, 2 waiting on her manager, 9 done", () => {
    const nadia = progressFor("E0025");
    const g = groupChecklist(nadia, { relation: "self", asOf: AS_OF, booked: false });
    expect(g.groups.map((x) => [x.key, x.items.length])).toEqual([
      ["overdue", 1],
      ["waiting", 2],
      ["done", 9],
    ]);
    expect(g.groups[0]!.items[0]).toMatchObject({ task: { title: "Attend new hire orientation", dueDate: "2026-09-21" }, owner: "You", overdue: true, action: "book" });
    expect(g.groups[1]!.items.map((i) => [i.task.title, i.owner, i.task.status, i.overdue])).toEqual([
      ["First one-on-one with your manager", "Your manager", "blocked", true],
      ["Team introductions", "Your manager", "blocked", true],
    ]);
    expect([g.done, g.total, g.overdue]).toEqual([9, 12, 3]);
    expect(planLine(nadia, g, AS_OF)).toBe("Day 55 of 90 · target Nov 5, 2026 · 9 of 12 done · 3 overdue");
    expect(waitingText(g.waiting)).toBe("2 waiting on your manager");
    expect(nextForYou(g)?.task.title).toBe("Attend new hire orientation");
  });

  it("groups Gabriel's seeded checklist: 2 overdue, 2 due soon, 1 later, 4 waiting, 3 done", () => {
    const gabriel = progressFor("E0022");
    const g = groupChecklist(gabriel, { relation: "self", asOf: AS_OF, booked: true });
    expect(titles(g)).toEqual({
      overdue: ["Enroll in multi-factor authentication", "Submit tax and payroll forms"],
      next7: ["Security awareness training", "Code of conduct training"],
      later: ["Benefits enrollment"],
      waiting: ["First one-on-one with your manager", "Team introductions", "30-day check-in with HR", "Attend new hire orientation"],
      done: ["Sign employment agreement", "Laptop and accounts setup", "Meet your onboarding buddy"],
    });
    const intros = g.groups[3]!.items[1]!;
    expect([intros.dueToday, intros.overdue]).toEqual([true, false]);
    expect(g.groups[3]!.items[0]).toMatchObject({ overdue: true, task: { status: "blocked" } });
    expect(planLine(gabriel, g, AS_OF)).toBe("Day 10 of 90 · target Dec 20, 2026 · 3 of 12 done · 3 overdue");
    expect(waitingText(g.waiting)).toBe("4 waiting on others: your manager 2, HR 2");
    expect(nextForYou(g)?.task.title).toBe("Enroll in multi-factor authentication");
  });

  it("says when a plan starts, and how far past its target it ran", () => {
    const counts = { total: 12, done: 0, overdue: 0 };
    expect(planLine({ startDate: "2026-10-16", targetCompletionDate: "2027-01-14" }, counts, AS_OF)).toBe("Starts Oct 16, 2026, in 15 days · 0 of 12 done");
    expect(planLine({ startDate: "2026-06-01", targetCompletionDate: "2026-08-30" }, { ...counts, done: 11, overdue: 1 }, AS_OF)).toBe(
      "32 days past the target date of Aug 30, 2026 · 11 of 12 done · 1 overdue",
    );
  });
});
