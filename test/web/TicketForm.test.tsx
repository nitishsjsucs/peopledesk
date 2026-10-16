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
  it("validates on the client with the shared zod schema, in plain words, and sends nothing when invalid", async () => {
    const calls = installFetch([]);
    renderPage();
    fill("Subject", "Hi");
    fill("Description", "short");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    // One summary alert, not one per field.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual(["Check 2 fields: Subject, Description."]);
    expect(screen.getByText("Subject needs at least 5 characters.")).toBeTruthy();
    expect(screen.getByText("Description needs at least 10 characters.")).toBeTruthy();
    const subject = screen.getByLabelText("Subject");
    expect(subject.getAttribute("aria-invalid")).toBe("true");
    expect(subject.getAttribute("aria-describedby")).toBe("ticket-subject-hint ticket-subject-error");
    expect(screen.getByLabelText("Description").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Category").getAttribute("aria-invalid")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(subject));
    expect(calls.filter((c) => c.path === "/api/actions")).toHaveLength(0);
  });

  it("checks the related policy id on the client, tied to its field", async () => {
    installFetch([]);
    renderPage();
    fill("Subject", "Laptop will not boot");
    fill("Description", "Black screen after the logo every time.");
    fill("Related policy (optional)", "policy 14");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    expect(screen.getByRole("alert").textContent).toBe("Check 1 field: Related policy.");
    const policy = screen.getByLabelText("Related policy (optional)");
    expect(policy.getAttribute("aria-invalid")).toBe("true");
    expect(policy.getAttribute("aria-describedby")).toContain("ticket-relatedPolicyId-error");
    expect(screen.getByText("Use a policy id like POL-014.").id).toBe("ticket-relatedPolicyId-error");
    await waitFor(() => expect(document.activeElement).toBe(policy));
  });

  it("puts the server's related policy refusal under Related policy, not as a raw string", async () => {
    installFetch([
      {
        method: "POST",
        path: "/api/actions",
        status: 400,
        body: { error: { code: "validation_error", message: "relatedPolicyId: must be a policy you can read.", requestId: "r", details: { reason: "validation_error" } } },
      },
    ]);
    renderPage();
    fill("Subject", "Laptop will not boot");
    fill("Description", "Black screen after the logo every time.");
    fill("Related policy (optional)", "POL-099");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    expect(await screen.findByText("Choose a policy you can read, for example POL-014.")).toBeTruthy();
    expect(screen.queryByText(/must be a policy you can read/)).toBeNull();
    expect(screen.getByLabelText("Related policy (optional)").getAttribute("aria-invalid")).toBe("true");
  });

  it("links to My requests when too many requests are pending", async () => {
    installFetch([
      {
        method: "POST",
        path: "/api/actions",
        status: 429,
        body: { error: { code: "rate_limited", message: "You already have 5 requests awaiting approval. Approve or reject one first.", requestId: "r", details: { reason: "rate_limited" } } },
      },
    ]);
    renderPage();
    fill("Subject", "Laptop will not boot");
    fill("Description", "Black screen after the logo every time.");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You already have 5 requests awaiting approval.");
    expect(screen.getByRole("link", { name: "Review your requests" }).getAttribute("href")).toBe("/actions");
  });

  it("labels priorities in words and suggests the policies the person can read", async () => {
    installFetch([
      {
        path: "/api/policies",
        body: { documents: [{ docId: "POL-014", title: "Wellness Stipend", category: "benefits", audience: "all", currentVersion: 2, effectiveFrom: "2026-06-01", updatedAt: "2026-06-01" }] },
      },
    ]);
    renderPage();
    expect([...(screen.getByLabelText("Priority") as HTMLSelectElement).options].map((o) => [o.value, o.textContent])).toEqual([
      ["low", "Low"],
      ["normal", "Normal"],
      ["high", "High"],
    ]);
    const options = await screen.findByTestId("ticket-policy-options");
    expect(screen.getByLabelText("Related policy (optional)").getAttribute("list")).toBe(options.id);
    expect([...options.querySelectorAll("option")].map((o) => [o.getAttribute("value"), o.textContent])).toEqual([["POL-014", "Wellness Stipend"]]);
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
    // The form (and its focused button) is gone, so the new step's heading takes focus.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review ticket request" })));
    const actionCalls = calls.filter((c) => c.path === "/api/actions");
    expect(actionCalls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/actions", "GET /api/actions"]);
    expect(actionCalls[0]!.body).toEqual({
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
    // Opening the URL is not a step change on the page, so focus stays where the browser put it.
    expect(document.activeElement).toBe(document.body);
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

  it("moves focus to the heading of the step a Start again or See the outcome link opens", async () => {
    const done = pendingTicket({ actionId: id(65), status: "executed", result: { ticketId: "TKT-000151" }, conversationId: null });
    installFetch(actionsServer([done]).routes);
    const view = renderPage(`/requests/ticket?edit=${done.actionId}`);
    fireEvent.click(await screen.findByRole("link", { name: "See the outcome" }));
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/ticket?review=${done.actionId}`);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review ticket request" })));
    view.unmount();
    const rejected = pendingTicket({ actionId: id(66), status: "rejected", conversationId: null });
    installFetch(actionsServer([rejected]).routes);
    renderPage(`/requests/ticket?review=${rejected.actionId}`);
    fireEvent.click(await screen.findByRole("link", { name: "Start again with these details" }));
    expect((await screen.findByLabelText<HTMLInputElement>("Subject")).value).toBe("Laptop will not boot");
    expect(location()).toBe(`/requests/ticket?from=${rejected.actionId}`);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "New support ticket" })));
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
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Edit ticket request" }));
    fill("Subject", "Monitor flickers and goes black");
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    await screen.findByRole("heading", { name: "Review ticket request" });
    await screen.findByTestId("approval-card");
    expect(location()).toBe(`/requests/ticket?review=${id(2)}`);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Review ticket request" })));
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
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.getByRole("link", { name: "See the new request" }).getAttribute("href")).toBe(`/actions?focus=${id(2)}`);
  });

  it("opens the orientation page when a ticket URL names a booking request", async () => {
    const booking = pendingTicket({ actionId: id(80), tool: "schedule_orientation_session", arguments: { sessionId: "ORI-002" } });
    installFetch(actionsServer([booking]).routes);
    renderPage(`/requests/ticket?review=${booking.actionId}`);
    await screen.findByText("orientation page");
    expect(location()).toBe(`/requests/orientation?review=${booking.actionId}`);
  });
});
