import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingProgress } from "../../src/shared/api-types.ts";
import { BusinessDateContext } from "../../src/web/lib/business-date.tsx";
import type { BusinessDate } from "../../src/web/lib/business-date.tsx";
import { MeContext } from "../../src/web/lib/session.tsx";
import { OnboardingPage } from "../../src/web/pages/OnboardingPage.tsx";
import { installFetch, me } from "./fixtures.ts";
import type { Route } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";
import { bookingFor, DEEPA, deepaIds, everyoneIds, overviewFor, progressFor } from "./seed.ts";

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

const renderAs = (who: typeof me, url = "/onboarding", date: BusinessDate | null = null) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MeContext.Provider value={who}>
        <BusinessDateContext.Provider value={date}>
          <OnboardingPage />
          <LocationProbe />
        </BusinessDateContext.Provider>
      </MeContext.Provider>
    </MemoryRouter>,
  );
const ON_ASOF: BusinessDate = { asOf: "2026-10-01", settled: true };

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
      "5 in onboarding, 5 people",
      "3 not booked, 3 people",
      "1 with blocked tasks, 1 person",
      "3 with overdue tasks, 3 people",
    ]);
    expect(group.getAllByRole("button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(calls.some((c) => c.path === "/api/team")).toBe(false);
  });

  it("counts everyone for HR: 30, 8, 14 and 19 (12 have no booking, 4 of them with the orientation task done)", async () => {
    const overview = overviewFor(everyoneIds);
    expect(overview.people.filter((p) => p.orientation === null)).toHaveLength(12);
    installFetch(teamRoutes([], overview));
    renderAs(kenji);
    expect(await screen.findByRole("heading", { level: 2, name: "Everyone in onboarding" })).toBeTruthy();
    await screen.findByRole("group", { name: "Show" });
    expect(tile(/ in onboarding,/).getAttribute("aria-label")).toBe("30 in onboarding, 30 people");
    expect(tile(/ not booked,/).getAttribute("aria-label")).toBe("8 not booked, 8 people");
    expect(tile(/ blocked tasks,/).getAttribute("aria-label")).toBe("14 with blocked tasks, 14 people");
    expect(tile(/ overdue tasks,/).getAttribute("aria-label")).toBe("19 with overdue tasks, 19 people");
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
    // One legend for the whole list, not one per row.
    const card = document.querySelector(".onboarding-people-card") as HTMLElement;
    expect(within(card).getAllByRole("list", { name: "Task bar key" })).toHaveLength(1);
  });

  it("shows someone whose orientation task is done without a booking as Orientation done: not in Not booked, no Book link", async () => {
    installFetch(teamRoutes([], overviewFor(everyoneIds)));
    renderAs(kenji, "/onboarding?person=E0064");
    // Mateo Foster: orientation task done in the seed, no booking.
    const mateo = await screen.findByTestId("person-E0064");
    expect(within(mateo).getByText("Orientation done").className).toContain("status-pill done");
    expect(within(mateo).queryByText("Not booked")).toBeNull();
    expect(within(mateo).queryByRole("link", { name: /Book orientation/ })).toBeNull();
    const pane = await screen.findByTestId("checklist-E0064");
    expect(within(pane).getByTestId("report-orientation").textContent).toBe("Mateo's orientation task is done, so there is no session to book.");
    expect(within(pane).queryByRole("link", { name: /Book orientation/ })).toBeNull();
    fireEvent.click(tile(/ not booked,/));
    const shown = rowIds();
    expect(shown).toHaveLength(8);
    for (const id of ["E0064", "E0084", "E0085", "E0107"]) expect(shown).not.toContain(id);
    for (const id of shown) expect(within(screen.getByTestId(`person-${id}`)).getByText("Not booked")).toBeTruthy();
  });

  it("filters by a tile and writes ?show=, and Name sort and the selection also go into the URL", async () => {
    installFetch(teamRoutes());
    renderAs(deepa);
    await screen.findByRole("list", { name: "People in onboarding" });
    fireEvent.click(tile(/ not booked,/));
    expect(tile(/ not booked,/).getAttribute("aria-pressed")).toBe("true");
    expect(rowIds()).toEqual(["E0036", "E0024", "E0033"]);
    expect(location()).toBe("/onboarding?show=unbooked");
    fireEvent.click(tile(/ blocked tasks,/));
    expect(rowIds()).toEqual(["E0030"]);
    fireEvent.click(tile(/ overdue tasks,/));
    expect(rowIds()).toEqual(["E0036", "E0030", "E0024"]);
    fireEvent.click(people().getByRole("button", { name: "Olivia Morgan" }));
    expect(location()).toBe("/onboarding?show=overdue&person=E0024");
    fireEvent.click(tile(/ in onboarding,/));
    expect(location()).toBe("/onboarding?person=E0024");
  });

  it("restores the filter, the sort and the selected person from the URL", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?show=overdue&sort=name&person=E0036");
    expect(await screen.findByRole("heading", { level: 3, name: "Elijah Sullivan's checklist" })).toBeTruthy();
    expect(tile(/ overdue tasks,/).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Sort") as HTMLSelectElement).value).toBe("name");
    expect(rowIds()).toEqual(["E0036", "E0030", "E0024"]);
    expect(people().getByRole("button", { name: "Elijah Sullivan" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("arrives from a Home tile with that tile pressed (/onboarding?show=blocked)", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?show=blocked");
    await screen.findByRole("list", { name: "People in onboarding" });
    expect(tile(/ blocked tasks,/).getAttribute("aria-pressed")).toBe("true");
    expect(rowIds()).toEqual(["E0030"]);
  });

  it("ignores invalid URL values", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?show=everyone&sort=height&person=E9999");
    await screen.findByRole("list", { name: "People in onboarding" });
    expect(tile(/ in onboarding,/).getAttribute("aria-pressed")).toBe("true");
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
    expect(tile(/ blocked tasks,/).getAttribute("aria-label")).toBe("0 with blocked tasks, 0 people");
    expect(screen.queryByRole("list", { name: "People in onboarding" })).toBeNull();
    const button = within(empty).getByRole("button", { name: "Show everyone" });
    button.focus();
    fireEvent.click(button);
    expect(location()).toBe("/onboarding");
    expect(document.activeElement).toBe(tile(/ in onboarding,/));
    expect(rowIds()).toHaveLength(5);
  });

  it("filters the list to a stuck step's people, writes ?step= and moves focus to the line that says so", async () => {
    installFetch(teamRoutes([], overviewFor(everyoneIds)));
    renderAs(kenji, "/onboarding?show=blocked");
    const step = await screen.findByRole("button", { name: "Show the 9 people stuck on Enroll in multi-factor authentication" });
    fireEvent.click(step);
    expect(location()).toBe("/onboarding?step=3");
    const line = await screen.findByText("Showing 9 people stuck on Enroll in multi-factor authentication");
    await waitFor(() => expect(document.activeElement).toBe(line));
    expect(rowIds()).toEqual(["E0044", "E0085", "E0107", "E0047", "E0022", "E0060", "E0030", "E0059", "E0119"]);
    // A step replaces the tile filter: no tile is pressed while it applies.
    expect(within(screen.getByRole("group", { name: "Show" })).getAllByRole("button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false"]);
    fireEvent.click(within(screen.getByTestId("step-filter")).getByRole("button", { name: "Show everyone" }));
    expect(location()).toBe("/onboarding");
    expect(document.activeElement).toBe(tile(/ in onboarding,/));
    expect(rowIds()).toHaveLength(30);
  });

  it("clears ?step when a tile is pressed, and ignores an unknown step", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?step=6");
    expect((await screen.findByTestId("step-filter")).textContent).toContain("Showing 1 person stuck on First one-on-one with your manager");
    expect(rowIds()).toEqual(["E0036"]);
    fireEvent.click(tile(/ not booked,/));
    expect(location()).toBe("/onboarding?show=unbooked");
    expect(screen.queryByTestId("step-filter")).toBeNull();
    expect(rowIds()).toEqual(["E0036", "E0024", "E0033"]);
  });

  it("ignores ?step= for a step with nothing stuck", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?step=99");
    await screen.findByRole("list", { name: "People in onboarding" });
    expect(screen.queryByTestId("step-filter")).toBeNull();
    expect(rowIds()).toHaveLength(5);
    expect(tile(/ in onboarding,/).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows where a manager's reports are stuck, with her own step as You", async () => {
    installFetch(teamRoutes());
    renderAs(deepa);
    expect((await screen.findByTestId("stuck-summary")).textContent).toBe("7 stuck tasks: 1 blocked, 6 overdue and not blocked. Owners: New hire 6, You 1");
    const table = screen.getByRole("table", { name: "Where onboarding is stuck" });
    const stuckRows = within(table).getAllByRole("row").slice(1);
    expect(stuckRows).toHaveLength(6);
    expect(stuckRows.find((r) => r.textContent?.includes("First one-on-one"))?.querySelector(".col-owner")?.textContent).toBe("You");
  });

  it("shows a report's checklist as next steps, with the manager's own task as You and Book orientation", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?person=E0036");
    const pane = await screen.findByTestId("checklist-E0036");
    expect(screen.getByRole("heading", { level: 3, name: "Elijah Sullivan's checklist" })).toBeTruthy();
    const overdue = within(pane).getByRole("heading", { level: 4, name: "Overdue (3)" });
    const items = within(overdue.closest("section") as HTMLElement).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector(".task-title")?.textContent)).toEqual(["Submit tax and payroll forms", "First one-on-one with your manager", "Code of conduct training"]);
    expect(items.map((li) => li.querySelector(".task-meta")?.textContent?.split(" · ")[0])).toEqual(["New hire", "You", "New hire"]);
    const later = within(pane).getByRole("heading", { level: 4, name: "Later (1)" }).closest("section") as HTMLElement;
    expect(within(later).getByText("Attend new hire orientation")).toBeTruthy();
    expect(within(later).getByRole("link", { name: "Book orientation for Elijah Sullivan" }).getAttribute("href")).toBe("/requests/orientation?employee=E0036");
    expect(within(pane).getByRole("img").getAttribute("aria-label")).toBe("Day 25 of 90 · target Dec 5, 2026 · 6 of 12 done · 3 overdue");
    expect(within(pane).getByTestId("report-orientation").textContent).toContain("Elijah has not booked an orientation session yet.");
    // No heading in the pane is above h4, under the pane's h3.
    expect(within(pane).queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("shows a booked report's session and how soon it is", async () => {
    installFetch(teamRoutes());
    renderAs(deepa, "/onboarding?person=E0030");
    const pane = await screen.findByTestId("checklist-E0030");
    expect(within(pane).getByTestId("report-orientation").textContent).toBe("Orientation: ORI-008 on Oct 31, 2026 16:00 UTC (in 30 days).");
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
  const nadia = { ...me, employeeId: "E0025", fullName: "Nadia Fernandes", inOnboarding: true };
  const gabriel = { ...me, employeeId: "E0022", fullName: "Gabriel Kowalski", inOnboarding: true };
  const ownRoutes = (id: string): Route[] => [
    { path: "/api/onboarding", body: progressFor(id) },
    { path: "/api/orientation-booking", body: bookingFor(id) },
  ];
  const group = (name: string) => screen.getByRole("heading", { level: 3, name }).closest("section") as HTMLElement;
  const metaOf = (section: HTMLElement) => within(section).getAllByRole("listitem").map((li) => `${li.querySelector(".task-title")?.textContent} | ${li.querySelector(".task-meta")?.textContent}`);

  it("shows Nadia her plan, what is overdue for her, what waits on her manager, and Done folded", async () => {
    installFetch(ownRoutes("E0025"));
    renderAs(nadia, "/onboarding", ON_ASOF);
    const bar = await screen.findByRole("img", { name: "Day 55 of 90 · target Nov 5, 2026 · 9 of 12 done · 3 overdue" });
    expect(bar).toBeTruthy();
    const orientation = screen.getByTestId("own-orientation");
    expect(orientation.textContent).toContain("You have not booked an orientation session yet. Your orientation task was due Sep 21, 2026.");
    expect(within(orientation).getByRole("link", { name: "Book orientation" }).getAttribute("href")).toBe("/requests/orientation");
    expect(metaOf(group("Overdue (1)"))).toEqual(["Attend new hire orientation | You · Due Sep 21, 2026, overdue · in progress"]);
    expect(within(group("Overdue (1)")).getByRole("link", { name: "Book orientation" }).getAttribute("href")).toBe("/requests/orientation");
    expect(metaOf(group("Waiting on someone else (2)"))).toEqual([
      "First one-on-one with your manager | Your manager · Due Aug 14, 2026, overdue · blocked",
      "Team introductions | Your manager · Due Aug 17, 2026, overdue · blocked",
    ]);
    const done = screen.getByText("Done (9)").closest("details") as HTMLDetailsElement;
    expect(done.open).toBe(false);
    expect(within(done).getAllByRole("listitem", { hidden: true })).toHaveLength(9);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says the orientation task is done, with no Book link, for a new hire who has no booking but did orientation", async () => {
    // Mateo Foster (E0064): orientation task done in the seed, no booking.
    const mateo = { ...me, employeeId: "E0064", fullName: "Mateo Foster", inOnboarding: true };
    installFetch(ownRoutes("E0064"));
    renderAs(mateo, "/onboarding", ON_ASOF);
    const orientation = await screen.findByTestId("own-orientation");
    expect(orientation.textContent).toBe("Your orientation task is done, so there is no session to book.");
    expect(screen.queryByRole("link", { name: "Book orientation" })).toBeNull();
    const done = screen.getByText(/^Done \(\d+\)$/).closest("details") as HTMLDetailsElement;
    const task = within(done).getAllByRole("listitem", { hidden: true }).find((li) => li.querySelector(".task-title")?.textContent === "Attend new hire orientation");
    expect(task?.querySelector(".task-meta")?.textContent).toMatch(/^HR · /);
  });

  it("shows Gabriel his session, what is due soon, and a task due today as due today, not overdue", async () => {
    installFetch(ownRoutes("E0022"));
    renderAs(gabriel, "/onboarding", ON_ASOF);
    expect(await screen.findByRole("img", { name: "Day 10 of 90 · target Dec 20, 2026 · 3 of 12 done · 3 overdue" })).toBeTruthy();
    expect(screen.getByTestId("own-orientation").textContent).toBe(
      "You're booked into New Hire Orientation (US, in person) (ORI-008) on Oct 31, 2026 16:00 UTC (in 30 days), Austin Office, Training Room 2.",
    );
    expect(metaOf(group("Overdue (2)"))).toEqual([
      "Enroll in multi-factor authentication | You · Due Sep 22, 2026, overdue · in progress",
      "Submit tax and payroll forms | You · Due Sep 24, 2026, overdue · in progress",
    ]);
    expect(metaOf(group("Due in the next 7 days (2)")).map((x) => x.split(" | ")[0])).toEqual(["Security awareness training", "Code of conduct training"]);
    expect(metaOf(group("Later (1)"))).toEqual(["Benefits enrollment | You · Due Oct 21, 2026 · pending"]);
    const waiting = metaOf(group("Waiting on someone else (4)"));
    expect(waiting).toContain("Team introductions | Your manager · Due today · pending");
    expect(waiting).toContain("First one-on-one with your manager | Your manager · Due Sep 28, 2026, overdue · blocked");
    expect(screen.getByText("Done (3)").closest("details")?.open).toBe(false);
  });

  it("keeps the loading line until the business date has settled, so the table never swaps for groups", async () => {
    installFetch(ownRoutes("E0025"));
    const view = renderAs(nadia, "/onboarding", { asOf: null, settled: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole("status").textContent).toBe("Loading your checklist...");
    expect(screen.queryByRole("table")).toBeNull();
    view.rerender(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <MeContext.Provider value={nadia}>
          <BusinessDateContext.Provider value={ON_ASOF}>
            <OnboardingPage />
          </BusinessDateContext.Provider>
        </MeContext.Provider>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("grouped-checklist")).toBeTruthy();
    expect(screen.queryByText("Loading your checklist...")).toBeNull();
  });

  it("shows today's ungrouped table and never says overdue when /api/health failed", async () => {
    installFetch(ownRoutes("E0025"));
    renderAs(nadia, "/onboarding", { asOf: null, settled: true });
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.queryByTestId("grouped-checklist")).toBeNull();
    expect(document.body.textContent).not.toMatch(/overdue/i);
    expect(screen.getByTestId("own-orientation").textContent).toContain("You have not booked an orientation session yet.");
  });

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
