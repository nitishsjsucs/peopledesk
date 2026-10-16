import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { setFetch } from "../../src/web/lib/api.ts";
import type { Me, PendingActionView } from "../../src/shared/api-types.ts";
import { OrientationForm } from "../../src/web/components/OrientationForm.tsx";
import { MeContext } from "../../src/web/lib/session.tsx";
import { ScheduleOrientationPage } from "../../src/web/pages/ScheduleOrientationPage.tsx";
import { actionsServer, installFetch, me, pendingTicket } from "./fixtures.ts";
import type { Route as FakeRoute } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";

const session = (id: string, seatsRemaining: number, capacity = 10, region: "GLOBAL" | "US" | "UK" | "IN" = "GLOBAL") => ({
  id,
  title: `New hire orientation ${id}`,
  startsAt: "2026-10-20T16:00:00.000Z",
  durationMin: 90,
  format: "virtual" as const,
  region,
  location: "Video call",
  capacity,
  seatsRemaining,
});

const sessions = { sessions: [session("ORI-001", 0, 6), session("ORI-002", 4), session("ORI-003", 9)] };

const newHire: Me = { ...me, employeeId: "E0101", fullName: "Ana Lima", inOnboarding: true };
const manager: Me = { ...me, employeeId: "E0007", fullName: "Grace Okafor", role: "manager", directReportIds: ["E0101", "E0102", "E0103"] };
const hrAdmin: Me = { ...me, employeeId: "E0002", fullName: "Priya Nair", role: "hr_admin" };

const proposed = (args: Record<string, unknown>): PendingActionView =>
  pendingTicket({ tool: "schedule_orientation_session", arguments: args, preview: { title: "Orientation booking", fields: [] } });

const noBooking = { booking: null };
const ownBooking = {
  booking: {
    sessionId: "ORI-008",
    title: "New Hire Orientation (US, in person)",
    startsAt: "2026-10-31T16:00:00.000Z",
    durationMin: 120,
    format: "in_person",
    region: "US",
    location: "Austin Office, Training Room 2",
  },
};

type FormOptions = { team?: unknown; booking?: unknown; list?: unknown; extra?: FakeRoute[]; props?: Partial<Parameters<typeof OrientationForm>[0]> };

function renderForm(who: Me, opts: FormOptions = {}) {
  const onProposed = vi.fn();
  const calls = installFetch([
    ...(opts.extra ?? []),
    { path: "/api/orientation-sessions", body: opts.list ?? sessions },
    { path: "/api/team", body: opts.team ?? { members: [] } },
    { path: "/api/orientation-booking", body: opts.booking ?? noBooking },
    { method: "POST", path: "/api/actions", status: 201, body: (init: RequestInit) => proposed(JSON.parse(String(init.body)).arguments) },
  ]);
  render(
    <MemoryRouter>
      <MeContext.Provider value={who}>
        <OrientationForm onProposed={onProposed} {...opts.props} />
      </MeContext.Provider>
    </MemoryRouter>,
  );
  return { calls, onProposed, posts: () => calls.filter((c) => c.method === "POST") };
}

const radioIds = () => screen.queryAllByRole("radio").map((r) => (r as HTMLInputElement).value);

const member = (employeeId: string, fullName: string, inOnboarding: boolean, booked: boolean) => ({
  employeeId,
  fullName,
  inOnboarding,
  booked,
  percentComplete: inOnboarding ? 50 : null,
  blockedTasks: 0,
});

