import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { setFetch } from "../../src/web/lib/api.ts";
import type { Me, PendingActionView } from "../../src/shared/api-types.ts";
import { OrientationForm, seatText, sessionWeeks, weekOf } from "../../src/web/components/OrientationForm.tsx";
import { BusinessDateContext } from "../../src/web/lib/business-date.tsx";
import { MeContext } from "../../src/web/lib/session.tsx";
import { ScheduleOrientationPage } from "../../src/web/pages/ScheduleOrientationPage.tsx";
import { actionsServer, installFetch, me, pendingTicket } from "./fixtures.ts";
import type { Route as FakeRoute } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";
import { DEEPA, deepaIds, overviewFor, progressFor, sessionsAt } from "./seed.ts";

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

/** A session's radio, by its accessible name: title, then "id · location", then the start. */
const radioName = (id: string) => new RegExp(`^New hire orientation ${id} ${id} · Video call `);
const radio = (id: string) => screen.getByRole("radio", { name: radioName(id) });
const findRadio = (id: string) => screen.findByRole("radio", { name: radioName(id) });

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
    const full = await findRadio("ORI-001");
    expect((full as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Full")).toBeTruthy();
    expect(screen.getByText("4 of 10 left")).toBeTruthy();
    expect(screen.queryByLabelText("Attendee")).toBeNull();
    fireEvent.click(radio("ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    expect(posts()).toEqual([
      { method: "POST", path: "/api/actions", body: { tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } } },
    ]);
  });

  it("validates on the client, ties the error to the session group, moves focus to the first open session, and sends nothing", async () => {
    const { posts } = renderForm(newHire);
    await findRadio("ORI-002");
    const submit = screen.getByRole("button", { name: "Review request" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Choose a session.");
    const group = screen.getByRole("group", { name: "Session" });
    expect(group.getAttribute("aria-describedby")).toBe(alert.id);
    // ORI-001 is full, so the first session that can be chosen is ORI-002.
    expect(document.activeElement).toBe(radio("ORI-002"));
    expect(posts()).toHaveLength(0);
  });

  it("names each session's radio by its title, id, place and start, since several share a title", async () => {
    renderForm(newHire);
    const r = await findRadio("ORI-002");
    expect(r.getAttribute("aria-label")).toBeNull();
    expect(screen.getByRole("radio", { name: "New hire orientation ORI-002 ORI-002 · Video call Oct 20, 2026 16:00 UTC" })).toBe(r);
  });

  it("checks a session's radio when its title is clicked", async () => {
    renderForm(newHire);
    await findRadio("ORI-003");
    const label = screen.getByText("New hire orientation ORI-003").closest("label")!;
    expect(label.getAttribute("for")).toBe("session-ORI-003");
    fireEvent.click(label);
    expect((radio("ORI-003") as HTMLInputElement).checked).toBe(true);
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
    await findRadio("ORI-002");
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
    fireEvent.click(radio("ORI-003"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-003", employeeId: "E0101" } });
  });

  it("lets HR choose among everyone in onboarding without a booking, and asks for a choice instead of picking the first", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false), member("E0104", "Dina Haddad", true, false)] };
    const { posts } = renderForm(hrAdmin, { team });
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Dina Haddad (E0104)" });
    expect(select.value).toBe("");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose an attendee", "Ana Lima (E0101)", "Dina Haddad (E0104)"]);
    fireEvent.click(radio("ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose an attendee.");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(select.getAttribute("aria-describedby")).toBe("attendee-error");
    expect(document.activeElement).toBe(select);
    expect(posts()).toHaveLength(0);
    fireEvent.change(select, { target: { value: "E0104" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(radio("ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002", employeeId: "E0104" } });
  });

  it("preselects the attendee named by ?employee= when that person is listed", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false), member("E0104", "Dina Haddad", true, false)] };
    renderForm(hrAdmin, { team, props: { initialEmployeeId: "E0104" } });
    expect(((await screen.findByLabelText("Attendee")) as HTMLSelectElement).value).toBe("E0104");
    expect(screen.queryByText(/Choose an attendee/, { selector: "p" })).toBeNull();
  });

  it("never swaps a named attendee who cannot be booked for someone else: it says why and asks for a choice", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false), member("E0102", "Ben Cole", true, true), member("E0103", "Chen Wei", false, false)] };
    for (const [initialEmployeeId, why] of [
      ["E0102", "Ben Cole (E0102) already has an orientation session."],
      ["E0103", "Chen Wei (E0103) is not in onboarding."],
      ["E0999", "E0999 is not one of the people you can book for."],
    ] as const) {
      const { posts, onProposed } = renderForm(manager, { team, props: { initialEmployeeId } });
      const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
      // Ana Lima is the only person listed, yet she is not chosen in place of the person named.
      expect(select.value).toBe("");
      expect(select.getAttribute("aria-describedby")).toBe("attendee-error");
      expect(screen.getByText(why).id).toBe("attendee-error");
      fireEvent.click(radio("ORI-002"));
      fireEvent.click(screen.getByRole("button", { name: "Review request" }));
      expect((await screen.findByRole("alert")).textContent).toBe(`${why} Choose an attendee.`);
      expect(posts()).toHaveLength(0);
      fireEvent.change(select, { target: { value: "E0101" } });
      expect(screen.queryByText(why, { exact: false })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Review request" }));
      await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
      expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002", employeeId: "E0101" } });
      cleanup();
    }
  });

  it("does not keep a preselected session that is full now: it says so, checks nothing and sends nothing", async () => {
    const { posts } = renderForm(newHire, { props: { initialSessionId: "ORI-001" } });
    const full = (await findRadio("ORI-001")) as HTMLInputElement;
    expect(full.checked).toBe(false);
    expect(full.disabled).toBe(true);
    const note = screen.getByText("ORI-001 is full now. Choose another session.");
    expect(screen.getByRole("group", { name: "Session" }).getAttribute("aria-describedby")).toBe(note.id);
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("ORI-001 is full now. Choose another session.");
    expect(document.activeElement).toBe(radio("ORI-002"));
    expect(posts()).toHaveLength(0);
    fireEvent.click(radio("ORI-002"));
    expect(screen.queryByText(/is full now/)).toBeNull();
  });

  it("says a preselected session that is no longer listed cannot be booked", async () => {
    const { posts } = renderForm(newHire, { props: { initialSessionId: "ORI-099" } });
    expect(await screen.findByText("ORI-099 is no longer open for booking. Choose another session.")).toBeTruthy();
    expect(screen.queryAllByRole("radio").some((r) => (r as HTMLInputElement).checked)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByRole("alert");
    expect(posts()).toHaveLength(0);
  });

  it("re-reads the sessions when the server says the chosen one filled up, and unchecks it", async () => {
    let filled = false;
    const { posts } = renderForm(newHire, {
      extra: [
        { path: "/api/orientation-sessions", body: () => ({ sessions: [session("ORI-001", 0, 6), session("ORI-002", filled ? 0 : 4), session("ORI-003", 9)] }) },
        {
          method: "POST",
          path: "/api/actions",
          status: 409,
          body: () => {
            filled = true;
            return { error: { code: "conflict", message: "That session is full.", requestId: "r", details: { reason: "session_full" } } };
          },
        },
      ],
    });
    fireEvent.click(await findRadio("ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    expect(await screen.findByText("ORI-002 is full now. Choose another session.")).toBeTruthy();
    expect((radio("ORI-002") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("That session is full.");
    expect(posts()).toHaveLength(1);
  });

  it("lists a manager who is in onboarding first, as themself, and proposes without an employee id", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false)] };
    const { posts } = renderForm({ ...manager, inOnboarding: true }, { team });
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Ana Lima (E0101)" });
    expect([...select.options].map((o) => o.textContent)).toEqual(["Grace Okafor (you) (E0007)", "Ana Lima (E0101)"]);
    expect(select.value).toBe("E0007");
    fireEvent.click(radio("ORI-002"));
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
    await findRadio("ORI-010");
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
    await findRadio("ORI-011");
    expect((screen.getByLabelText("Region") as HTMLSelectElement).value).toBe("all");
    expect((radio("ORI-011") as HTMLInputElement).checked).toBe(true);
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
    fireEvent.click(await findRadio("ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You already have 5 requests awaiting approval.");
    expect(screen.getByRole("link", { name: "Review your requests" }).getAttribute("href")).toBe("/actions");
  });
});

