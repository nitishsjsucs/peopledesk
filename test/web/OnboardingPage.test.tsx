import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { OnboardingProgress } from "../../src/shared/api-types.ts";
import { MeContext } from "../../src/web/lib/session.tsx";
import { OnboardingPage } from "../../src/web/pages/OnboardingPage.tsx";
import { installFetch, me } from "./fixtures.ts";
import type { Route } from "./fixtures.ts";

const progress = (employeeId: string, fullName: string, percent: number, blocked = 0): OnboardingProgress => ({
  employeeId,
  fullName,
  startDate: "2026-09-01",
  targetCompletionDate: "2026-11-30",
  percentComplete: percent,
  counts: { done: 6, inProgress: 2, pending: 4 - blocked, blocked },
  tasks: [{ id: `ONB-${employeeId}-01`, title: "Sign employment agreement", category: "paperwork", ownerRole: "employee", dueDate: "2026-08-25", status: "done" }],
});

const member = (employeeId: string, fullName: string, inOnboarding: boolean, booked: boolean, percentComplete: number | null = 50, blockedTasks = 0) => ({
  employeeId,
  fullName,
  inOnboarding,
  booked,
  percentComplete: inOnboarding ? percentComplete : null,
  blockedTasks,
});

const manager = { ...me, employeeId: "E0007", fullName: "Deepa Foster", role: "manager" as const, directReportIds: ["E0031", "E0032", "E0033"] };
const team = {
  members: [
    member("E0031", "Priya Patel", true, false, 50, 0),
    member("E0032", "Rahul Mehta", true, true, 75, 2),
    member("E0033", "Sara Kim", true, false, 25, 1),
    member("E0040", "Not Onboarding", false, false),
  ],
};

const renderAs = (who: typeof me) =>
  render(
    <MemoryRouter>
      <MeContext.Provider value={who}>
        <OnboardingPage />
      </MeContext.Provider>
    </MemoryRouter>,
  );

const teamRoutes = (extra: Route[] = []): Route[] => [
  ...extra,
  { path: "/api/team", body: team },
  { path: "/api/onboarding/E0031", body: progress("E0031", "Priya Patel", 50) },
  { path: "/api/onboarding/E0032", body: progress("E0032", "Rahul Mehta", 75, 2) },
  { path: "/api/onboarding/E0033", body: progress("E0033", "Sara Kim", 25, 1) },
];

const people = () => within(screen.getByRole("list", { name: "People in onboarding" }));

describe("OnboardingPage manager view", () => {
  it("summarizes the people in onboarding and shows the selected person's checklist", async () => {
    installFetch(teamRoutes());
    renderAs(manager);
    expect(await screen.findByText(/50% complete · 6 done/)).toBeTruthy();
    expect(screen.getByTestId("onboarding-summary").textContent).toBe("3 in onboarding · 2 without orientation · 2 with blocked tasks");
    expect(screen.queryByText("Not Onboarding")).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("Onboarding progress for Priya Patel");
    fireEvent.click(people().getByRole("button", { name: "Rahul Mehta" }));
    expect(await screen.findByText(/75% complete · 6 done/)).toBeTruthy();
    expect(screen.queryByText("My checklist")).toBeNull();
  });

  it("filters to the people without a booking, each with a Book orientation link for them", async () => {
    installFetch(teamRoutes());
    renderAs(manager);
    await screen.findByText(/50% complete · 6 done/);
    const notBooked = screen.getByRole("button", { name: "Not booked (2)" });
    expect(notBooked.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(notBooked);
    expect(notBooked.getAttribute("aria-pressed")).toBe("true");
    expect(people().getAllByRole("button").map((b) => b.textContent)).toEqual(["Priya Patel", "Sara Kim"]);
    expect(people().getByRole("link", { name: "Book orientation for Priya Patel" }).getAttribute("href")).toBe("/requests/orientation?employee=E0031");
    expect(people().getByRole("link", { name: "Book orientation for Sara Kim" }).getAttribute("href")).toBe("/requests/orientation?employee=E0033");
    fireEvent.click(screen.getByRole("button", { name: "Has blocked tasks (2)" }));
    expect(people().getAllByRole("button").map((b) => b.textContent)).toEqual(["Rahul Mehta", "Sara Kim"]);
    expect(people().getByText(/2 blocked/)).toBeTruthy();
    // A booked person has no Book link.
    expect(people().queryByRole("link", { name: "Book orientation for Rahul Mehta" })).toBeNull();
  });

  it("never shows the previous person's checklist while the next one loads", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    installFetch(teamRoutes([{ path: "/api/onboarding/E0032", body: async () => (await held, progress("E0032", "Rahul Mehta", 75, 2)) }]));
    renderAs(manager);
    await screen.findByText(/50% complete · 6 done/);
    fireEvent.click(people().getByRole("button", { name: "Rahul Mehta" }));
    expect((await screen.findByRole("status")).textContent).toBe("Loading Rahul Mehta's checklist...");
    expect(screen.queryByText(/50% complete · 6 done/)).toBeNull();
    release();
    expect(await screen.findByText(/75% complete · 6 done/)).toBeTruthy();
  });

  it("shows an error with Try again when a checklist cannot be loaded, never an endless Loading", async () => {
    let fail = true;
    const calls = installFetch(
      teamRoutes([
        {
          path: "/api/onboarding/E0031",
          status: () => (fail ? 500 : 200),
          body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : progress("E0031", "Priya Patel", 50)),
        },
      ]),
    );
    renderAs(manager);
    expect((await screen.findByRole("alert")).textContent).toContain("Internal error.");
    expect(screen.queryByText(/Loading/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/50% complete · 6 done/)).toBeTruthy();
    expect(calls.filter((c) => c.path === "/api/onboarding/E0031")).toHaveLength(2);
  });

  it("names HR's scope as everyone in onboarding", async () => {
    installFetch(teamRoutes());
    renderAs({ ...me, employeeId: "E0016", fullName: "Kenji Nakamura", role: "hr_admin" });
    expect(await screen.findByRole("heading", { level: 2, name: "Everyone in onboarding" })).toBeTruthy();
  });
});