describe("OrientationForm", () => {
  it("lists sessions with seats left, disables full ones, and proposes for self", async () => {
    const { posts, onProposed } = renderForm(newHire);
    const full = await screen.findByLabelText("New hire orientation ORI-001, ORI-001");
    expect((full as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Full")).toBeTruthy();
    expect(screen.getByText("4 of 10")).toBeTruthy();
    expect(screen.queryByLabelText("Attendee")).toBeNull();
    fireEvent.click(screen.getByLabelText("New hire orientation ORI-002, ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    expect(posts()).toEqual([
      { method: "POST", path: "/api/actions", body: { tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } } },
    ]);
  });

  it("validates on the client, ties the error to the session group, moves focus to the first open session, and sends nothing", async () => {
    const { posts } = renderForm(newHire);
    await screen.findByLabelText("New hire orientation ORI-002, ORI-002");
    const submit = screen.getByRole("button", { name: "Review request" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Choose a session.");
    const group = screen.getByRole("group", { name: "Session" });
    expect(group.getAttribute("aria-describedby")).toBe(alert.id);
    // ORI-001 is full, so the first session that can be chosen is ORI-002.
    expect(document.activeElement).toBe(screen.getByLabelText("New hire orientation ORI-002, ORI-002"));
    expect(posts()).toHaveLength(0);
  });

  it("checks a session's radio when its title is clicked", async () => {
    renderForm(newHire);
    await screen.findByLabelText("New hire orientation ORI-003, ORI-003");
    const label = screen.getByText("New hire orientation ORI-003", { selector: "label" });
    expect(label.getAttribute("for")).toBe("session-ORI-003");
    fireEvent.click(label);
    expect((screen.getByLabelText("New hire orientation ORI-003, ORI-003") as HTMLInputElement).checked).toBe(true);
  });

  it("shows a loading line while the sessions load", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    setFetch(async (input) => {
      await gate;
      const url = String(input);
      const body = url === "/api/orientation-sessions" ? sessions : noBooking;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    render(
      <MemoryRouter>
        <MeContext.Provider value={newHire}>
          <OrientationForm onProposed={vi.fn()} />
        </MeContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status").textContent).toBe("Loading sessions...");
    expect(screen.queryByRole("button", { name: "Review request" })).toBeNull();
    release();
    await screen.findByLabelText("New hire orientation ORI-002, ORI-002");
  });

  it("offers a manager only reports in onboarding without a booking, and proposes for the attendee shown", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false), member("E0102", "Ben Cole", true, true), member("E0103", "Chen Wei", false, false)] };
    const { posts, onProposed } = renderForm(manager, { team });
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Ana Lima (E0101)" });
    expect([...select.options].map((o) => o.value)).toEqual(["E0101"]);
    // The only attendee is the one shown as selected, so it is the one proposed for: the manager is
    // not in onboarding and must never be proposed for by default.
    expect(select.value).toBe("E0101");
    fireEvent.click(screen.getByLabelText("New hire orientation ORI-003, ORI-003"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-003", employeeId: "E0101" } });
  });

  it("lets HR choose among everyone in onboarding without a booking", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false), member("E0104", "Dina Haddad", true, false)] };
    const { posts } = renderForm(hrAdmin, { team });
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Dina Haddad (E0104)" });
    expect(select.value).toBe("E0101");
    fireEvent.change(select, { target: { value: "E0104" } });
    fireEvent.click(screen.getByLabelText("New hire orientation ORI-002, ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002", employeeId: "E0104" } });
  });

  it("preselects the attendee named by ?employee= only when that person is listed", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false), member("E0104", "Dina Haddad", true, false)] };
    renderForm(hrAdmin, { team, props: { initialEmployeeId: "E0104" } });
    expect(((await screen.findByLabelText("Attendee")) as HTMLSelectElement).value).toBe("E0104");
    cleanup();
    renderForm(hrAdmin, { team, props: { initialEmployeeId: "E0999" } });
    expect(((await screen.findByLabelText("Attendee")) as HTMLSelectElement).value).toBe("E0101");
  });

  it("lists a manager who is in onboarding first, as themself, and proposes without an employee id", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false)] };
    const { posts } = renderForm({ ...manager, inOnboarding: true }, { team });
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Ana Lima (E0101)" });
    expect([...select.options].map((o) => o.textContent)).toEqual(["Grace Okafor (you) (E0007)", "Ana Lima (E0101)"]);
    expect(select.value).toBe("E0007");
    fireEvent.click(screen.getByLabelText("New hire orientation ORI-002, ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } });
  });

  it("does not list a manager in onboarding who is already booked, and shows their booking", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false)] };
    renderForm({ ...manager, inOnboarding: true }, { team, booking: ownBooking });
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["E0101"]);
    expect(screen.getByTestId("own-booking").textContent).toContain("You're booked into New Hire Orientation (US, in person) (ORI-008)");
  });

  it("gives a tenured employee no form, only why and where to go instead", async () => {
    const calls = installFetch([]);
    render(
      <MemoryRouter>
        <MeContext.Provider value={me}>
          <OrientationForm onProposed={vi.fn()} />
        </MeContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("orientation-ineligible").textContent).toContain(
      "Orientation sessions are for people in onboarding, and you don't have an onboarding plan.",
    );
    expect(screen.getByRole("link", { name: "Browse policies" }).getAttribute("href")).toBe("/policies");
    expect(screen.getByRole("link", { name: "Ask in chat" }).getAttribute("href")).toBe("/chat");
    expect(screen.queryByRole("button", { name: "Review request" })).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([]);
  });

  it("gives a manager without reports in onboarding no form", async () => {
    renderForm(manager, { team: { members: [member("E0103", "Chen Wei", false, false)] } });
    expect((await screen.findByTestId("orientation-no-attendee")).textContent).toContain("No one you support is in onboarding.");
    expect(screen.getByRole("link", { name: "See onboarding" }).getAttribute("href")).toBe("/onboarding");
    expect(screen.queryByRole("button", { name: "Review request" })).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("says so when everyone a manager supports in onboarding is already booked", async () => {
    renderForm(manager, { team: { members: [member("E0102", "Ben Cole", true, true)] } });
    expect((await screen.findByTestId("orientation-no-attendee")).textContent).toContain(
      "Everyone you support in onboarding already has a session.",
    );
    expect(screen.queryByRole("button", { name: "Review request" })).toBeNull();
  });

  it("shows a booked new hire their session instead of a form", async () => {
    renderForm(newHire, { booking: ownBooking });
    const line = await screen.findByTestId("own-booking");
    expect(line.textContent).toContain(
      "You're booked into New Hire Orientation (US, in person) (ORI-008) on Oct 31, 2026 16:00 UTC, Austin Office, Training Room 2.",
    );
    expect(screen.getByRole("link", { name: "View onboarding" }).getAttribute("href")).toBe("/onboarding");
    expect(screen.queryByRole("button", { name: "Review request" })).toBeNull();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("shows an error with Try again when the team cannot be loaded, never 'no one needs a booking'", async () => {
    const calls = installFetch([
      { path: "/api/orientation-sessions", body: sessions },
      { path: "/api/team", status: 500, body: { error: { code: "internal", message: "Internal error.", requestId: "r" } } },
    ]);
    render(
      <MemoryRouter>
        <MeContext.Provider value={manager}>
          <OrientationForm onProposed={vi.fn()} />
        </MeContext.Provider>
      </MemoryRouter>,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Internal error.");
    expect(screen.queryByText(/needs a booking|No one you support/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Review request" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/team")).toHaveLength(2));
  });

  it("shows an error with Try again when the sessions cannot be loaded", async () => {
    renderForm(newHire, { extra: [{ path: "/api/orientation-sessions", status: 503, body: { error: { code: "internal", message: "Internal error.", requestId: "r" } } }] });
    expect((await screen.findByRole("alert")).textContent).toContain("Internal error.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review request" })).toBeNull();
  });

  it("defaults a self booking to the person's region and Global, and lists every session under All regions", async () => {
    const list = { sessions: [session("ORI-010", 5, 10, "US"), session("ORI-011", 5, 10, "UK"), session("ORI-012", 5, 10, "GLOBAL"), session("ORI-013", 5, 10, "IN")] };
    renderForm(newHire, { list });
    await screen.findByLabelText("New hire orientation ORI-010, ORI-010");
    const region = screen.getByLabelText("Region") as HTMLSelectElement;
    expect(region.value).toBe("mine");
    expect(radioIds()).toEqual(["ORI-010", "ORI-012"]);
    fireEvent.change(region, { target: { value: "all" } });
    expect(radioIds()).toEqual(["ORI-010", "ORI-011", "ORI-012", "ORI-013"]);
    fireEvent.change(region, { target: { value: "UK" } });
    expect(radioIds()).toEqual(["ORI-011"]);
  });

  it("shows every region when a session is preselected, and keeps the chosen session visible under any filter", async () => {
    const list = { sessions: [session("ORI-010", 5, 10, "US"), session("ORI-011", 5, 10, "UK")] };
    renderForm(newHire, { list, props: { initialSessionId: "ORI-011" } });
    await screen.findByLabelText("New hire orientation ORI-011, ORI-011");
    expect((screen.getByLabelText("Region") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("New hire orientation ORI-011, ORI-011") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "IN" } });
    expect(radioIds()).toEqual(["ORI-011"]);
  });

  it("offers all regions when a region has no sessions", async () => {
    const list = { sessions: [session("ORI-010", 5, 10, "UK")] };
    renderForm(newHire, { list });
    const empty = await screen.findByTestId("no-sessions-in-region");
    expect(empty.textContent).toContain("No sessions in this region.");
    fireEvent.click(screen.getByRole("button", { name: "Show all regions" }));
    expect(radioIds()).toEqual(["ORI-010"]);
  });

  it("links to My requests when the server refuses because too many requests are pending", async () => {
    renderForm(newHire, {
      extra: [
        {
          method: "POST",
          path: "/api/actions",
          status: 429,
          body: { error: { code: "rate_limited", message: "You already have 5 requests awaiting approval. Approve or reject one first.", requestId: "r", details: { reason: "rate_limited" } } },
        },
      ],
    });
    fireEvent.click(await screen.findByLabelText("New hire orientation ORI-002, ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You already have 5 requests awaiting approval.");
    expect(screen.getByRole("link", { name: "Review your requests" }).getAttribute("href")).toBe("/actions");
  });
});

