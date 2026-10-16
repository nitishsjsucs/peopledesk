import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingProgress } from "../../src/shared/api-types.ts";
import { MeContext } from "../../src/web/lib/session.tsx";
import { OnboardingPage } from "../../src/web/pages/OnboardingPage.tsx";
import { installFetch, me } from "./fixtures.ts";
import type { Route } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";
import { DEEPA, deepaIds, everyoneIds, overviewFor, progressFor } from "./seed.ts";

const progress = (employeeId: string, fullName: string, percent: number, blocked = 0): OnboardingProgress => ({
  employeeId,
  fullName,
  startDate: "2026-09-01",
  targetCompletionDate: "2026-11-30",
  percentComplete: percent,
  counts: { done: 6, inProgress: 2, pending: 4 - blocked, blocked },
  tasks: [{ id: `ONB-${employeeId}-01`, title: "Sign employment agreement", category: "paperwork", ownerRole: "employee", dueDate: "2026-08-25", status: "done" }],
});

const deepa = { ...me, employeeId: DEEPA, fullName: "Deepa Foster", role: "manager" as const, region: "US" as const, directReportIds: deepaIds };
const kenji = { ...me, employeeId: "E0016", fullName: "Kenji Nakamura", role: "hr_admin" as const };

const renderAs = (who: typeof me, url = "/onboarding") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MeContext.Provider value={who}>
        <OnboardingPage />
        <LocationProbe />
      </MeContext.Provider>
    </MemoryRouter>,
  );

const progressRoutes = (ids: readonly string[]): Route[] => ids.map((id) => ({ path: `/api/onboarding/${id}`, body: progressFor(id) }));
const teamRoutes = (extra: Route[] = [], overview = overviewFor(deepaIds)): Route[] => [
  ...extra,
  { path: "/api/team/onboarding", body: overview },
  ...progressRoutes(overview.people.map((p) => p.employeeId)),
];

const people = () => within(screen.getByRole("list", { name: "People in onboarding" }));
const rowIds = () => people().getAllByRole("listitem").map((li) => li.getAttribute("data-testid")?.replace("person-", ""));
const tile = (name: RegExp) => within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name });
const location = () => screen.getByTestId("location").textContent;
const segmentsIn = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(".task-bar .task-seg")].map((x) => [x.dataset["segment"], Number(x.dataset["count"])]);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes window.matchMedia answer as a screen of this width would for max-width queries. */
function screenWidth(px: number) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return { matches: max ? px <= Number(max[1]) : false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList;
  });
}

const FIRST = "Elijah Sullivan"; // first in Deepa's default order (most overdue tasks)

