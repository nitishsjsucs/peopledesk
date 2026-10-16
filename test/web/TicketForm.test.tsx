import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { MeContext } from "../../src/web/lib/session.tsx";
import { NewTicketPage } from "../../src/web/pages/NewTicketPage.tsx";
import { actionsServer, installFetch, me, pendingTicket } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";

function renderPage(url = "/requests/ticket") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MeContext.Provider value={me}>
        <Routes>
          <Route path="/requests/ticket" element={<NewTicketPage />} />
          <Route path="/requests/orientation" element={<p>orientation page</p>} />
          <Route path="/actions" element={<p>actions page</p>} />
        </Routes>
        <LocationProbe />
      </MeContext.Provider>
    </MemoryRouter>,
  );
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const location = () => screen.getByTestId("location").textContent;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("TicketForm", () => {
  it("validates on the client with the shared zod schema and sends nothing when invalid", () => {
    const calls = installFetch([]);
    renderPage();
    fill("Subject", "Hi");
    fill("Description", "short");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.some((t) => /at least 5|>=5|5 character/i.test(t ?? ""))).toBe(true);
    expect(alerts.some((t) => /at least 10|>=10|10 character/i.test(t ?? ""))).toBe(true);
    expect(screen.getByLabelText("Subject").getAttribute("aria-invalid")).toBe("true");
    expect(calls).toHaveLength(0);
  });

  it("submits to /api/actions, then addresses the review step by URL and shows the card from GET /api/actions", async () => {
    const server = actionsServer();
    const calls = installFetch(server.routes);
    renderPage();
    fill("Category", "facilities");
    fill("Subject", "Desk chair is broken");
    fill("Description", "The height adjustment on my desk chair no longer works.");
    fill("Priority", "low");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/ticket?review=${id(1)}`);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review ticket request");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/actions", "GET /api/actions"]);
    expect(calls[0]!.body).toEqual({
      tool: "create_support_ticket",
      arguments: {
        category: "facilities",
        subject: "Desk chair is broken",
        description: "The height adjustment on my desk chair no longer works.",
        priority: "low",
      },
    });
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("shows the same card when the review URL is opened again (a reload)", async () => {
    const proposed = pendingTicket({ actionId: id(7), source: "form", conversationId: null });
    const calls = installFetch(actionsServer([proposed]).routes);
    renderPage(`/requests/ticket?review=${id(7)}`);
    expect(screen.getByRole("status").textContent).toBe("Loading your request...");
    await screen.findByTestId("approval-card");
    expect(screen.getByText("Laptop will not boot")).toBeTruthy();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/actions"]);
    expect(screen.queryByRole("link", { name: "Back to conversation" })).toBeNull();
  });

  it("says so when the review id is not among the viewer's requests", async () => {
    installFetch(actionsServer([]).routes);
    renderPage(`/requests/ticket?review=${id(9)}`);
    await screen.findByText("That request was not found among yours.");
    expect(screen.getByRole("link", { name: "See all your requests" }).getAttribute("href")).toBe("/actions");
  });

  it("edits a request that is awaiting approval: the update supersedes it and the URL moves to the new review step", async () => {
    const old = pendingTicket({ actionId: id(50) });
    const server = actionsServer([old]);
    const calls = installFetch(server.routes);
    renderPage(`/requests/ticket?edit=${old.actionId}`);
    expect((await screen.findByLabelText<HTMLInputElement>("Subject")).value).toBe("Laptop will not boot");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Edit ticket request");
    // The edited request came from chat, so the way back is offered.
    expect(screen.getByRole("link", { name: "Back to conversation" }).getAttribute("href")).toBe("/chat/c1");
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    await screen.findByTestId("approval-card");
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ tool: "create_support_ticket", supersedes: old.actionId });
    expect(location()).toBe(`/requests/ticket?review=${id(1)}`);
    // The replacement was proposed on the form, so it has no conversation of its own; the link follows
    // the edit back to the original.
    expect(screen.getByRole("link", { name: "Back to conversation" }).getAttribute("href")).toBe("/chat/c1");
  });

  it("renders no form for an edit of a request that was already replaced, and links to the replacement", async () => {
    const old = pendingTicket({ actionId: id(51), status: "rejected", supersededBy: id(52) });
    installFetch(actionsServer([old]).routes);
    renderPage(`/requests/ticket?edit=${old.actionId}`);
    const note = await screen.findByTestId("not-editable");
    expect(note.textContent).toContain("This request was already replaced by an edited request.");
    expect(screen.getByRole("link", { name: "See the new request" }).getAttribute("href")).toBe(`/actions?focus=${id(52)}`);
    expect(screen.queryByRole("button", { name: "Update request" })).toBeNull();
    expect(screen.queryByLabelText("Subject")).toBeNull();
  });

  it("renders no form for an edit of an approved, rejected or expired request, and offers to start again", async () => {
    const cases = [
      [pendingTicket({ actionId: id(60), status: "executed", result: { ticketId: "TKT-000151" } }), "This request was already approved."],
      [pendingTicket({ actionId: id(61), status: "rejected" }), "This request was already rejected."],
      [pendingTicket({ actionId: id(62), status: "expired" }), "This request expired before it was approved."],
      // Still awaiting approval in the list, but past its expiry: the server would refuse the edit.
      [pendingTicket({ actionId: id(63), expiresAt: new Date(Date.now() - 1000).toISOString() }), "This request expired before it was approved."],
    ] as const;
    for (const [action, text] of cases) {
      installFetch(actionsServer([action]).routes);
      const view = renderPage(`/requests/ticket?edit=${action.actionId}`);
      expect((await screen.findByTestId("not-editable")).textContent).toContain(text);
      expect(screen.getByRole("link", { name: "Start again with these details" }).getAttribute("href")).toBe(`/requests/ticket?from=${action.actionId}`);
      expect(screen.queryByRole("button", { name: "Update request" })).toBeNull();
      view.unmount();
    }
  });

  it("starts again from an earlier request: a prefilled form that proposes without supersedes", async () => {
    const old = pendingTicket({ actionId: id(70), status: "expired", conversationId: null });
    const calls = installFetch(actionsServer([old]).routes);
    renderPage(`/requests/ticket?from=${old.actionId}`);
    expect((await screen.findByLabelText<HTMLInputElement>("Subject")).value).toBe("Laptop will not boot");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ tool: "create_support_ticket", arguments: old.arguments });
    expect(location()).toBe(`/requests/ticket?review=${id(1)}`);
  });

  it("goes from review to Edit and back: the URL addresses each step, and Back shows the original as replaced", async () => {
    const server = actionsServer();
    const calls = installFetch(server.routes);
    renderPage();
    fill("Subject", "Monitor flickers");
    fill("Description", "The external monitor flickers every few seconds.");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // The form comes back, prefilled from the proposal, instead of the review card staying on screen.
    expect(await screen.findByRole("heading", { name: "Edit ticket request" })).toBeTruthy();
    expect(location()).toBe(`/requests/ticket?edit=${id(1)}`);
    expect(screen.queryByTestId("approval-card")).toBeNull();
    expect((await screen.findByLabelText<HTMLInputElement>("Subject")).value).toBe("Monitor flickers");
    fill("Subject", "Monitor flickers and goes black");
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    await screen.findByRole("heading", { name: "Review ticket request" });
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/ticket?review=${id(2)}`);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toMatchObject({
      tool: "create_support_ticket",
      arguments: { subject: "Monitor flickers and goes black" },
      supersedes: id(1),
    });
    // Back: the edit step was replaced by the new review step, so Back lands on the original's review,
    // which now shows it was replaced.
    fireEvent.click(screen.getByRole("button", { name: "Test back" }));
    await waitFor(() => expect(location()).toBe(`/requests/ticket?review=${id(1)}`));
    expect(await screen.findByText(/Replaced by an edited request/)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "Approve" }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("opens the orientation page when a ticket URL names a booking request", async () => {
    const booking = pendingTicket({ actionId: id(80), tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } });
    installFetch(actionsServer([booking]).routes);
    renderPage(`/requests/ticket?review=${booking.actionId}`);
    await screen.findByText("orientation page");
    expect(location()).toBe(`/requests/orientation?review=${booking.actionId}`);
  });
});
