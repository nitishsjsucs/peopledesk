import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingActionView } from "../../src/shared/api-types.ts";
import { setFetch } from "../../src/web/lib/api.ts";
import { ApprovalCard } from "../../src/web/components/ApprovalCard.tsx";
import { wantsStepFocus } from "../../src/web/lib/requests.ts";
import { installFetch, pendingTicket } from "./fixtures.ts";

function EditTarget() {
  const l = useLocation();
  return (
    <p data-testid="edit-target" data-step-focus={String(wantsStepFocus(l.state))}>
      {`${l.pathname}${l.search}`}
    </p>
  );
}

function renderCard(action: PendingActionView) {
  return render(
    <MemoryRouter initialEntries={["/chat/c1"]}>
      <Routes>
        <Route path="/chat/:id" element={<ApprovalCard action={action} />} />
        <Route path="/requests/ticket" element={<EditTarget />} />
        <Route path="/requests/orientation" element={<EditTarget />} />
      </Routes>
    </MemoryRouter>,
  );
}

const booking = (overrides: Partial<PendingActionView> = {}) =>
  pendingTicket({
    tool: "schedule_orientation_session",
    arguments: { sessionId: "ORI-006" },
    preview: {
      title: "Book orientation session",
      fields: [
        { label: "Attendee", value: "Nadia Fernandes (E0025)" },
        { label: "Session", value: "New Hire Orientation (US, virtual) (ORI-006)" },
        { label: "Starts", value: "2026-10-26 16:00 UTC" },
        { label: "Location", value: "Video call" },
      ],
    },
    ...overrides,
  });

const outcome = () => screen.getByTestId("approval-outcome");
const linkIn = (el: HTMLElement, name: string) => within(el).getByRole("link", { name }).getAttribute("href");

afterEach(() => {
  vi.useRealTimers();
});