describe("OnboardingPage team overview", () => {
  it("counts people in tiles that filter: Deepa 5, 3, 1 and 3", async () => {
    const calls = installFetch(teamRoutes());
    renderAs(deepa);
    await screen.findByRole("group", { name: "Show" });
    const group = within(screen.getByRole("group", { name: "Show" }));
    expect(group.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "5 people in onboarding",
      "3 people not booked",
      "1 person with blocked tasks",
      "3 people with overdue tasks",
    ]);
    expect(group.getAllByRole("button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(calls.some((c) => c.path === "/api/team")).toBe(false);
  });

  it("counts everyone for HR: 30, 12, 14 and 19", async () => {
    installFetch(teamRoutes([], overviewFor(everyoneIds)));
    renderAs(kenji);
    expect(await screen.findByRole("heading", { level: 2, name: "Everyone in onboarding" })).toBeTruthy();
    await screen.findByRole("group", { name: "Show" });
    expect(tile(/in onboarding$/).getAttribute("aria-label")).toBe("30 people in onboarding");
    expect(tile(/not booked$/).getAttribute("aria-label")).toBe("12 people not booked");
    expect(tile(/blocked tasks$/).getAttribute("aria-label")).toBe("14 people with blocked tasks");
    expect(tile(/overdue tasks$/).getAttribute("aria-label")).toBe("19 people with overdue tasks");
  });

  it("puts the people who need attention first: most overdue, then most blocked, then not booked, then earliest start", async () => {
    installFetch(teamRoutes());
    renderAs(deepa);
    await screen.findByRole("list", { name: "People in onboarding" });
    expect(rowIds()).toEqual(["E0036", "E0030", "E0024", "E0033", "E0051"]);
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "name" } });
    expect(rowIds()).toEqual(["E0036", "E0051", "E0030", "E0024", "E0033"]);
    expect(location()).toBe("/onboarding?sort=name");
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "start" } });
    expect(rowIds()).toEqual(["E0024", "E0036", "E0030", "E0033", "E0051"]);
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "attention" } });
    expect(location()).toBe("/onboarding");
  });

  it("shows each person's booking, task bar and text line", async () => {
    installFetch(teamRoutes());
    renderAs(deepa);
    const olivia = await screen.findByTestId("person-E0024");
    expect(within(olivia).getByText("Not booked").className).toContain("status-pill");
    expect(within(olivia).getByRole("link", { name: "Book orientation for Olivia Morgan" }).getAttribute("href")).toBe("/requests/orientation?employee=E0024");
    expect(segmentsIn(olivia)).toEqual([
      ["done", 7],
      ["overdue", 2],
      ["rest", 3],
    ]);
    expect(within(olivia).getByRole("img").getAttribute("aria-label")).toBe("7 of 12 done · 2 overdue · day 25 of 90");
    expect(within(olivia).getByText("7 of 12 done · 2 overdue · day 25 of 90")).toBeTruthy();
    const jasmine = screen.getByTestId("person-E0030");
    expect(within(jasmine).getByRole("img").getAttribute("aria-label")).toBe("7 of 12 done · 2 overdue · 1 blocked · day 17 of 90");
    expect(within(jasmine).getByText(/^Orientation Oct/).className).toContain("status-pill");
    expect(within(jasmine).queryByRole("link", { name: /Book orientation/ })).toBeNull();
    const hana = screen.getByTestId("person-E0051");
    expect(within(hana).getByRole("img").getAttribute("aria-label")).toBe("0 of 12 done · starts in 15 days");
    expect(segmentsIn(hana)).toEqual([["rest", 12]]);
    // One legend for the whole list.
    expect(screen.getAllByRole("list", { name: "Task bar key" })).toHaveLength(1);
  });

  it("filters by a tile and writes ?show=, and Name sort and the selection also go into the URL", async () => {
    installFetch(teamRoutes());
    renderAs(deepa);
    await screen.findByRole("list", { name: "People in onboarding" });
    fireEvent.click(tile(/not booked$/));
    expect(tile(/not booked$/).getAttribute("aria-pressed")).toBe("true");
    expect(rowIds()).toEqual(["E0036", "E0024", "E0033"]);
    expect(location()).toBe("/onboarding?show=unbooked");
    fireEvent.click(tile(/blocked tasks$/));
    expect(rowIds()).toEqual(["E0030"]);
    fireEvent.click(tile(/overdue tasks$/));
    expect(rowIds()).toEqual(["E0036", "E0030", "E0024"]);
    fireEvent.click(people().getByRole("button", { name: "Olivia Morgan" }));
    expect(location()).toBe("/onboarding?show=overdue&person=E0024");
    fireEvent.click(tile(/in onboarding$/));
    expect(location()).toBe("/onboarding?person=E0024");
  });

  it("restores the filter, the sort and the selected person from the URL", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?show=overdue&sort=name&person=E0036");
    expect(await screen.findByRole("heading", { level: 3, name: "Elijah Sullivan's checklist" })).toBeTruthy();
    expect(tile(/overdue tasks$/).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Sort") as HTMLSelectElement).value).toBe("name");
    expect(rowIds()).toEqual(["E0036", "E0030", "E0024"]);
    expect(people().getByRole("button", { name: "Elijah Sullivan" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("ignores invalid URL values", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?show=everyone&sort=height&person=E9999");
    await screen.findByRole("list", { name: "People in onboarding" });
    expect(tile(/in onboarding$/).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Sort") as HTMLSelectElement).value).toBe("attention");
    expect(rowIds()).toEqual(["E0036", "E0030", "E0024", "E0033", "E0051"]);
    expect(await screen.findByRole("heading", { level: 3, name: `${FIRST}'s checklist` })).toBeTruthy();
  });

  it("says when a filter matches no one, and Show everyone moves focus to the In onboarding tile", async () => {
    const none = overviewFor(deepaIds);
    for (const p of none.people) p.tasks.blocked = 0;
    installFetch(teamRoutes([], none));
    renderAs(deepa, "/onboarding?show=blocked");
    const empty = await screen.findByTestId("filter-empty");
    expect(empty.textContent).toContain("No one has blocked tasks.");
    expect(tile(/blocked tasks$/).getAttribute("aria-label")).toBe("0 people with blocked tasks");
    expect(screen.queryByRole("list", { name: "People in onboarding" })).toBeNull();
    const button = within(empty).getByRole("button", { name: "Show everyone" });
    button.focus();
    fireEvent.click(button);
    expect(location()).toBe("/onboarding");
    expect(document.activeElement).toBe(tile(/in onboarding$/));
    expect(rowIds()).toHaveLength(5);
  });

  it("puts the people list before the checklist in the DOM, as on screen", async () => {
    installFetch(teamRoutes());
    renderAs(deepa);
    const heading = await screen.findByRole("heading", { level: 3, name: `${FIRST}'s checklist` });
    const list = screen.getByRole("list", { name: "People in onboarding" });
    expect(list.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves focus to the checklist's heading after a selection on a narrow screen, where it is below the list", async () => {
    screenWidth(375);
    installFetch(teamRoutes());
    renderAs(deepa);
    await screen.findByRole("heading", { level: 3, name: `${FIRST}'s checklist` });
    const button = people().getByRole("button", { name: "Zara Kim" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: "Zara Kim's checklist" })));
    // Selecting the same person again brings focus back to the checklist too.
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 3, name: "Zara Kim's checklist" })));
  });

  it("keeps focus on the selected name on a wide screen, where the checklist is beside the list", async () => {
    screenWidth(1280);
    installFetch(teamRoutes());
    renderAs(deepa);
    await screen.findByRole("heading", { level: 3, name: `${FIRST}'s checklist` });
    const button = people().getByRole("button", { name: "Zara Kim" });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("heading", { level: 3, name: "Zara Kim's checklist" })).toBeTruthy();
    expect(document.activeElement).toBe(button);
  });

  it("never shows the previous person's checklist while the next one loads", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    installFetch(teamRoutes([{ path: "/api/onboarding/E0033", body: async () => (await held, progressFor("E0033")) }]));
    renderAs(deepa);
    await screen.findByTestId("checklist-E0036");
    fireEvent.click(people().getByRole("button", { name: "Zara Kim" }));
    expect((await screen.findByRole("status")).textContent).toBe("Loading Zara Kim's checklist...");
    expect(screen.queryByTestId("checklist-E0036")).toBeNull();
    release();
    expect(await screen.findByTestId("checklist-E0033")).toBeTruthy();
  });

  it("shows an error with Try again when a checklist cannot be loaded, never an endless Loading", async () => {
    let fail = true;
    const calls = installFetch(
      teamRoutes([
        {
          path: "/api/onboarding/E0036",
          status: () => (fail ? 500 : 200),
          body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : progressFor("E0036")),
        },
      ]),
    );
    renderAs(deepa);
    expect((await screen.findByRole("alert")).textContent).toContain("Internal error.");
    expect(screen.queryByText(/Loading/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("checklist-E0036")).toBeTruthy();
    expect(calls.filter((c) => c.path === "/api/onboarding/E0036")).toHaveLength(2);
  });

  it("says it is loading the people, then shows an error with Try again when the overview fails", async () => {
    let fail = true;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    installFetch(
      teamRoutes([
        {
          path: "/api/team/onboarding",
          status: () => (fail ? 500 : 200),
          body: async () => (await held, fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : overviewFor(deepaIds)),
        },
      ]),
    );
    renderAs(deepa);
    expect(screen.getByRole("status").textContent).toBe("Loading the people you support...");
    release();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Internal error.");
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: "Show" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
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

  it("shows an error with Try again when the booking cannot be checked", async () => {
    const newHire = { ...me, employeeId: "E0025", fullName: "Nadia Fernandes", inOnboarding: true };
    let fail = true;
    installFetch([
      { path: "/api/onboarding", body: progress("E0025", "Nadia Fernandes", 40) },
      {
        path: "/api/orientation-booking",
        status: () => (fail ? 500 : 200),
        body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : { booking: null }),
      },
    ]);
    renderAs(newHire);
    expect((await screen.findByRole("alert")).textContent).toContain("Internal error.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("own-orientation")).textContent).toContain("You have not booked an orientation session yet.");
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
    const calls = installFetch([{ path: "/api/team/onboarding", body: { asOf: "2026-10-01", people: [], steps: [] } }]);
    renderAs(noReports);
    expect(await screen.findByText("No one you support is in onboarding")).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(["/api/team/onboarding"]);
    // No tiles without anyone to count.
    expect(screen.queryByRole("group", { name: "Show" })).toBeNull();
    // No one here needs a session, so there is no link to a booking form that could only say so.
    expect(screen.queryByRole("link", { name: /Book orientation/ })).toBeNull();
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
