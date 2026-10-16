import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Me } from "../../src/shared/api-types.ts";
import { MeContext } from "../../src/web/lib/session.tsx";
import { HomePage } from "../../src/web/pages/HomePage.tsx";
import { installFetch, me, pendingTicket } from "./fixtures.ts";
import type { Route } from "./fixtures.ts";

const renderHome = (who: Me = me) =>
  render(
    <MemoryRouter>
      <MeContext.Provider value={who}>
        <HomePage />
      </MeContext.Provider>
    </MemoryRouter>,
  );

const noPending: Route = { path: "/api/actions?status=awaiting_approval", body: { actions: [] } };
const member = (employeeId: string, inOnboarding: boolean, booked: boolean) => ({
  employeeId,
  fullName: `Person ${employeeId}`,
  inOnboarding,
  booked,
  percentComplete: inOnboarding ? 40 : null,
  blockedTasks: 0,
});
const progress = (percent: number) => ({
  employeeId: "E0025",
  fullName: "Nadia Fernandes",
  startDate: "2026-09-01",
  targetCompletionDate: "2026-11-30",
  percentComplete: percent,
  counts: { done: 5, inProgress: 1, pending: 6, blocked: 0 },
  tasks: [],
});
const booking = {
  sessionId: "ORI-008",
  title: "New Hire Orientation (US, in person)",
  startsAt: "2026-10-31T16:00:00.000Z",
  durationMin: 120,
  format: "in_person",
  region: "US",
  location: "Austin Office, Training Room 2",
};

const newHire: Me = { ...me, employeeId: "E0025", fullName: "Nadia Fernandes", inOnboarding: true };
const manager: Me = { ...me, employeeId: "E0007", fullName: "Deepa Foster", role: "manager", directReportIds: ["E0031", "E0032", "E0033", "E0034"] };
const hrAdmin: Me = { ...me, employeeId: "E0016", fullName: "Kenji Nakamura", role: "hr_admin" };

const link = (name: string) => screen.queryByRole("link", { name: new RegExp(`^${name}`) });

describe("HomePage", () => {
  it("greets with the role badge and counts requests awaiting approval", async () => {
    const calls = installFetch([{ path: "/api/actions?status=awaiting_approval", body: { actions: [pendingTicket(), pendingTicket({ actionId: crypto.randomUUID() })] } }]);
    renderHome();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Hello, Emeka");
    expect(screen.getByText("Employee")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Checking for requests waiting for your approval...");
    expect((await screen.findByTestId("pending-count")).textContent).toContain("2 requests are waiting for your approval.");
    expect(calls[0]?.path).toBe("/api/actions?status=awaiting_approval");
  });

  it("shows an error with Try again when the pending count cannot be loaded", async () => {
    let fail = true;
    const calls = installFetch([
      {
        path: "/api/actions?status=awaiting_approval",
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : { actions: [] }),
      },
    ]);
    renderHome();
    expect((await screen.findByRole("alert")).textContent).toContain("Internal error.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("pending-count")).textContent).toContain("No requests are waiting");
    expect(calls).toHaveLength(2);
  });

  it("offers a tenured employee the everyday actions, and no orientation or onboarding", async () => {
    installFetch([noPending]);
    renderHome();
    await screen.findByTestId("pending-count");
    for (const [name, href] of [
      ["Ask a question", "/chat"],
      ["Policies", "/policies"],
      ["New ticket", "/requests/ticket"],
      ["My tickets", "/tickets"],
    ] as const) {
      expect(link(name)?.getAttribute("href")).toBe(href);
    }
    expect(screen.queryByTestId("quick-book-orientation")).toBeNull();
    expect(screen.queryByTestId("quick-onboarding")).toBeNull();
  });

  it("offers an unbooked new hire orientation, with their onboarding percent", async () => {
    installFetch([noPending, { path: "/api/orientation-booking", body: { booking: null } }, { path: "/api/onboarding", body: progress(42) }]);
    renderHome(newHire);
    const book = await screen.findByTestId("quick-book-orientation");
    expect(book.getAttribute("href")).toBe("/requests/orientation");
    await waitFor(() => expect(screen.getByTestId("quick-onboarding").textContent).toContain("42% complete."));
  });

  it("shows a booked new hire their session instead of a booking action", async () => {
    installFetch([noPending, { path: "/api/orientation-booking", body: { booking } }, { path: "/api/onboarding", body: progress(60) }]);
    renderHome({ ...newHire, employeeId: "E0022", fullName: "Gabriel Kowalski" });
    const own = await screen.findByTestId("quick-own-orientation");
    expect(own.textContent).toContain("New Hire Orientation (US, in person), Oct 31, 2026 16:00 UTC.");
    expect(screen.queryByTestId("quick-book-orientation")).toBeNull();
  });

  it("tells a manager how many reports still need a session", async () => {
    installFetch([
      noPending,
      { path: "/api/team", body: { members: [member("E0031", true, false), member("E0032", true, false), member("E0033", true, true), member("E0034", false, false)] } },
    ]);
    renderHome(manager);
    const book = await screen.findByTestId("quick-book-orientation");
    expect(book.textContent).toContain("2 people need an orientation session.");
    expect(screen.getByTestId("quick-onboarding").textContent).toContain("Your direct reports in onboarding.");
  });

  it("offers a manager without unbooked reports in onboarding no orientation action", async () => {
    installFetch([noPending, { path: "/api/team", body: { members: [member("E0041", false, false)] } }]);
    renderHome({ ...manager, employeeId: "E0014", fullName: "Chen Varma" });
    await screen.findByTestId("pending-count");
    await waitFor(() => expect(screen.getByTestId("quick-onboarding").textContent).toContain("Your direct reports in onboarding."));
    expect(screen.queryByTestId("quick-book-orientation")).toBeNull();
  });

  it("says when a manager's team cannot be checked, with Try again, instead of quietly dropping Book orientation", async () => {
    let fail = true;
    const calls = installFetch([
      noPending,
      {
        path: "/api/team",
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : { members: [member("E0031", true, false)] }),
      },
    ]);
    renderHome(manager);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not check who you support still needs an orientation session. Internal error.Try again");
    expect(screen.queryByTestId("quick-book-orientation")).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("quick-book-orientation")).textContent).toContain("1 person needs an orientation session.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls.filter((c) => c.path === "/api/team")).toHaveLength(2);
  });

  it("says when a new hire's booking cannot be checked, with Try again", async () => {
    let fail = true;
    installFetch([
      noPending,
      { path: "/api/onboarding", body: progress(60) },
      {
        path: "/api/orientation-booking",
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : { booking }),
      },
    ]);
    renderHome({ ...newHire, employeeId: "E0022", fullName: "Gabriel Kowalski" });
    expect((await screen.findByRole("alert")).textContent).toContain("Could not check your orientation booking. Internal error.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("quick-own-orientation")).textContent).toContain("New Hire Orientation (US, in person)");
  });

  it("describes HR's onboarding scope as everyone in onboarding", async () => {
    installFetch([noPending, { path: "/api/team", body: { members: [member("E0031", true, false)] } }]);
    renderHome(hrAdmin);
    expect((await screen.findByTestId("quick-onboarding")).textContent).toContain("Everyone in onboarding.");
    expect((await screen.findByTestId("quick-book-orientation")).textContent).toContain("1 person needs an orientation session.");
  });
});
