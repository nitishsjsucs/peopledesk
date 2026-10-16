import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Me } from "../../src/shared/api-types.ts";
import { BusinessDateContext } from "../../src/web/lib/business-date.tsx";
import type { BusinessDate } from "../../src/web/lib/business-date.tsx";
import { MeContext } from "../../src/web/lib/session.tsx";
import { HomePage } from "../../src/web/pages/HomePage.tsx";
import { installFetch, me, pendingTicket } from "./fixtures.ts";
import type { Route } from "./fixtures.ts";
import { bookingFor, DEEPA, deepaIds, everyoneIds, overviewFor, progressFor } from "./seed.ts";

const ON_ASOF: BusinessDate = { asOf: "2026-10-01", settled: true };

const renderHome = (who: Me = me, date: BusinessDate | null = ON_ASOF) =>
  render(
    <MemoryRouter>
      <MeContext.Provider value={who}>
        <BusinessDateContext.Provider value={date}>
          <HomePage />
        </BusinessDateContext.Provider>
      </MeContext.Provider>
    </MemoryRouter>,
  );

const noPending: Route = { path: "/api/actions?status=awaiting_approval", body: { actions: [] } };
const ownRoutes = (id: string): Route[] => [noPending, { path: "/api/orientation-booking", body: bookingFor(id) }, { path: "/api/onboarding", body: progressFor(id) }];
const emptyOverview = { asOf: "2026-10-01", people: [], steps: [] };

const nadia: Me = { ...me, employeeId: "E0025", fullName: "Nadia Fernandes", inOnboarding: true };
const gabriel: Me = { ...me, employeeId: "E0022", fullName: "Gabriel Kowalski", inOnboarding: true };
const deepa: Me = { ...me, employeeId: DEEPA, fullName: "Deepa Foster", role: "manager", directReportIds: deepaIds };
const chen: Me = { ...me, employeeId: "E0014", fullName: "Chen Varma", role: "manager", directReportIds: ["E0041"] };
const kenji: Me = { ...me, employeeId: "E0016", fullName: "Kenji Nakamura", role: "hr_admin" };

