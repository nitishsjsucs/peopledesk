import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MeContext } from "../../src/web/lib/session.tsx";
import { TicketsPage } from "../../src/web/pages/TicketsPage.tsx";
import { installFetch, me } from "./fixtures.ts";

const ticket = (id: string, status: string) => ({
  id,
  requesterId: me.employeeId,
  category: "it",
  subject: `Subject ${id}`,
  description: "Something is broken and needs a fix.",
  priority: "normal",
  status,
  relatedPolicyId: null,
  createdVia: "seed",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
});

describe("TicketsPage", () => {
  it("lists own tickets and filters by status through the API", async () => {
    const calls = installFetch([
      { path: "/api/tickets", body: { tickets: [ticket("TKT-000001", "open"), ticket("TKT-000002", "closed")] } },
      { path: "/api/tickets?status=closed", body: { tickets: [ticket("TKT-000002", "closed")] } },
    ]);
    render(
      <MemoryRouter>
        <MeContext.Provider value={me}>
          <TicketsPage />
        </MeContext.Provider>
      </MemoryRouter>,
    );
    await screen.findByText("TKT-000001");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "closed" } });
    await screen.findByText("TKT-000002");
    expect(screen.queryByText("TKT-000001")).toBeNull();
    expect(calls.map((c) => c.path)).toEqual(["/api/tickets", "/api/tickets?status=closed"]);
  });
});