describe("ScheduleOrientationPage", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const renderPage = (url: string) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <MeContext.Provider value={newHire}>
          <Routes>
            <Route path="/requests/orientation" element={<ScheduleOrientationPage />} />
          </Routes>
          <LocationProbe />
        </MeContext.Provider>
      </MemoryRouter>,
    );
  const location = () => screen.getByTestId("location").textContent;

  it("goes from the review step to the prefilled form on Edit, and the update supersedes the proposal", async () => {
    const server = actionsServer();
    const calls = installFetch([{ path: "/api/orientation-sessions", body: sessions }, { path: "/api/orientation-booking", body: noBooking }, ...server.routes]);
    renderPage("/requests/orientation");
    fireEvent.click(await screen.findByLabelText("New hire orientation ORI-002, ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/orientation?review=${id(1)}`);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Edit orientation request" })).toBeTruthy();
    expect(location()).toBe(`/requests/orientation?edit=${id(1)}`);
    expect(screen.queryByTestId("approval-card")).toBeNull();
    const prefilled = (await screen.findByLabelText("New hire orientation ORI-002, ORI-002")) as HTMLInputElement;
    expect(prefilled.checked).toBe(true);
    fireEvent.click(screen.getByLabelText("New hire orientation ORI-003, ORI-003"));
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    await screen.findByRole("heading", { name: "Review orientation request" });
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/orientation?review=${id(2)}`);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual({
      tool: "schedule_orientation_session",
      arguments: { sessionId: "ORI-003" },
      supersedes: id(1),
    });
  });

  it("shows the review card again when the review URL is reopened", async () => {
    const proposedEarlier = proposed({ sessionId: "ORI-002" });
    installFetch([{ path: "/api/orientation-sessions", body: sessions }, { path: "/api/orientation-booking", body: noBooking }, ...actionsServer([proposedEarlier]).routes]);
    renderPage(`/requests/orientation?review=${proposedEarlier.actionId}`);
    await screen.findByTestId("approval-card");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review orientation request");
  });

  it("starts again from an expired request without superseding it", async () => {
    const old = { ...proposed({ sessionId: "ORI-002" }), status: "expired" as const };
    const calls = installFetch([{ path: "/api/orientation-sessions", body: sessions }, { path: "/api/orientation-booking", body: noBooking }, ...actionsServer([old]).routes]);
    renderPage(`/requests/orientation?from=${old.actionId}`);
    const prefilled = (await screen.findByLabelText("New hire orientation ORI-002, ORI-002")) as HTMLInputElement;
    expect(prefilled.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } },
    ]);
    expect(location()).toBe(`/requests/orientation?review=${id(1)}`);
  });

  it("renders no Update request button for an edit of a decided request", async () => {
    const old = { ...proposed({ sessionId: "ORI-002" }), status: "rejected" as const, supersededBy: id(5) };
    installFetch([{ path: "/api/orientation-sessions", body: sessions }, { path: "/api/orientation-booking", body: noBooking }, ...actionsServer([old]).routes]);
    renderPage(`/requests/orientation?edit=${old.actionId}`);
    expect((await screen.findByTestId("not-editable")).textContent).toContain("replaced by an edited request");
    expect(screen.getByRole("link", { name: "See the new request" }).getAttribute("href")).toBe(`/actions?focus=${id(5)}`);
    expect(screen.queryByRole("button", { name: "Update request" })).toBeNull();
  });
});