describe("ScheduleOrientationPage", () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const renderPage = (url: string, who: Me = newHire) =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <MeContext.Provider value={who}>
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
    fireEvent.click(await findRadio("ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/orientation?review=${id(1)}`);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review orientation request" })));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Edit orientation request" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Edit orientation request" })));
    expect(location()).toBe(`/requests/orientation?edit=${id(1)}`);
    expect(screen.queryByTestId("approval-card")).toBeNull();
    const prefilled = (await findRadio("ORI-002")) as HTMLInputElement;
    expect(prefilled.checked).toBe(true);
    fireEvent.click(radio("ORI-003"));
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    await screen.findByRole("heading", { name: "Review orientation request" });
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/orientation?review=${id(2)}`);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review orientation request" })));
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
    const prefilled = (await findRadio("ORI-002")) as HTMLInputElement;
    expect(prefilled.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } },
    ]);
    expect(location()).toBe(`/requests/orientation?review=${id(1)}`);
  });

  it("offers another session from a request that failed because its session filled up, never the full one", async () => {
    const failed = { ...proposed({ sessionId: "ORI-001" }), status: "failed" as const, errorCode: "session_full" };
    const calls = installFetch([{ path: "/api/orientation-sessions", body: sessions }, { path: "/api/orientation-booking", body: noBooking }, ...actionsServer([failed]).routes]);
    renderPage(`/requests/orientation?from=${failed.actionId}`);
    expect(await screen.findByText("ORI-001 is full now. Choose another session.")).toBeTruthy();
    expect((radio("ORI-001") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByRole("alert");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    fireEvent.click(radio("ORI-003"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-003" } }]);
  });

  it("keeps the attendee of the request being edited, and asks for a choice when that person was booked since", async () => {
    const team = { members: [member("E0101", "Ana Lima", true, false), member("E0102", "Ben Cole", true, false), member("E0103", "Chen Wei", true, true)] };
    const routes = (old: PendingActionView) => [
      { path: "/api/orientation-sessions", body: sessions },
      { path: "/api/team", body: team },
      ...actionsServer([old]).routes,
    ];
    const stillOpen = proposed({ sessionId: "ORI-002", employeeId: "E0102" });
    installFetch(routes(stillOpen));
    const view = renderPage(`/requests/orientation?edit=${stillOpen.actionId}`, manager);
    await waitFor(() => expect((screen.getByLabelText("Attendee") as HTMLSelectElement).value).toBe("E0102"));
    view.unmount();
    const bookedSince = proposed({ sessionId: "ORI-002", employeeId: "E0103" });
    const calls = installFetch(routes(bookedSince));
    renderPage(`/requests/orientation?edit=${bookedSince.actionId}`, manager);
    expect(await screen.findByText("Chen Wei (E0103) already has an orientation session.")).toBeTruthy();
    expect((screen.getByLabelText("Attendee") as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Chen Wei (E0103) already has an orientation session. Choose an attendee.");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("shows the subtitle about picking a session only above a form", async () => {
    const subtitle = "Pick a session with seats left. Nothing is booked until you approve the request.";
    installFetch([{ path: "/api/orientation-sessions", body: sessions }, { path: "/api/orientation-booking", body: noBooking }]);
    let view = renderPage("/requests/orientation");
    await findRadio("ORI-002");
    expect(screen.getByText(subtitle)).toBeTruthy();
    view.unmount();
    const cases: Array<[Me, FakeRoute[], string]> = [
      [newHire, [{ path: "/api/orientation-booking", body: ownBooking }], "own-booking"],
      [me, [], "orientation-ineligible"],
      [manager, [{ path: "/api/team", body: { members: [member("E0103", "Chen Wei", false, false)] } }], "orientation-no-attendee"],
    ];
    for (const [who, routes, testId] of cases) {
      installFetch([{ path: "/api/orientation-sessions", body: sessions }, ...routes]);
      view = renderPage("/requests/orientation", who);
      await screen.findByTestId(testId);
      expect(screen.queryByText(subtitle)).toBeNull();
      view.unmount();
    }
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

describe("OrientationForm session picker (seeded sessions, business date 2026-10-01)", () => {
  const seeded = sessionsAt();
  const nadia: Me = { ...me, employeeId: "E0025", fullName: "Nadia Fernandes", region: "US", inOnboarding: true };
  const deepa: Me = { ...me, employeeId: DEEPA, fullName: "Deepa Foster", role: "manager", region: "US", directReportIds: deepaIds };
  const deepaTeam = {
    members: overviewFor(deepaIds).people.map((p) => ({ employeeId: p.employeeId, fullName: p.fullName, inOnboarding: true, booked: p.orientation !== null, percentComplete: 50, blockedTasks: 0 })),
  };
  const failing = { error: { code: "internal", message: "Internal error.", requestId: "r" } };

  function renderPicker(who: Me, opts: { extra?: FakeRoute[]; asOf?: string | null; props?: Partial<Parameters<typeof OrientationForm>[0]> } = {}) {
    const onProposed = vi.fn();
    const calls = installFetch([
      ...(opts.extra ?? []),
      { path: "/api/orientation-sessions", body: seeded },
      { path: "/api/team", body: who.role === "employee" ? { members: [] } : deepaTeam },
      { path: "/api/orientation-booking", body: { booking: null } },
      ...(who.inOnboarding ? [{ path: "/api/onboarding", body: progressFor(who.employeeId) }] : []),
      ...deepaIds.map((id) => ({ path: `/api/onboarding/${id}`, body: progressFor(id) })),
      { method: "POST", path: "/api/actions", status: 201, body: (init: RequestInit) => proposed(JSON.parse(String(init.body)).arguments) },
    ]);
    const asOf = opts.asOf === undefined ? "2026-10-01" : opts.asOf;
    render(
      <MemoryRouter>
        <MeContext.Provider value={who}>
          <BusinessDateContext.Provider value={{ asOf, settled: true }}>
            <OrientationForm onProposed={onProposed} {...opts.props} />
          </BusinessDateContext.Provider>
        </MeContext.Provider>
      </MemoryRouter>,
    );
    return { calls, onProposed };
  }
  const seededRadio = (id: string) => document.getElementById(`session-${id}`) as HTMLInputElement;
  const weekHeadings = () => screen.getAllByRole("rowheader").map((h) => h.textContent);
  const sessionsIn = (heading: string) => {
    const th = screen.getAllByRole("rowheader").find((h) => h.textContent === heading)!;
    return [...(th.closest("tbody") as HTMLElement).querySelectorAll("tr[data-session], tr[data-testid=due-row]")].map((tr) => tr.getAttribute("data-session") ?? "due");
  };

  it("groups sessions by week, Monday first, across the October to November boundary", () => {
    expect(weekOf("2026-10-26T16:00:00.000Z")).toBe("2026-10-26");
    expect(weekOf("2026-10-31T16:00:00.000Z")).toBe("2026-10-26");
    expect(weekOf("2026-11-01")).toBe("2026-10-26");
    expect(weekOf("2026-11-02T05:00:00.000Z")).toBe("2026-11-02");
    const weeks = sessionWeeks(seeded.sessions, null);
    expect(weeks.find((w) => w.week === "2026-10-26")?.rows.map((r) => (r.kind === "session" ? r.session.id : "due"))).toEqual(["ORI-006", "ORI-007", "ORI-008"]);
    expect(weeks.find((w) => w.week === "2026-11-02")?.rows.map((r) => (r.kind === "session" ? r.session.id : "due"))).toEqual(["ORI-009", "ORI-010", "ORI-011"]);
  });

  it("puts the due date at its place in time, and marks every later session after it", () => {
    const weeks = sessionWeeks(seeded.sessions, "2026-10-21");
    const flat = weeks.flatMap((w) => w.rows.map((r) => (r.kind === "session" ? `${r.session.id}${r.afterDue ? "+" : ""}` : "due")));
    expect(flat.slice(0, 6)).toEqual(["ORI-001", "ORI-002", "ORI-003", "due", "ORI-004+", "ORI-005+"]);
    // A session on the due date itself is before it; a due date after every session goes last.
    expect(sessionWeeks(seeded.sessions, "2026-10-19").flatMap((w) => w.rows.map((r) => (r.kind === "due" ? "due" : r.session.id))).slice(2, 4)).toEqual(["ORI-003", "due"]);
    const late = sessionWeeks(seeded.sessions.slice(0, 2), "2026-12-30");
    expect(late[late.length - 1]).toMatchObject({ week: "2026-12-28", rows: [{ kind: "due", date: "2026-12-30" }] });
  });

  it("says Full, Only N left for 1 to 3 seats, and N of C left otherwise", () => {
    expect([0, 1, 3, 4, 18].map((n) => seatText({ seatsRemaining: n, capacity: 18 }))).toEqual(["Full", "Only 1 left", "Only 3 left", "4 of 18 left", "18 of 18 left"]);
  });

  it("shows Nadia her past due date once, marks no row, and offers the soonest open session in her region", async () => {
    const { calls } = renderPicker(nadia);
    expect((await screen.findByTestId("due-past")).textContent).toBe("Your orientation task was due Sep 21, 2026.");
    expect(screen.queryByTestId("due-row")).toBeNull();
    expect(document.querySelectorAll(".session-after")).toHaveLength(0);
    const soonest = screen.getByTestId("soonest-open");
    expect(soonest.textContent).toContain("Soonest open session: New Hire Orientation (Global, virtual) (ORI-004), Oct 22, 2026 15:00 UTC, in 21 days");
    fireEvent.click(within(soonest).getByRole("button", { name: "Choose it" }));
    expect(seededRadio("ORI-004").checked).toBe(true);
    expect(document.activeElement).toBe(seededRadio("ORI-004"));
    expect(calls.filter((c) => c.path.startsWith("/api/onboarding")).map((c) => c.path)).toEqual(["/api/onboarding"]);
    expect(weekHeadings().slice(0, 3)).toEqual(["Week of Oct 12, 2026", "Week of Oct 19, 2026", "Week of Oct 26, 2026"]);
  });

  it("shows a manager booking for Olivia where her due date falls, and which sessions come after it", async () => {
    const { calls } = renderPicker(deepa, { props: { initialEmployeeId: "E0024" } });
    const due = await screen.findByTestId("due-row");
    expect(due.textContent).toBe("Orientation task due Oct 21, 2026 for Olivia Morgan");
    expect(sessionsIn("Week of Oct 12, 2026")).toEqual(["ORI-001", "ORI-002"]);
    expect(sessionsIn("Week of Oct 19, 2026")).toEqual(["ORI-003", "due", "ORI-004", "ORI-005"]);
    expect(seededRadio("ORI-001").disabled).toBe(true);
    expect(document.getElementById("session-ORI-001-seats")?.textContent).toBe("Full");
    expect(document.getElementById("session-ORI-001-seats")?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // Names are unchanged; the seats and the due date describe each radio.
    expect(seededRadio("ORI-004").getAttribute("aria-labelledby")).toBe("session-ORI-004-title session-ORI-004-meta session-ORI-004-starts");
    expect(seededRadio("ORI-004").getAttribute("aria-describedby")).toBe("session-ORI-004-seats session-ORI-004-due");
    expect(seededRadio("ORI-003").getAttribute("aria-describedby")).toBe("session-ORI-003-seats");
    expect(screen.getByRole("radio", { name: "New Hire Orientation (Global, virtual) ORI-004 · Video call (link sent after booking) Oct 22, 2026 15:00 UTC" })).toBe(seededRadio("ORI-004"));
    expect(document.getElementById("session-ORI-004-due")?.textContent).toBe("after the due date");
    expect(document.getElementById("session-ORI-002-seats")?.textContent).toBe("17 of 18 left");
    expect(calls.filter((c) => c.path.startsWith("/api/onboarding")).map((c) => c.path)).toEqual(["/api/onboarding/E0024"]);
    // The soonest open session follows the region filter.
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "US" } });
    expect(screen.getByTestId("soonest-open").textContent).toContain("(ORI-006), Oct 26, 2026 16:00 UTC, in 25 days");
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "GLOBAL" } });
    expect(screen.getByTestId("soonest-open").textContent).toContain("(ORI-004), Oct 22, 2026");
  });

  it("asks for the new attendee's checklist when the attendee changes, and says another person's due date has passed", async () => {
    const past = progressFor("E0033");
    const orientation = past.tasks.find((t) => t.category === "orientation")!;
    orientation.dueDate = "2026-09-21";
    const { calls } = renderPicker(deepa, { props: { initialEmployeeId: "E0024" }, extra: [{ path: "/api/onboarding/E0033", body: past }] });
    await screen.findByTestId("due-row");
    fireEvent.change(screen.getByLabelText("Attendee"), { target: { value: "E0033" } });
    expect((await screen.findByTestId("due-past")).textContent).toBe("Zara Kim's orientation task was due Sep 21, 2026, so every session is after it.");
    expect(screen.queryByTestId("due-row")).toBeNull();
    expect(calls.filter((c) => c.path.startsWith("/api/onboarding")).map((c) => c.path)).toEqual(["/api/onboarding/E0024", "/api/onboarding/E0033"]);
  });

  it("sets no rule when the attendee has no orientation task or no plan (404)", async () => {
    const noTask = progressFor("E0024");
    noTask.tasks = noTask.tasks.filter((t) => t.category !== "orientation");
    renderPicker(deepa, { props: { initialEmployeeId: "E0024" }, extra: [{ path: "/api/onboarding/E0024", body: noTask }] });
    await screen.findByTestId("soonest-open");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("due-row")).toBeNull();
    expect(screen.queryByTestId("due-past")).toBeNull();
    cleanup();
    renderPicker(deepa, { props: { initialEmployeeId: "E0024" }, extra: [{ path: "/api/onboarding/E0024", status: 404, body: { error: { code: "not_found", message: "No onboarding plan found.", requestId: "r" } } }] });
    await screen.findByTestId("soonest-open");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("due-row")).toBeNull();
    expect(screen.queryByTestId("due-check-failed")).toBeNull();
  });

  it("keeps the form usable with a quiet note and Try again when the due date cannot be checked", async () => {
    let fail = true;
    const { calls, onProposed } = renderPicker(deepa, {
      props: { initialEmployeeId: "E0024" },
      extra: [{ path: "/api/onboarding/E0024", status: () => (fail ? 500 : 200), body: () => (fail ? failing : progressFor("E0024")) }],
    });
    const note = await screen.findByTestId("due-check-failed");
    expect(note.textContent).toContain("Could not check the orientation due date.");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(seededRadio("ORI-004"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(onProposed).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.method === "POST")[0]?.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-004", employeeId: "E0024" } });
    fail = false;
    fireEvent.click(within(note).getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("due-row")).textContent).toBe("Orientation task due Oct 21, 2026 for Olivia Morgan");
  });

  it("leaves out how soon a session is, and the due date rule, without a business date", async () => {
    const { calls } = renderPicker(nadia, { asOf: null });
    const soonest = await screen.findByTestId("soonest-open");
    expect(soonest.textContent).toContain("Oct 22, 2026 15:00 UTC");
    expect(soonest.textContent).not.toMatch(/in \d+ days/);
    expect(screen.queryByTestId("due-past")).toBeNull();
    expect(calls.some((c) => c.path.startsWith("/api/onboarding"))).toBe(false);
  });
});
