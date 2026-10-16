import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeContext } from "../../src/web/lib/session.tsx";
import { ChatPage } from "../../src/web/pages/ChatPage.tsx";
import { installFetch, me, pendingTicket, ptoCitation, turn } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";

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

function renderChat(url = "/chat/c1") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MeContext.Provider value={me}>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:conversationId" element={<ChatPage />} />
          <Route path="/policies/:docId/v/:version" element={<p>version page</p>} />
        </Routes>
        <LocationProbe />
      </MeContext.Provider>
    </MemoryRouter>,
  );
}

const rateLimited = (seconds: number) => ({
  error: { code: "rate_limited", message: `You have sent too many messages. Try again in ${seconds} seconds.`, requestId: "r", details: { scope: "user", retryAfterSeconds: seconds } },
});

/** Lets fake fetches, effects and fake timers run (fake timers stop testing-library's waitFor). */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

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

  it("sends from the composer, announces only the new reply, and returns focus to the composer", async () => {
    installFetch([
      { path: "/api/conversations", body: { conversations: [] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: transcript.slice(0, 2) } },
      { method: "POST", path: "/api/conversations/c1/messages", body: turn({ kind: "refuse", text: "I can help with company policies, support tickets, onboarding and orientation sessions." }) },
    ]);
    const { container } = renderChat();
    await screen.findByText("Paid time off accrues at 1.5 days per month.");
    const announcer = screen.getByTestId("chat-announcer");
    // A stored transcript is not read out: the list is not a live region and the status is empty.
    expect(container.querySelector(".message-list")?.hasAttribute("aria-live")).toBe(false);
    expect(announcer.textContent).toBe("");
    const input = screen.getByLabelText("Message") as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: "Tell me a joke" } });
    expect(screen.getByText("14 / 2000")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(announcer.textContent).toBe("PeopleDesk is working on it"));
    await screen.findByText(/I can help with company policies/);
    expect(announcer.textContent).toBe("I can help with company policies, support tickets, onboarding and orientation sessions.");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("announces an answer without its source line, and focuses the composer after a suggestion's turn", async () => {
    const answer = "Paid time off accrues at 1.5 days per month.\n\nSource: PTO Accrual (POL-014 v3, effective 2026-01-01).";
    installFetch([
      { path: "/api/conversations", body: { conversations: [] } },
      { method: "POST", path: "/api/conversations", status: 201, body: { id: "c7" } },
      { path: "/api/conversations/c7", body: { id: "c7", title: "t", messages: [] } },
      { method: "POST", path: "/api/conversations/c7/messages", body: turn({ kind: "answer", text: answer, citations: [ptoCitation] }) },
    ]);
    renderChat("/chat");
    fireEvent.click(await screen.findByRole("button", { name: "How fast does paid time off accrue?" }));
    await screen.findByText("Paid time off accrues at 1.5 days per month.");
    expect(screen.getByTestId("chat-announcer").textContent).toBe("Paid time off accrues at 1.5 days per month.");
    await waitFor(() => expect(document.activeElement?.id).toBe("chat-input"));
  });

  describe("source drawer", () => {
    const routes = [
      { path: "/api/conversations", body: { conversations: [] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: transcript.slice(0, 2) } },
    ];

    it("keeps Tab inside, closes on Escape and Close, and returns focus to the chip", async () => {
      installFetch(routes);
      renderChat();
      const chip = await screen.findByRole("button", { name: /Source: PTO Accrual/ });
      chip.focus();
      fireEvent.click(chip);
      const drawer = await screen.findByRole("dialog");
      const close = within(drawer).getByRole("button", { name: "Close" });
      const link = within(drawer).getByRole("link");
      expect(document.activeElement).toBe(close);
      // The page behind the dialog is inert while it is open.
      expect(document.querySelector("#chat-input")?.closest("[inert]")).not.toBeNull();
      link.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(close);
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(link);
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(chip);
      expect(document.querySelector("[inert]")).toBeNull();

      fireEvent.click(chip);
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(chip);
    });

    it("does not move focus back to Close when the chat re-renders while it is open", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      installFetch([...routes, { method: "POST", path: "/api/conversations/c1/messages", body: async () => (await held, turn({ kind: "refuse", text: "Later reply." })) }]);
      renderChat();
      await settle();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "A slow question" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await settle();
      fireEvent.click(screen.getByRole("button", { name: /Source: PTO Accrual/ }));
      await settle();
      const link = within(screen.getByRole("dialog")).getByRole("link");
      link.focus();
      // The elapsed-time ticker re-renders the chat page every second.
      await settle(3000);
      expect(document.activeElement).toBe(link);
      release();
      await settle();
      expect(document.activeElement).toBe(link);
    });
  });

  it("shows the server's rate limit message when a send answers 429, and keeps the text for a retry", async () => {
    installFetch([
      { path: "/api/conversations", body: { conversations: [] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: [] } },
      {
        method: "POST",
        path: "/api/conversations/c1/messages",
        status: 429,
        body: { error: { code: "rate_limited", message: "You have sent too many messages. Try again in 42 seconds.", requestId: "r", details: { scope: "user", retryAfterSeconds: 42 } } },
      },
    ]);
    const { container } = renderChat();
    const input = await screen.findByLabelText("Message");
    fireEvent.change(input, { target: { value: "How much PTO do I get?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("You have sent too many messages. Try again in 42 seconds.");
    const retry = within(container.querySelector(".message-list") as HTMLElement).getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    // Until retryAfterSeconds has passed, neither Retry nor Send can be used.
    expect(retry.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "And sick leave?" } });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/You can send again in 4\d s\./)).toBeTruthy();
  });

  it("re-enables Retry and Send when the rate limit countdown reaches zero", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    installFetch([
      { path: "/api/conversations", body: { conversations: [] } },
      { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: [] } },
      { method: "POST", path: "/api/conversations/c1/messages", status: 429, body: rateLimited(3) },
    ]);
    renderChat();
    await settle();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "How much PTO do I get?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await settle();
    const retry = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Again" } });
    expect(retry.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    expect(screen.getByText("You can send again in 3 s.")).toBeTruthy();
    await settle(1000);
    expect(screen.getByText("You can send again in 2 s.")).toBeTruthy();
    await settle(2000);
    expect(screen.queryByText(/You can send again/)).toBeNull();
    expect((screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
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
      expect(within(card).queryByRole("button", { name: "Approve" })).toBeNull();
      expect(within(card).getByRole("link", { name: "Start again with these details" })).toBeTruthy();
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

  describe("conversations and failures", () => {
    const transcriptOf = (id: string, question: string) => ({
      id,
      title: question,
      messages: [
        { id: 1, turnId: "t1", role: "user", kind: "user", text: question, createdAt: "2026-10-08T10:00:00Z" },
        {
          id: 2,
          turnId: "t1",
          role: "assistant",
          kind: "refuse",
          text: `Reply in ${id}.`,
          payload: turn({ kind: "refuse", text: `Reply in ${id}.`, conversationId: id }),
          createdAt: "2026-10-08T10:00:01Z",
        },
      ],
    });
    const list = {
      conversations: [
        { id: "c1", title: "First question", createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-08T10:00:01Z" },
        { id: "c2", title: "Second question", createdAt: "2026-10-08T11:00:00Z", updatedAt: "2026-10-08T11:00:01Z" },
      ],
    };

    it("creates exactly one conversation when a suggestion is clicked twice", async () => {
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      const calls = installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { method: "POST", path: "/api/conversations", status: 201, body: async () => (await held, { id: "c9" }) },
        { path: "/api/conversations/c9", body: { id: "c9", title: "t", messages: [] } },
        { method: "POST", path: "/api/conversations/c9/messages", body: turn({ kind: "refuse", text: "I can help with company policies." }) },
      ]);
      renderChat("/chat");
      const suggestion = await screen.findByRole("button", { name: "Show my tickets" });
      fireEvent.click(suggestion);
      fireEvent.click(suggestion);
      await waitFor(() => expect((screen.getByRole("button", { name: "Show my tickets" }) as HTMLButtonElement).disabled).toBe(true));
      release();
      await screen.findByText("I can help with company policies.");
      expect(calls.filter((c) => c.method === "POST" && c.path === "/api/conversations")).toHaveLength(1);
      expect(calls.filter((c) => c.method === "POST" && c.path === "/api/conversations/c9/messages").map((c) => c.body)).toEqual([{ text: "Show my tickets" }]);
    });

    it("clears the previous conversation and disables sending until the next one loads", async () => {
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      installFetch([
        { path: "/api/conversations", body: list },
        { path: "/api/conversations/c1", body: transcriptOf("c1", "First question") },
        { path: "/api/conversations/c2", body: async () => (await held, transcriptOf("c2", "Second question")) },
      ]);
      renderChat("/chat/c1");
      await screen.findByText("Reply in c1.");
      fireEvent.click(await screen.findByRole("link", { name: "Second question" }));
      await screen.findByText("Loading conversation...");
      expect(screen.queryByText("Reply in c1.")).toBeNull();
      expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
      release();
      await screen.findByText("Reply in c2.");
      expect(screen.queryByText("Reply in c1.")).toBeNull();
      expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(false);
    });

    it("shows a not-found state for a dead link, and a send there starts a new conversation", async () => {
      const calls = installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { path: "/api/conversations/dead", status: 404, body: { error: { code: "not_found", message: "Conversation not found.", requestId: "r" } } },
        { method: "POST", path: "/api/conversations", status: 201, body: { id: "c5" } },
        { path: "/api/conversations/c5", body: { id: "c5", title: "t", messages: [] } },
        { method: "POST", path: "/api/conversations/c5/messages", body: turn({ kind: "refuse", text: "Answer in c5." }) },
      ]);
      renderChat("/chat/dead");
      await screen.findByText("This conversation was not found");
      expect(screen.getByRole("button", { name: "Start a new conversation" })).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "How much PTO do I get?" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("Answer in c5.");
      expect(screen.getByTestId("location").textContent).toBe("/chat/c5");
      expect(calls.some((c) => c.method === "POST" && c.path.includes("/dead"))).toBe(false);
      expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/api/conversations", "/api/conversations/c5/messages"]);
    });

    it("leaves the not-found state through Start a new conversation", async () => {
      installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { path: "/api/conversations/dead", status: 404, body: { error: { code: "not_found", message: "Conversation not found.", requestId: "r" } } },
      ]);
      renderChat("/chat/dead");
      fireEvent.click(await screen.findByRole("button", { name: "Start a new conversation" }));
      await screen.findByText(/how can I help\?/);
      expect(screen.getByTestId("location").textContent).toBe("/chat");
    });

    it("retries a failed send under the same bubble", async () => {
      let attempts = 0;
      installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: [] } },
        {
          method: "POST",
          path: "/api/conversations/c1/messages",
          status: () => (attempts === 1 ? 500 : 200),
          body: () => {
            attempts++;
            return attempts === 1 ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : turn({ kind: "refuse", text: "Second try worked." });
          },
        },
      ]);
      const { container } = renderChat();
      fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "How much PTO do I get?" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("Internal error.");
      const retry = screen.getByRole("button", { name: "Retry" });
      retry.focus();
      fireEvent.click(retry);
      await screen.findByText("Second try worked.");
      expect(screen.queryByText("Internal error.")).toBeNull();
      const bubbles = [...container.querySelectorAll(".message-user")].map((b) => b.textContent);
      expect(bubbles).toEqual(["How much PTO do I get?"]);
      // The Retry button is gone, so focus comes back to the message box, not to the page.
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Message")));
    });

    it("waits for a previous reply after a 409, shows it when it arrives, then stops asking", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      const before = transcriptOf("c1", "First question");
      const after = {
        ...before,
        messages: [
          ...before.messages,
          { id: 3, turnId: "t2", role: "user", kind: "user", text: "Earlier question", createdAt: "2026-10-08T10:01:00Z" },
          { id: 4, turnId: "t2", role: "assistant", kind: "refuse", text: "Earlier reply.", payload: turn({ kind: "refuse", text: "Earlier reply." }), createdAt: "2026-10-08T10:01:30Z" },
        ],
      };
      let gets = 0;
      const calls = installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { path: "/api/conversations/c1", body: () => (++gets <= 3 ? before : after) },
        { method: "POST", path: "/api/conversations/c1/messages", status: 409, body: { error: { code: "turn_in_progress", message: "A reply is still being prepared in this conversation.", requestId: "r" } } },
      ]);
      renderChat();
      await settle();
      expect(screen.getByText("Reply in c1.")).toBeTruthy();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "New question" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await settle();
      expect(screen.getByText("Still answering your previous message...")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      await settle(4000);
      await settle(4000);
      expect(screen.queryByText("Earlier reply.")).toBeNull();
      await settle(4000);
      expect(screen.getByText("Earlier reply.")).toBeTruthy();
      expect(screen.getByText(/finished your previous message, so this one was not sent/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      const transcriptGets = () => calls.filter((c) => c.path === "/api/conversations/c1").length;
      expect(transcriptGets()).toBe(4); // the first load and three looks
      await settle(20_000);
      expect(transcriptGets()).toBe(4);
    });

    it("stops after 15 looks when the previous reply never arrives", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      const calls = installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: [] } },
        { method: "POST", path: "/api/conversations/c1/messages", status: 409, body: { error: { code: "turn_in_progress", message: "busy", requestId: "r" } } },
      ]);
      renderChat();
      await settle();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "New question" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await settle();
      for (let i = 0; i < 20; i++) await settle(4000);
      expect(calls.filter((c) => c.path === "/api/conversations/c1")).toHaveLength(1 + 15);
      expect(screen.getByText("PeopleDesk is still answering your previous message. Try again in a moment.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    });

    it("shows how long a slow turn has taken after 5 seconds", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      installFetch([
        { path: "/api/conversations", body: { conversations: [] } },
        { path: "/api/conversations/c1", body: { id: "c1", title: "t", messages: [] } },
        { method: "POST", path: "/api/conversations/c1/messages", body: async () => (await held, turn({ kind: "refuse", text: "Slow reply." })) },
      ]);
      renderChat();
      await settle();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Slow question" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await settle(3000);
      expect(screen.queryByText(/Answers can take up to a minute/)).toBeNull();
      await settle(3000);
      expect(screen.getByText(/Answers can take up to a minute/)).toBeTruthy();
      const counter = screen.getByTestId("turn-elapsed");
      expect(counter.textContent).toBe("6 s.");
      expect(counter.getAttribute("aria-hidden")).toBe("true");
      release();
      await settle();
      expect(screen.getByText("Slow reply.")).toBeTruthy();
    });

    it("shows a loading line and, on failure, an error with Try again in the conversation list", async () => {
      let fail = true;
      const calls = installFetch([
        {
          path: "/api/conversations",
          status: () => (fail ? 500 : 200),
          body: () => (fail ? { error: { code: "internal", message: "Internal error.", requestId: "r" } } : list),
        },
        { path: "/api/conversations/c1", body: transcriptOf("c1", "First question") },
      ]);
      renderChat();
      const sidebar = screen.getByRole("complementary", { name: "Conversations" });
      expect(within(sidebar).getByRole("status").textContent).toBe("Loading conversations...");
      expect((await within(sidebar).findByRole("alert")).textContent).toContain("Internal error.");
      fail = false;
      fireEvent.click(within(sidebar).getByRole("button", { name: "Try again" }));
      await within(sidebar).findByRole("link", { name: "Second question" });
      expect(calls.filter((c) => c.path === "/api/conversations")).toHaveLength(2);
    });

    it("folds the conversation list behind a toggle when a conversation is open", async () => {
      installFetch([
        { path: "/api/conversations", body: list },
        { path: "/api/conversations/c1", body: transcriptOf("c1", "First question") },
      ]);
      renderChat();
      const toggle = await screen.findByRole("button", { name: "Conversations (2)" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
    });

    describe("picking a conversation from the list", () => {
      const routes = () => [
        { path: "/api/conversations", body: list },
        { path: "/api/conversations/c1", body: transcriptOf("c1", "First question") },
        { path: "/api/conversations/c2", body: transcriptOf("c2", "Second question") },
      ];
      const pick = async () => {
        const toggle = await screen.findByRole("button", { name: "Conversations (2)" });
        fireEvent.click(toggle);
        const link = screen.getByRole("link", { name: "Second question" });
        link.focus();
        fireEvent.click(link);
        await screen.findByText("Reply in c2.");
        return { toggle, link };
      };

      it("moves focus to the list's toggle when the folded list hides the link that had focus (narrow screens)", async () => {
        // The narrow-screen rule from styles.css that hides a folded list.
        const style = document.createElement("style");
        style.textContent = ".conversation-list.collapsed .conversation-items { display: none; }";
        document.head.append(style);
        try {
          installFetch(routes());
          renderChat();
          const { toggle } = await pick();
          expect(toggle.getAttribute("aria-expanded")).toBe("false");
          expect(document.activeElement).toBe(toggle);
        } finally {
          style.remove();
        }
      });

      it("keeps focus on the link where the list stays visible (wide screens)", async () => {
        installFetch(routes());
        renderChat();
        const { link } = await pick();
        expect(document.activeElement).toBe(link);
      });
    });
  });
});
