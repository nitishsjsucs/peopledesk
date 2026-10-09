import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { OnboardingProgress } from "../../src/shared/api-types.ts";
import { MeContext } from "../../src/web/lib/session.tsx";
import { OnboardingPage } from "../../src/web/pages/OnboardingPage.tsx";
import { installFetch, me } from "./fixtures.ts";

const progress = (employeeId: string, fullName: string, percent: number): OnboardingProgress => ({
  employeeId,
  fullName,
  startDate: "2026-09-01",
  targetCompletionDate: "2026-11-30",
  percentComplete: percent,
  counts: { done: 6, inProgress: 2, pending: 4, blocked: 0 },
  tasks: [{ id: `ONB-${employeeId}-01`, title: "Sign employment agreement", category: "paperwork", ownerRole: "employee", dueDate: "2026-08-25", status: "done" }],
});

describe("OnboardingPage manager view", () => {
  it("lists direct reports in onboarding and shows the selected person's checklist", async () => {
    const manager = { ...me, employeeId: "E0007", fullName: "Deepa Foster", role: "manager" as const, directReportIds: ["E0031", "E0032"] };
    installFetch([
      {
        path: "/api/team",
        body: {
          members: [
            { employeeId: "E0031", fullName: "Priya Patel", inOnboarding: true, booked: false },
            { employeeId: "E0032", fullName: "Rahul Mehta", inOnboarding: true, booked: true },
            { employeeId: "E0040", fullName: "Not Onboarding", inOnboarding: false, booked: false },
          ],
        },
      },
      { path: "/api/onboarding/E0031", body: progress("E0031", "Priya Patel", 50) },
      { path: "/api/onboarding/E0032", body: progress("E0032", "Rahul Mehta", 75) },
    ]);
    render(
      <MemoryRouter>
        <MeContext.Provider value={manager}>
          <OnboardingPage />
        </MeContext.Provider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/50% complete/)).toBeTruthy();
    expect(screen.queryByText("Not Onboarding")).toBeNull();
    expect(screen.getByText("not booked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rahul Mehta" }));
    expect(await screen.findByText(/75% complete/)).toBeTruthy();
    expect(screen.queryByText("My checklist")).toBeNull();
  });
});

describe("OnboardingPage own checklist", () => {
  const renderAs = (who: typeof me) =>
    render(
      <MemoryRouter>
        <MeContext.Provider value={who}>
          <OnboardingPage />
        </MeContext.Provider>
      </MemoryRouter>,
    );

  it("shows the checklist of an employee in onboarding", async () => {
    const newHire = { ...me, employeeId: "E0025", fullName: "Nadia Fernandes", inOnboarding: true };
    const calls = installFetch([{ path: "/api/onboarding", body: progress("E0025", "Nadia Fernandes", 40) }]);
    renderAs(newHire);
    expect(await screen.findByText(/40% complete/)).toBeTruthy();
    expect(screen.getByText("My checklist")).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(["/api/onboarding"]);
  });

  // /api/me already says whether the caller has a plan, so the page does not ask for one it knows
  // would be a 404 (a manager or HR admin opening the page used to log a failed request every time).
  it("does not request the checklist of a manager whom /api/me reports without a plan", async () => {
    const manager = { ...me, employeeId: "E0014", fullName: "Chen Varma", role: "manager" as const, inOnboarding: false };
    const calls = installFetch([{ path: "/api/team", body: { members: [] } }]);
    renderAs(manager);
    expect(await screen.findByText("No one you support is in onboarding")).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(["/api/team"]);
  });

  it("does not request the checklist of an employee whom /api/me reports without a plan", async () => {
    const calls = installFetch([]);
    renderAs(me);
    expect(screen.getByText("You don't have an onboarding plan")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });
});
