import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MeContext } from "../../src/web/lib/session.tsx";
import { HomePage } from "../../src/web/pages/HomePage.tsx";
import { installFetch, me, pendingTicket } from "./fixtures.ts";

const renderHome = (who = me) =>
  render(
    <MemoryRouter>
      <MeContext.Provider value={who}>
        <HomePage />
      </MeContext.Provider>
    </MemoryRouter>,
  );

describe("HomePage", () => {
  it("greets with the role badge and counts requests awaiting approval", async () => {
    const calls = installFetch([{ path: "/api/actions?status=awaiting_approval", body: { actions: [pendingTicket(), pendingTicket({ actionId: crypto.randomUUID() })] } }]);
    renderHome();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Hello, Emeka");
    expect(screen.getByText("Employee")).toBeTruthy();
    expect((await screen.findByTestId("pending-count")).textContent).toContain("2 requests are waiting for your approval.");
    expect(calls[0]?.path).toBe("/api/actions?status=awaiting_approval");
  });

  it("offers the quick actions", async () => {
    installFetch([{ path: "/api/actions?status=awaiting_approval", body: { actions: [] } }]);
    renderHome({ ...me, role: "manager" });
    for (const [name, href] of [
      ["Ask a question", "/chat"],
      ["New ticket", "/requests/ticket"],
      ["Schedule orientation", "/requests/orientation"],
      ["Onboarding", "/onboarding"],
    ] as const) {
      expect(screen.getByRole("link", { name: new RegExp(`^${name}`) }).getAttribute("href")).toBe(href);
    }
    expect((await screen.findByTestId("pending-count")).textContent).toContain("No requests are waiting");
  });
});
