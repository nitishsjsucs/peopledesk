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
      { path: "/api/onboarding", status: 404, body: { error: { code: "not_found", message: "No onboarding plan found.", requestId: "r" } } },
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
