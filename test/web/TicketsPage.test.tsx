import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { MeContext } from "../../src/web/lib/session.tsx";
import { TicketsPage } from "../../src/web/pages/TicketsPage.tsx";
import { installFetch, me } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";

const ticket = (id: string, status: string, category = "it") => ({
  id,
  requesterId: me.employeeId,
  category,
  subject: `Subject ${id}`,
  description: "Something is broken and needs a fix.",
  priority: "normal",
  status,
  relatedPolicyId: null,
  createdVia: "seed",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-02T10:00:00.000Z",
});

const renderAt = (url = "/tickets") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MeContext.Provider value={me}>
        <TicketsPage />
        <LocationProbe />
      </MeContext.Provider>
    </MemoryRouter>,
  );

describe("TicketsPage", () => {
  it("lists own tickets and filters by status through the API and the URL", async () => {
    const calls = installFetch([
      { path: "/api/tickets", body: { tickets: [ticket("TKT-000001", "open"), ticket("TKT-000002", "closed")] } },
      { path: "/api/tickets?status=closed", body: { tickets: [ticket("TKT-000002", "closed")] } },
    ]);
    renderAt();
    await screen.findByText("TKT-000001");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "closed" } });
    await waitFor(() => expect(screen.queryByText("TKT-000001")).toBeNull());
    expect(screen.getByText("TKT-000002")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/tickets?status=closed");
    expect(calls.map((c) => c.path)).toEqual(["/api/tickets", "/api/tickets?status=closed"]);
  });

  it("restores the filter from ?status= on load", async () => {
    const calls = installFetch([{ path: "/api/tickets?status=open", body: { tickets: [ticket("TKT-000001", "open")] } }]);
    renderAt("/tickets?status=open");
    await screen.findByText("TKT-000001");
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("open");
    expect(calls.map((c) => c.path)).toEqual(["/api/tickets?status=open"]);
  });

  it("shows the same labels as the form: IT, HR (general), In progress", async () => {
    installFetch([{ path: "/api/tickets", body: { tickets: [ticket("TKT-000001", "in_progress", "it"), ticket("TKT-000002", "open", "hr_general")] } }]);
    renderAt();
    await screen.findByText("TKT-000001");
    expect(screen.getByText("IT")).toBeTruthy();
    expect(screen.getByText("HR (general)")).toBeTruthy();
    expect(screen.getAllByText("In progress").some((el) => el.classList.contains("status-pill"))).toBe(true);
    expect([...(screen.getByLabelText("Status") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      "All statuses",
      "Open",
      "In progress",
      "Resolved",
      "Closed",
    ]);
  });

  it("shows a loading line until the tickets arrive", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    installFetch([{ path: "/api/tickets", body: async () => (await held, { tickets: [ticket("TKT-000001", "open")] }) }]);
    renderAt();
    expect(screen.getByRole("status").textContent).toBe("Loading your tickets...");
    release();
    await screen.findByText("TKT-000001");
    expect(screen.queryByText("Loading your tickets...")).toBeNull();
  });

  it("offers to show all statuses when a filter matches nothing", async () => {
    installFetch([
      { path: "/api/tickets?status=resolved", body: { tickets: [] } },
      { path: "/api/tickets", body: { tickets: [ticket("TKT-000001", "open")] } },
    ]);
    renderAt("/tickets?status=resolved");
    await screen.findByText("No resolved tickets");
    fireEvent.click(screen.getByRole("button", { name: "Show all statuses" }));
    await screen.findByText("TKT-000001");
    expect(screen.getByTestId("location").textContent).toBe("/tickets");
  });
});
