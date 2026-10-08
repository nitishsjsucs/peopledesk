// ActionsPage is where every MCP approvalUrl (/actions?focus=<actionId>) lands: a human opens it and
// approves there, because there is no approve tool.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ActionsPage } from "../../src/web/pages/ActionsPage.tsx";
import { installFetch, pendingTicket } from "./fixtures.ts";

const awaiting = pendingTicket({ actionId: "11111111-1111-4111-8111-111111111111" });
const executed = pendingTicket({
  actionId: "22222222-2222-4222-8222-222222222222",
  status: "executed",
  result: { ticketId: "TKT-000151" },
  preview: { title: "Executed ticket", fields: [{ label: "Subject", value: "VPN keeps dropping" }] },
});

const enabledApproveButtons = () =>
  screen.queryAllByRole("button", { name: "Approve" }).filter((b) => !(b as HTMLButtonElement).disabled);

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
  it("lists requests awaiting approval apart from earlier ones and highlights the focused one", async () => {
    const { container, calls } = renderAt(`/actions?focus=${awaiting.actionId}`, [awaiting, executed]);
    await screen.findByText("Awaiting approval");
    expect(screen.getByText("Earlier")).toBeTruthy();
    const focused = container.querySelector(`#action-${awaiting.actionId} .approval-card`);
    const other = container.querySelector(`#action-${executed.actionId} .approval-card`);
    expect(focused?.classList.contains("focus-ring")).toBe(true);
    expect(other?.classList.contains("focus-ring")).toBe(false);
    // A decided request keeps its buttons, disabled; only the awaiting one can be approved.
    expect(enabledApproveButtons()).toHaveLength(1);
    expect(screen.queryByText("That request was not found among yours.")).toBeNull();
    expect(calls).toEqual([{ method: "GET", path: "/api/actions", body: undefined }]);
  });

  it("says so when the focused request is not among the viewer's own", async () => {
    renderAt("/actions?focus=33333333-3333-4333-8333-333333333333", [executed]);
    await screen.findByText("That request was not found among yours.");
    expect(enabledApproveButtons()).toHaveLength(0);
  });

  it("shows an empty state when there are no requests", async () => {
    renderAt("/actions", []);
    await screen.findByText("No requests yet");
  });
});
