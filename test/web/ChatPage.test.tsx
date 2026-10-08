import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { MeContext } from "../../src/web/lib/session.tsx";
import { ChatPage } from "../../src/web/pages/ChatPage.tsx";
import { installFetch, me, pendingTicket, ptoCitation, turn } from "./fixtures.ts";

const transcript = [
  { id: 1, turnId: "t1", role: "user", kind: "user", text: "How fast does PTO accrue?", createdAt: "2026-10-08T10:00:00Z" },
  {
    id: 2,
    turnId: "t1",
    role: "assistant",
    kind: "answer",
    text: "Paid time off accrues at 1.5 days per month.\n\nSource: PTO Accrual (POL-014 v3, effective 2026-01-01).",
    payload: turn({
      kind: "answer",
      text: "Paid time off accrues at 1.5 days per month.\n\nSource: PTO Accrual (POL-014 v3, effective 2026-01-01).",
      citations: [ptoCitation],
    }),
    createdAt: "2026-10-08T10:00:01Z",
  },
  { id: 3, turnId: "t2", role: "user", kind: "user", text: "How much is the stipend?", createdAt: "2026-10-08T10:01:00Z" },
  {
    id: 4,
    turnId: "t2",
    role: "assistant",
    kind: "clarify",
    text: "Which stipend do you mean: wellness, home office or internet?",
    payload: turn({ kind: "clarify", text: "Which stipend do you mean: wellness, home office or internet?" }),
    createdAt: "2026-10-08T10:01:01Z",
  },
  { id: 5, turnId: "t3", role: "user", kind: "user", text: "What is the spot bonus cap?", createdAt: "2026-10-08T10:02:00Z" },
  {
    id: 6,
    turnId: "t3",
    role: "assistant",
    kind: "refuse",
    text: "I couldn't find that in the policies available to you.",
    payload: turn({ kind: "refuse", text: "I couldn't find that in the policies available to you." }),
    createdAt: "2026-10-08T10:02:01Z",
  },
  { id: 7, turnId: "t4", role: "user", kind: "user", text: "And sick leave?", createdAt: "2026-10-08T10:03:00Z" },
  {
    id: 8,
    turnId: "t4",
    role: "assistant",
    kind: "error",
    text: "The assistant is unavailable right now. Please try again shortly.",
    payload: turn({
      kind: "error",
      text: "The assistant is unavailable right now. Please try again shortly.",
      error: { code: "provider_unavailable", message: "x" },
    }),
    createdAt: "2026-10-08T10:03:01Z",
  },
];

function renderChat() {
  return render(
    <MemoryRouter initialEntries={["/chat/c1"]}>
      <MeContext.Provider value={me}>
        <Routes>
          <Route path="/chat/:conversationId" element={<ChatPage />} />
          <Route path="/policies/:docId/v/:version" element={<p>version page</p>} />
        </Routes>
      </MeContext.Provider>
    </MemoryRouter>,
  );
}

