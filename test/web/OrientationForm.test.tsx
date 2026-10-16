import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Me, PendingActionView } from "../../src/shared/api-types.ts";
import { OrientationForm } from "../../src/web/components/OrientationForm.tsx";
import { MeContext } from "../../src/web/lib/session.tsx";
import { ScheduleOrientationPage } from "../../src/web/pages/ScheduleOrientationPage.tsx";
import { actionsServer, installFetch, me, pendingTicket } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";

const session = (id: string, seatsRemaining: number, capacity = 10) => ({
  id,
  title: `New hire orientation ${id}`,
  startsAt: "2026-10-20T16:00:00.000Z",
  durationMin: 90,
  format: "virtual" as const,
  region: "GLOBAL" as const,
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

function renderForm(who: Me, team: unknown = { members: [] }) {
  const onProposed = vi.fn();
  const calls = installFetch([
    { path: "/api/orientation-sessions", body: sessions },
    { path: "/api/team", body: team },
    { method: "POST", path: "/api/actions", status: 201, body: (init: RequestInit) => proposed(JSON.parse(String(init.body)).arguments) },
  ]);
  render(
    <MeContext.Provider value={who}>
      <OrientationForm onProposed={onProposed} />
    </MeContext.Provider>,
  );
  return { calls, onProposed, posts: () => calls.filter((c) => c.method === "POST") };
}

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

  it("validates on the client and sends nothing without a session", async () => {
    const { posts } = renderForm(newHire);
    await screen.findByLabelText("New hire orientation ORI-002, ORI-002");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Choose a session.");
    expect(posts()).toHaveLength(0);
  });

  it("offers a manager only reports in onboarding without a booking, and proposes for the attendee shown", async () => {
    const team = {
      members: [
        { employeeId: "E0101", fullName: "Ana Lima", inOnboarding: true, booked: false },
        { employeeId: "E0102", fullName: "Ben Cole", inOnboarding: true, booked: true },
        { employeeId: "E0103", fullName: "Chen Wei", inOnboarding: false, booked: false },
      ],
    };
    const { posts, onProposed } = renderForm(manager, team);
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
    const team = {
      members: [
        { employeeId: "E0101", fullName: "Ana Lima", inOnboarding: true, booked: false },
        { employeeId: "E0104", fullName: "Dina Haddad", inOnboarding: true, booked: false },
      ],
    };
    const { posts } = renderForm(hrAdmin, team);
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Dina Haddad (E0104)" });
    expect(select.value).toBe("E0101");
    fireEvent.change(select, { target: { value: "E0104" } });
    fireEvent.click(screen.getByLabelText("New hire orientation ORI-002, ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002", employeeId: "E0104" } });
  });

  it("lists a manager who is in onboarding first, as themself, and proposes without an employee id", async () => {
    const team = { members: [{ employeeId: "E0101", fullName: "Ana Lima", inOnboarding: true, booked: false }] };
    const { posts } = renderForm({ ...manager, inOnboarding: true }, team);
    const select = (await screen.findByLabelText("Attendee")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "Ana Lima (E0101)" });
    expect([...select.options].map((o) => o.textContent)).toEqual(["Grace Okafor (you) (E0007)", "Ana Lima (E0101)"]);
    expect(select.value).toBe("E0007");
    fireEvent.click(screen.getByLabelText("New hire orientation ORI-002, ORI-002"));
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]!.body).toEqual({ tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } });
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
    const calls = installFetch([{ path: "/api/orientation-sessions", body: sessions }, ...server.routes]);
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
    installFetch([{ path: "/api/orientation-sessions", body: sessions }, ...actionsServer([proposedEarlier]).routes]);
    renderPage(`/requests/orientation?review=${proposedEarlier.actionId}`);
    await screen.findByTestId("approval-card");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review orientation request");
  });

  it("starts again from an expired request without superseding it", async () => {
    const old = { ...proposed({ sessionId: "ORI-002" }), status: "expired" as const };
    const calls = installFetch([{ path: "/api/orientation-sessions", body: sessions }, ...actionsServer([old]).routes]);
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
    installFetch([{ path: "/api/orientation-sessions", body: sessions }, ...actionsServer([old]).routes]);
    renderPage(`/requests/orientation?edit=${old.actionId}`);
    expect((await screen.findByTestId("not-editable")).textContent).toContain("replaced by an edited request");
    expect(screen.getByRole("link", { name: "See the new request" }).getAttribute("href")).toBe(`/actions?focus=${id(5)}`);
    expect(screen.queryByRole("button", { name: "Update request" })).toBeNull();
  });
});
