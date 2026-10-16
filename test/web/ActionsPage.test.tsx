// ActionsPage is where every MCP approvalUrl (/actions?focus=<actionId>) lands: a human opens it and
// approves there, because there is no approve tool.
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { setFetch } from "../../src/web/lib/api.ts";
import { ActionsPage } from "../../src/web/pages/ActionsPage.tsx";
import { installFetch, pendingTicket } from "./fixtures.ts";

const awaiting = pendingTicket({ actionId: "11111111-1111-4111-8111-111111111111" });
const executed = pendingTicket({
  actionId: "22222222-2222-4222-8222-222222222222",
  status: "executed",
  result: { ticketId: "TKT-000151" },
  preview: { title: "Executed ticket", fields: [{ label: "Subject", value: "VPN keeps dropping" }] },
});

const approveButtons = () => screen.queryAllByRole("button", { name: "Approve" });

function renderAt(url: string, actions: unknown[]) {
  const calls = installFetch([{ path: "/api/actions", body: { actions } }]);
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <ActionsPage />
    </MemoryRouter>,
  );
  return { calls, container: view.container };
}

describe("ActionsPage", () => {
  it("lists requests awaiting approval apart from earlier ones, highlights the focused one and moves focus to it", async () => {
    const { container, calls } = renderAt(`/actions?focus=${awaiting.actionId}`, [awaiting, executed]);
    await screen.findByText("Awaiting approval");
    expect(screen.getByText("Earlier")).toBeTruthy();
    const focused = container.querySelector(`#action-${awaiting.actionId} .approval-card`);
    const other = container.querySelector(`#action-${executed.actionId} .approval-card`);
    expect(focused?.classList.contains("focus-ring")).toBe(true);
    expect(other?.classList.contains("focus-ring")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(focused));
    // A decided request shows its outcome instead of buttons; only the awaiting one can be approved.
    expect(approveButtons()).toHaveLength(1);
    expect(screen.queryByText("That request was not found among yours.")).toBeNull();
    expect(calls).toEqual([{ method: "GET", path: "/api/actions", body: undefined }]);
  });

  it("says so when the focused request is not among the viewer's own, with a link to all requests", async () => {
    renderAt("/actions?focus=33333333-3333-4333-8333-333333333333", [executed]);
    await screen.findByText("That request was not found among yours.");
    expect(screen.getByRole("link", { name: "See all your requests" }).getAttribute("href")).toBe("/actions");
    expect(approveButtons()).toHaveLength(0);
  });

  it("shows a loading line until the requests arrive", async () => {
    let release: (r: Response) => void = () => {};
    setFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    render(
      <MemoryRouter initialEntries={["/actions"]}>
        <ActionsPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status").textContent).toBe("Loading your requests...");
    release(new Response(JSON.stringify({ actions: [awaiting] }), { status: 200 }));
    await screen.findByText("Awaiting approval");
    expect(screen.queryByText("Loading your requests...")).toBeNull();
  });

  it("with no requests at all, says the focused one was not found and offers only the empty state's next steps", async () => {
    renderAt("/actions?focus=nope", []);
    const notFound = await screen.findByTestId("focus-not-found");
    expect(notFound.textContent).toBe("That request was not found among yours.");
    expect(screen.queryByRole("link", { name: "See all your requests" })).toBeNull();
    expect(screen.getByText("No requests yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open a ticket" }).getAttribute("href")).toBe("/requests/ticket");
    // The message about the link comes first, then what to do instead.
    expect(notFound.compareDocumentPosition(screen.getByText("No requests yet")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows an empty state with the next steps when there are no requests", async () => {
    renderAt("/actions", []);
    await screen.findByText("No requests yet");
    expect(screen.getByRole("link", { name: "Open a ticket" }).getAttribute("href")).toBe("/requests/ticket");
    expect(screen.getByRole("link", { name: "Ask in chat" }).getAttribute("href")).toBe("/chat");
  });
});
