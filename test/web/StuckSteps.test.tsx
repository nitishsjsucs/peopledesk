import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { barPercent, ownerLabel, StuckSteps, stuckSummary } from "../../src/web/components/StuckSteps.tsx";
import { deepaIds, everyoneIds, overviewFor } from "./seed.ts";

const kenjiSteps = overviewFor(everyoneIds).steps;
const deepaSteps = overviewFor(deepaIds).steps;

const rows = () => within(screen.getByRole("table", { name: "Where onboarding is stuck" })).getAllByRole("row").slice(1);
const barOf = (row: HTMLElement, i: 0 | 1) => row.querySelectorAll(".stuck-cell")[i]?.querySelector<HTMLElement>(".stuck-bar") ?? null;

describe("stuckSummary and owner labels", () => {
  it("sums the rows for HR, with owners relative to the viewer, largest first", () => {
    expect(stuckSummary(kenjiSteps, "hr_admin")).toBe("46 stuck tasks: 20 blocked, 26 overdue and not blocked. Owners: New hire 32, Manager 7, HR (you) 5, IT 2");
  });

  it("never calls the not-blocked count plain overdue, since the people's overdue tasks include blocked ones", () => {
    const people = overviewFor(everyoneIds).people;
    const overdueTasks = people.reduce((n, p) => n + p.tasks.overdue, 0);
    const notBlocked = kenjiSteps.reduce((n, s) => n + s.overdueNotBlocked, 0);
    // In the seed every blocked task is also past due, so the two counts differ by the blocked total.
    expect([overdueTasks, notBlocked]).toEqual([46, 26]);
    expect(stuckSummary(kenjiSteps, "hr_admin")).not.toMatch(/\b26 overdue\./);
    expect(stuckSummary(kenjiSteps, "hr_admin")).toContain(`${notBlocked} overdue and not blocked`);
  });

  it("calls a manager's own steps You", () => {
    expect(stuckSummary(deepaSteps, "manager")).toBe("7 stuck tasks: 1 blocked, 6 overdue and not blocked. Owners: New hire 6, You 1");
    expect(ownerLabel("manager", "manager")).toBe("You");
    expect(ownerLabel("manager", "hr_admin")).toBe("Manager");
    expect(ownerLabel("hr_admin", "hr_admin")).toBe("HR (you)");
    expect(ownerLabel("hr_admin", "manager")).toBe("HR");
    expect(ownerLabel("employee", "manager")).toBe("New hire");
    expect(ownerLabel("it", "hr_admin")).toBe("IT");
  });

  it("sizes bars against the largest value in either bar column, with no bar for 0", () => {
    expect(barPercent(6, 6)).toBe(100);
    expect(barPercent(3, 6)).toBe(50);
    expect(barPercent(1, 6)).toBe(16.7);
    expect(barPercent(0, 6)).toBeNull();
  });
});

describe("StuckSteps", () => {
  it("is a table with a caption and column headers, most stuck step first", () => {
    render(<StuckSteps steps={kenjiSteps} viewer="hr_admin" selectedKey={null} onShow={() => {}} />);
    const table = screen.getByRole("table", { name: "Where onboarding is stuck" });
    expect(table.querySelector("caption")?.textContent).toBe("Where onboarding is stuck");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Step", "Owner", "Blocked", "Overdue, not blocked", "Due in 7 days"]);
    expect(headers.every((h) => h.getAttribute("scope") === "col")).toBe(true);
    expect(rows()).toHaveLength(12);
    const first = rows()[0]!;
    expect(within(first).getByRole("button", { name: "Show the 9 people stuck on Enroll in multi-factor authentication" }).textContent).toBe(
      "Enroll in multi-factor authentication",
    );
    expect([...first.querySelectorAll(".stuck-num")].map((n) => n.textContent)).toEqual(["3", "6", "1"]);
    expect(within(rows()[1]!).getByRole("button", { name: "Show the 6 people stuck on First one-on-one with your manager" })).toBeTruthy();
    expect(screen.getByTestId("stuck-summary").textContent).toBe("46 stuck tasks: 20 blocked, 26 overdue and not blocked. Owners: New hire 32, Manager 7, HR (you) 5, IT 2");
  });

  it("draws both bar columns on one scale, hides the bars from assistive technology and draws none for 0", () => {
    render(<StuckSteps steps={kenjiSteps} viewer="hr_admin" selectedKey={null} onShow={() => {}} />);
    const first = rows()[0]!; // 3 blocked, 6 overdue: 6 is the largest value in either column
    expect(barOf(first, 0)?.style.width).toBe("50%");
    expect(barOf(first, 1)?.style.width).toBe("100%");
    expect(barOf(first, 0)?.className).toContain("stuck-bar-blocked");
    expect(barOf(first, 1)?.className).toContain("stuck-bar-overdue");
    const security = rows().find((r) => r.textContent?.includes("Security awareness training"))!;
    expect(barOf(security, 0)).toBeNull();
    expect(security.querySelectorAll(".stuck-num")[0]?.textContent).toBe("0");
    for (const box of document.querySelectorAll(".stuck-bar-box")) expect(box.getAttribute("aria-hidden")).toBe("true");
  });

  it("labels owners relative to a manager and keeps them on a second line for phones", () => {
    render(<StuckSteps steps={deepaSteps} viewer="manager" selectedKey={null} onShow={() => {}} />);
    const oneOnOne = rows().find((r) => r.textContent?.includes("First one-on-one with your manager"))!;
    expect(oneOnOne.querySelector(".col-owner")?.textContent).toBe("You");
    expect(oneOnOne.querySelector(".step-sub")?.textContent).toBe("You · 0 due in 7 days");
    expect(rows()[0]!.textContent).toContain("Submit tax and payroll forms");
    expect(within(rows()[0]!).getByRole("button").getAttribute("aria-label")).toBe("Show the 2 people stuck on Submit tax and payroll forms");
  });

  it("calls back with the step when its button is pressed, and marks the selected step", () => {
    const onShow = vi.fn();
    render(<StuckSteps steps={kenjiSteps} viewer="hr_admin" selectedKey={6} onShow={onShow} />);
    const button = screen.getByRole("button", { name: /stuck on First one-on-one/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /stuck on Enroll in multi-factor/ }));
    expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ stepKey: 3, title: "Enroll in multi-factor authentication" }));
  });

  it("says so when nothing is blocked or overdue", () => {
    render(<StuckSteps steps={[]} viewer="manager" selectedKey={null} onShow={() => {}} />);
    expect(screen.getByTestId("stuck-empty").textContent).toBe("Nothing is blocked or overdue.");
    expect(screen.queryByRole("table")).toBeNull();
  });
});