const link = (name: string) => screen.queryByRole("link", { name: new RegExp(`^${name}`) });
const panel = () => screen.getByTestId("your-onboarding");
const tiles = () => within(screen.getByRole("list", { name: "People in onboarding" })).getAllByRole("link");

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

  it("offers a tenured employee the everyday actions, and no orientation or onboarding (Emeka, as before)", async () => {
    const calls = installFetch([noPending]);
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
    expect(screen.queryByTestId("your-onboarding")).toBeNull();
    expect(screen.queryByTestId("team-onboarding")).toBeNull();
    expect(calls.map((c) => c.path)).toEqual(["/api/actions?status=awaiting_approval"]);
  });

  it("shows Nadia her onboarding at a glance, with booking as the next step, and no separate cards for herself", async () => {
    const calls = installFetch(ownRoutes("E0025"));
    renderHome(nadia);
    await waitFor(() => expect(within(panel()).getByTestId("next-for-you").textContent).toBe("Next for you: Book orientation. Your orientation task was due Sep 21, 2026."));
    expect(within(panel()).getByRole("img").getAttribute("aria-label")).toBe("9 of 12 done · 3 overdue · 2 waiting on your manager");
    expect(within(panel()).getByRole("heading", { level: 2, name: "Your onboarding" })).toBeTruthy();
    expect(within(panel()).getByRole("link", { name: "Book orientation" }).getAttribute("href")).toBe("/requests/orientation");
    expect(within(panel()).getByRole("link", { name: "View checklist" }).getAttribute("href")).toBe("/onboarding");
    expect(within(panel()).getByTestId("home-orientation").textContent).toBe("Orientation: not booked yet.");
    expect(screen.queryByTestId("quick-book-orientation")).toBeNull();
    expect(screen.queryByTestId("quick-onboarding")).toBeNull();
    expect(screen.queryByTestId("quick-own-orientation")).toBeNull();
    expect(calls.map((c) => c.path).sort()).toEqual(["/api/actions?status=awaiting_approval", "/api/onboarding", "/api/orientation-booking"]);
  });

  it("shows Gabriel what is overdue, who he waits on, and when his session is", async () => {
    installFetch(ownRoutes("E0022"));
    renderHome(gabriel);
    await waitFor(() => expect(within(panel()).getByTestId("next-for-you").textContent).toBe("Next for you: Enroll in multi-factor authentication, overdue since Sep 22, 2026"));
    expect(within(panel()).getByRole("img").getAttribute("aria-label")).toBe("3 of 12 done · 3 overdue · 4 waiting on others: your manager 2, HR 2");
    expect(within(panel()).getByTestId("home-orientation").textContent).toBe("Orientation: Oct 31, 2026 16:00 UTC, in 30 days");
    expect(within(panel()).queryByRole("link", { name: "Book orientation" })).toBeNull();
  });

  it("says orientation is done, with no Book orientation, for a new hire whose orientation task is done without a booking", async () => {
    // Mateo Foster (E0064): orientation task done in the seed, no booking.
    installFetch(ownRoutes("E0064"));
    renderHome({ ...me, employeeId: "E0064", fullName: "Mateo Foster", inOnboarding: true });
    await waitFor(() => expect(within(panel()).getByTestId("home-orientation").textContent).toBe("Orientation: done."));
    expect(within(panel()).queryByRole("link", { name: "Book orientation" })).toBeNull();
    expect(within(panel()).getByTestId("next-for-you").textContent).not.toContain("Book orientation");
  });

  it("shows done counts only, never overdue or waiting, while the business date is unknown or /api/health failed", async () => {
    installFetch(ownRoutes("E0025"));
    const view = renderHome(nadia, { asOf: null, settled: false });
    await waitFor(() => expect(within(panel()).getByRole("img").getAttribute("aria-label")).toBe("9 of 12 done"));
    expect(screen.queryByTestId("next-for-you")).toBeNull();
    view.unmount();
    installFetch(ownRoutes("E0025"));
    renderHome(nadia, { asOf: null, settled: true });
    await waitFor(() => expect(within(panel()).getByRole("img").getAttribute("aria-label")).toBe("9 of 12 done"));
    expect(panel().textContent).not.toMatch(/overdue|waiting/);
    expect(within(panel()).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Done", "Not done"]);
  });

  it("gives Deepa tiles that open the filtered Onboarding view, and keeps Book orientation for her reports", async () => {
    const calls = installFetch([noPending, { path: "/api/team/onboarding", body: overviewFor(deepaIds) }]);
    renderHome(deepa);
    const team = await screen.findByTestId("team-onboarding");
    expect(team.textContent).toContain("5 in onboarding");
    expect(tiles().map((a) => [a.getAttribute("aria-label"), a.getAttribute("href"), a.querySelector(".stat-value")?.textContent])).toEqual([
      ["3 not booked, 3 people who need orientation, show them", "/onboarding?show=unbooked", "3"],
      ["1 with blocked tasks, 1 person, show them", "/onboarding?show=blocked", "1"],
      ["3 with overdue tasks, 3 people, show them", "/onboarding?show=overdue", "3"],
    ]);
    expect(within(team).getByRole("link", { name: "See everyone" }).getAttribute("href")).toBe("/onboarding");
    expect(screen.queryByTestId("quick-onboarding")).toBeNull();
    expect(screen.getByTestId("quick-book-orientation").textContent).toContain("3 people need an orientation session.");
    expect(calls.map((c) => c.path).sort()).toEqual(["/api/actions?status=awaiting_approval", "/api/team/onboarding"]);
    expect(calls.some((c) => c.path === "/api/team")).toBe(false);
  });

  it("gives Kenji 30 in onboarding with 8, 14 and 19 (no one whose orientation task is done counts as needing a session)", async () => {
    installFetch([noPending, { path: "/api/team/onboarding", body: overviewFor(everyoneIds) }]);
    renderHome(kenji);
    expect((await screen.findByTestId("team-onboarding")).textContent).toContain("30 in onboarding");
    expect(tiles().map((a) => a.querySelector(".stat-value")?.textContent)).toEqual(["8", "14", "19"]);
    expect(screen.getByTestId("quick-book-orientation").textContent).toContain("8 people need an orientation session.");
  });

  it("shows a zero tile as 0 with a check, still a link", async () => {
    const none = overviewFor(deepaIds);
    for (const p of none.people) p.tasks.blocked = 0;
    installFetch([noPending, { path: "/api/team/onboarding", body: none }]);
    renderHome(deepa);
    await screen.findByTestId("team-onboarding");
    const zero = screen.getByRole("link", { name: "0 with blocked tasks, 0 people, show them" });
    expect(zero.querySelector(".stat-value")?.textContent).toBe("0");
    expect(zero.getAttribute("href")).toBe("/onboarding?show=blocked");
    expect(zero.querySelector("svg path")?.getAttribute("d")).toBe("M4.5 12.5l5 5 10-11");
  });

  it("keeps Chen's Home as before: the Onboarding card and no tiles or Book orientation", async () => {
    installFetch([noPending, { path: "/api/team/onboarding", body: emptyOverview }]);
    renderHome(chen);
    await waitFor(() => expect(screen.getByTestId("quick-onboarding").textContent).toContain("Your direct reports in onboarding."));
    expect(screen.queryByTestId("team-onboarding")).toBeNull();
    expect(screen.queryByTestId("quick-book-orientation")).toBeNull();
  });

  it("says when a manager's team cannot be checked, with Try again, instead of quietly dropping Book orientation", async () => {
    let fail = true;
    const calls = installFetch([
      noPending,
      {
        path: "/api/team/onboarding",
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : overviewFor(["E0024"])),
      },
    ]);
    renderHome(deepa);
    expect((await screen.findByRole("alert")).textContent).toBe("Could not check who you support still needs an orientation session. Internal error.Try again");
    expect(screen.queryByTestId("quick-book-orientation")).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("quick-book-orientation")).textContent).toContain("1 person needs an orientation session.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls.filter((c) => c.path === "/api/team/onboarding")).toHaveLength(2);
  });

  it("says when a new hire's booking cannot be checked, with Try again", async () => {
    let fail = true;
    installFetch([
      noPending,
      { path: "/api/onboarding", body: progressFor("E0022") },
      {
        path: "/api/orientation-booking",
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : bookingFor("E0022")),
      },
    ]);
    renderHome(gabriel);
    expect((await screen.findByRole("alert")).textContent).toContain("Could not check your orientation booking. Internal error.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("home-orientation")).textContent).toBe("Orientation: Oct 31, 2026 16:00 UTC, in 30 days");
  });
});