describe("OnboardingPage own checklist", () => {
  it("shows the checklist of an employee in onboarding, and whether orientation is booked", async () => {
    const newHire = { ...me, employeeId: "E0025", fullName: "Nadia Fernandes", inOnboarding: true };
    const calls = installFetch([
      { path: "/api/onboarding", body: progress("E0025", "Nadia Fernandes", 40) },
      { path: "/api/orientation-booking", body: { booking: null } },
    ]);
    renderAs(newHire);
    expect(await screen.findByText(/40% complete/)).toBeTruthy();
    expect(screen.getByText("My checklist")).toBeTruthy();
    const orientation = await screen.findByTestId("own-orientation");
    expect(orientation.textContent).toContain("You have not booked an orientation session yet.");
    expect(within(orientation).getByRole("link", { name: "Book orientation" }).getAttribute("href")).toBe("/requests/orientation");
    expect(calls.map((c) => c.path).sort()).toEqual(["/api/onboarding", "/api/orientation-booking"]);
  });

  it("shows a booked new hire their session", async () => {
    const booked = { ...me, employeeId: "E0022", fullName: "Gabriel Kowalski", inOnboarding: true };
    installFetch([
      { path: "/api/onboarding", body: progress("E0022", "Gabriel Kowalski", 60) },
      {
        path: "/api/orientation-booking",
        body: { booking: { sessionId: "ORI-008", title: "New Hire Orientation (US, in person)", startsAt: "2026-10-31T16:00:00.000Z", durationMin: 120, format: "in_person", region: "US", location: "Austin Office, Training Room 2" } },
      },
    ]);
    renderAs(booked);
    await waitFor(() => expect(screen.getByTestId("own-orientation").textContent).toContain("You're booked into New Hire Orientation (US, in person) (ORI-008)"));
  });

  // /api/me already says whether the caller has a plan, so the page does not ask for one it knows
  // would be a 404 (a manager or HR admin opening the page used to log a failed request every time).
  it("does not request the checklist of a manager whom /api/me reports without a plan", async () => {
    const noReports = { ...me, employeeId: "E0014", fullName: "Chen Varma", role: "manager" as const, inOnboarding: false };
    const calls = installFetch([{ path: "/api/team", body: { members: [] } }]);
    renderAs(noReports);
    expect(await screen.findByText("No one you support is in onboarding")).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(["/api/team"]);
  });

  it("does not request the checklist of an employee whom /api/me reports without a plan", async () => {
    const calls = installFetch([]);
    renderAs(me);
    expect(screen.getByText("You don't have an onboarding plan")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask in chat" }).getAttribute("href")).toBe("/chat");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });
});