describe("ApprovalCard", () => {
  it("shows the preview fields and the expiry, readable by screen readers but never announced as it changes", () => {
    installFetch([]);
    renderCard(pendingTicket());
    expect(screen.getByText("New support ticket")).toBeTruthy();
    expect(screen.getByText("Subject")).toBeTruthy();
    expect(screen.getByText("Laptop will not boot")).toBeTruthy();
    const expiry = screen.getByTestId("approval-expiry");
    expect(expiry.textContent).toBe("Expires in 14 min");
    expect(expiry.getAttribute("aria-hidden")).toBeNull();
    expect(expiry.closest("[aria-live], [role=status], [role=alert]")).toBeNull();
    expect(screen.getByTestId("approval-announcer").textContent).toBe("");
  });

  it("approves by keyboard, then shows the outcome with a link to My tickets and moves focus to it", async () => {
    const action = pendingTicket();
    const calls = installFetch([
      {
        method: "POST",
        path: `/api/actions/${action.actionId}/approve`,
        body: { status: "executed", result: { ticketId: "TKT-000151" }, replayed: false },
      },
    ]);
    renderCard(action);
    const approve = screen.getByRole("button", { name: "Approve" });
    approve.focus();
    fireEvent.click(approve); // Enter or Space on a focused button
    await screen.findByText(/ticket TKT-000151 was created/);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /api/actions/${action.actionId}/approve`]);
    expect(document.activeElement).toBe(outcome());
    expect(linkIn(outcome(), "View in My tickets")).toBe("/tickets");
    // The decided card has no buttons at all, so nothing disabled is left in the tab order.
    expect(within(screen.getByTestId("approval-card")).queryAllByRole("button")).toHaveLength(0);
  });

  it("keeps focus on the button while the request is in flight, and on an error", async () => {
    const action = pendingTicket();
    let release: (r: Response) => void = () => {};
    const calls: string[] = [];
    setFetch((input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Promise<Response>((resolve) => (release = resolve));
    });
    renderCard(action);
    const approve = screen.getByRole("button", { name: "Approve" });
    approve.focus();
    fireEvent.click(approve);
    await waitFor(() => expect(approve.getAttribute("aria-disabled")).toBe("true"));
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(approve);
    // A second click while busy sends nothing more.
    fireEvent.click(approve);
    expect(calls).toEqual([`POST /api/actions/${action.actionId}/approve`]);
    release(new Response(JSON.stringify({ error: { code: "internal", message: "Internal error.", requestId: "r" } }), { status: 500 }));
    expect((await screen.findByRole("alert")).textContent).toBe("Internal error.");
    expect(document.activeElement).toBe(approve);
    expect(approve.getAttribute("aria-disabled")).toBeNull();
  });

  it("names the attendee, session and start of an executed booking, and links to onboarding", async () => {
    const action = booking();
    installFetch([
      {
        method: "POST",
        path: `/api/actions/${action.actionId}/approve`,
        body: { status: "executed", result: { bookingId: `BKG-${action.actionId}`, sessionId: "ORI-006" }, replayed: false },
      },
    ]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByTestId("approval-outcome");
    expect(outcome().textContent).toContain(
      "Done: Nadia Fernandes (E0025) is booked into New Hire Orientation (US, virtual) (ORI-006), starting 2026-10-26 16:00 UTC.",
    );
    expect(outcome().textContent).not.toContain("BKG-");
    expect(linkIn(outcome(), "View onboarding")).toBe("/onboarding");
  });

  it("falls back to the session id when a stored booking's preview lacks the session", () => {
    installFetch([]);
    renderCard(booking({ status: "executed", result: { bookingId: "BKG-1", sessionId: "ORI-007" }, preview: { title: "Book orientation session", fields: [] } }));
    expect(outcome().textContent).toContain("Done: booked into ORI-007.");
  });

  it("offers another session when a booking failed because the session is full", async () => {
    const action = booking();
    installFetch([
      { method: "POST", path: `/api/actions/${action.actionId}/approve`, body: { status: "failed", errorCode: "session_full", replayed: true } },
    ]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/Already approved earlier. Approved, but it could not be completed: the session is full./);
    expect(linkIn(outcome(), "Pick another session")).toBe(`/requests/orientation?from=${action.actionId}`);
  });

  it("gives the plain reason for another failure, and offers to start again", () => {
    installFetch([]);
    const action = booking({ status: "failed", errorCode: "already_booked" });
    renderCard(action);
    expect(outcome().textContent).toContain("this person already has an orientation booking");
    expect(linkIn(outcome(), "Start again with these details")).toBe(`/requests/orientation?from=${action.actionId}`);
  });

  it("rejects through the reject endpoint and offers to start again", async () => {
    const action = pendingTicket();
    const calls = installFetch([{ method: "POST", path: `/api/actions/${action.actionId}/reject`, body: { status: "rejected" } }]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText(/Rejected. Nothing was submitted./);
    expect(outcome().querySelector(".status-pill")?.textContent).toBe("rejected");
    expect(calls[0]?.path).toBe(`/api/actions/${action.actionId}/reject`);
    expect(document.activeElement).toBe(outcome());
    expect(linkIn(outcome(), "Start again with these details")).toBe(`/requests/ticket?from=${action.actionId}`);
  });

  it("links a replaced request to its replacement", () => {
    installFetch([]);
    renderCard(pendingTicket({ status: "rejected", supersededBy: "99999999-9999-4999-8999-999999999999" }));
    expect(outcome().textContent).toContain("Replaced by an edited request.");
    // Stored as rejected, but the person never rejected it.
    expect(outcome().querySelector(".status-pill")?.textContent).toBe("replaced");
    expect(screen.getByTestId("approval-card").getAttribute("aria-label")).toBe("Request, replaced: New support ticket");
    expect(linkIn(outcome(), "See the new request")).toBe("/actions?focus=99999999-9999-4999-8999-999999999999");
  });

  it("renders a request that expired before it was shown as expired, with a way to start again", () => {
    installFetch([]);
    const action = pendingTicket({ status: "expired" });
    renderCard(action);
    expect(outcome().textContent).toContain("Expired before it was approved.");
    expect(linkIn(outcome(), "Start again with these details")).toBe(`/requests/ticket?from=${action.actionId}`);
    // Awaiting approval in the stored view, but already past its expiry.
    renderCard(pendingTicket({ actionId: crypto.randomUUID(), expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(screen.getAllByTestId("approval-outcome")[1]?.textContent).toContain("Expired before it was approved.");
  });

  it("shows the expired outcome when a reject answers 410, after reading the current state", async () => {
    const action = pendingTicket();
    const calls = installFetch([
      { method: "POST", path: `/api/actions/${action.actionId}/reject`, status: 410, body: { error: { code: "expired", message: "This request already expired.", requestId: "r" } } },
      { path: "/api/actions", body: { actions: [{ ...action, status: "expired" }] } },
    ]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText(/Expired before it was approved/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /api/actions/${action.actionId}/reject`, "GET /api/actions"]);
  });

  it("re-reads GET /api/actions when an approve answers 409, and shows the request's true state", async () => {
    const action = pendingTicket();
    const calls = installFetch([
      { method: "POST", path: `/api/actions/${action.actionId}/approve`, status: 409, body: { error: { code: "not_pending", message: "This request is already executed.", requestId: "r" } } },
      { path: "/api/actions", body: { actions: [{ ...action, status: "executed", result: { ticketId: "TKT-000160" } }] } },
    ]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/ticket TKT-000160 was created/);
    expect(calls.map((c) => c.path)).toContain("/api/actions");
    expect(document.activeElement).toBe(outcome());
  });

  it("falls back to the server's message when the current state cannot be read", async () => {
    const action = pendingTicket();
    installFetch([
      { method: "POST", path: `/api/actions/${action.actionId}/approve`, status: 409, body: { error: { code: "not_pending", message: "This request is already rejected.", requestId: "r" } } },
      { path: "/api/actions", status: 500, body: { error: { code: "internal", message: "x", requestId: "r" } } },
    ]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/This request is already rejected./);
  });

  it("announces only at one minute left and at expiry", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
    installFetch([]);
    const action = pendingTicket({ expiresAt: "2026-10-08T10:01:05.000Z" });
    renderCard(action);
    const announcer = screen.getByTestId("approval-announcer");
    await act(async () => vi.advanceTimersByTime(3000));
    expect(announcer.textContent).toBe("");
    await act(async () => vi.advanceTimersByTime(3000));
    expect(announcer.textContent).toBe("1 minute left to approve");
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(announcer.textContent).toBe("1 minute left to approve");
    expect(screen.getByTestId("approval-expiry").textContent).toBe("Expires in 29 s");
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(announcer.textContent).toBe("This request expired");
    expect(outcome().textContent).toContain("Expired before it was approved.");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("opens the edit step of the request's page on Edit, addressed by the URL", async () => {
    installFetch([]);
    const action = pendingTicket();
    const view = renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((await screen.findByTestId("edit-target")).textContent).toBe(`/requests/ticket?edit=${action.actionId}`);
    // The edit step's heading takes focus once it loads (RequestSteps), from chat as from the review step.
    expect(screen.getByTestId("edit-target").getAttribute("data-step-focus")).toBe("true");
    view.unmount();
    const b = booking();
    renderCard(b);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((await screen.findByTestId("edit-target")).textContent).toBe(`/requests/orientation?edit=${b.actionId}`);
  });

  it("renders an already decided action with its outcome and no buttons", () => {
    installFetch([]);
    renderCard(pendingTicket({ status: "executed", result: { ticketId: "TKT-000151" } }));
    expect(outcome().textContent).toContain("TKT-000151");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