describe("ChatPage", () => {
  it("renders answers with citation chips and opens the source drawer", async () => {
    installFetch([
      { path: "/api/conversations", body: { conversations: [{ id: "c1", title: "How fast does PTO accrue?", createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-08T10:03:01Z" }] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "How fast does PTO accrue?", messages: transcript } },
    ]);
    renderChat();
    const chip = await screen.findByRole("button", { name: /Source: PTO Accrual, POL-014 v3, effective 2026-01-01/ });
    expect(chip.textContent).toContain("PTO Accrual");
    expect(chip.textContent).toContain("POL-014 v3");
    expect(chip.textContent).toContain("effective Jan 1, 2026");
    // The answer body shows without the raw source line (the chips carry the source).
    expect(screen.getByText("Paid time off accrues at 1.5 days per month.")).toBeTruthy();

    fireEvent.click(chip);
    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByTestId("source-quote").textContent).toBe(ptoCitation.quote);
    expect(within(drawer).getByText(/effective Jan 1, 2026/)).toBeTruthy();
    expect(within(drawer).getByRole("link").getAttribute("href")).toBe("/policies/POL-014/v/3");
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders clarify, refuse and error states, with a retry on errors", async () => {
    const calls = installFetch([
      { path: "/api/conversations", body: { conversations: [] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: transcript } },
      {
        method: "POST",
        path: "/api/conversations/c1/messages",
        body: turn({ kind: "answer", text: "Sick leave accrues at 1.0 days per month.\n\nSource: Sick Leave (POL-002 v1, effective 2026-01-01).", citations: [{ ...ptoCitation, docId: "POL-002", title: "Sick Leave", passageId: "POL-002@1#3", version: 1 }] }),
      },
    ]);
    const { container } = renderChat();
    await screen.findByText("Which stipend do you mean: wellness, home office or internet?");
    expect(container.querySelector('[data-kind="clarify"]')).toBeTruthy();
    expect(container.querySelector('[data-kind="refuse"]')?.textContent).toContain("I couldn't find that");
    const error = container.querySelector('[data-kind="error"]') as HTMLElement;
    expect(error.textContent).toContain("unavailable");
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    await screen.findByText("Sick leave accrues at 1.0 days per month.");
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ text: "And sick leave?" });
  });

  it("sends from the composer and shows the reply; the list is a polite live region", async () => {
    installFetch([
      { path: "/api/conversations", body: { conversations: [] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: [] } },
      { method: "POST", path: "/api/conversations/c1/messages", body: turn({ kind: "refuse", text: "I can help with company policies, support tickets, onboarding and orientation sessions." }) },
    ]);
    const { container } = renderChat();
    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "Tell me a joke" } });
    expect(screen.getByText("14 / 2000")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/I can help with company policies/);
    expect(container.querySelector(".message-list")?.getAttribute("aria-live")).toBe("polite");
  });

  describe("approval cards in a reloaded transcript", () => {
    // The transcript stores each turn as it was: this card was awaiting approval when it was proposed.
    const proposedThen = pendingTicket();
    const withCard = [
      { id: 1, turnId: "t1", role: "user", kind: "user", text: "Open an IT ticket, my laptop will not boot", createdAt: "2026-10-08T10:00:00Z" },
      {
        id: 2,
        turnId: "t1",
        role: "assistant",
        kind: "approval_required",
        text: "I prepared this request: New support ticket.",
        payload: turn({ kind: "approval_required", text: "I prepared this request: New support ticket.", pendingAction: proposedThen }),
        createdAt: "2026-10-08T10:00:01Z",
      },
    ];
    const routes = [
      { path: "/api/conversations", body: { conversations: [] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: withCard } },
    ];

    it("shows the request's current state, not the stored one, once it has been decided", async () => {
      const calls = installFetch([
        ...routes,
        { path: "/api/actions", body: { actions: [{ ...proposedThen, status: "rejected" }] } },
      ]);
      const { container } = renderChat();
      await screen.findByText("Rejected. Nothing was submitted.");
      const card = container.querySelector('[data-testid="approval-card"]') as HTMLElement;
      expect((within(card).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
      expect(within(card).queryByText(/Expires in/)).toBeNull();
      expect(calls.filter((c) => c.path === "/api/actions")).toHaveLength(1);
    });

    it("keeps the stored card when the current state cannot be loaded", async () => {
      installFetch([...routes, { path: "/api/actions", status: 500, body: { error: { code: "internal", message: "x", requestId: "r" } } }]);
      const { container } = renderChat();
      await screen.findByText("I prepared this request: New support ticket.");
      const card = (await waitFor(() => container.querySelector('[data-testid="approval-card"]'))) as HTMLElement;
      expect((within(card).getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("does not ask for actions when no stored card is awaiting approval", async () => {
      const calls = installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: transcript } },
      ]);
      await (renderChat(), screen.findByText("Which stipend do you mean: wellness, home office or internet?"));
      expect(calls.filter((c) => c.path === "/api/actions")).toHaveLength(0);
    });
  });
});
