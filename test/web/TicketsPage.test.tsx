import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Ticket } from "../../src/shared/api-types.ts";
import { BusinessDateContext } from "../../src/web/lib/business-date.tsx";
import { MeContext } from "../../src/web/lib/session.tsx";
import { TicketsPage } from "../../src/web/pages/TicketsPage.tsx";
import { installFetch, me } from "./fixtures.ts";
import { LocationProbe } from "./probe.tsx";
import { ticketsFor } from "./seed.ts";

const ticket = (id: string, status: string, category = "it", updatedAt = "2026-09-02T10:00:00.000Z"): Ticket => ({
  id,
  requesterId: me.employeeId,
  category: category as Ticket["category"],
  subject: `Subject ${id}`,
  description: "Something is broken and needs a fix.",
  priority: "normal",
  status: status as Ticket["status"],
  relatedPolicyId: null,
  createdVia: "seed",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt,
});

const renderAt = (url = "/tickets", asOf: string | null = "2026-10-01") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <MeContext.Provider value={me}>
        <BusinessDateContext.Provider value={{ asOf, settled: true }}>
          <TicketsPage />
          <LocationProbe />
        </BusinessDateContext.Provider>
      </MeContext.Provider>
    </MemoryRouter>,
  );

const statusButtons = () => within(screen.getByRole("group", { name: "Status" })).getAllByRole("button");
const lastUpdateOf = (id: string) => {
  const row = screen.getByText(id).closest("tr") as HTMLElement;
  return row.querySelector(".ticket-updated") as HTMLElement;
};
const emeka = ticketsFor("E0023");

describe("TicketsPage", () => {
  it("counts each status in buttons that filter, from one request", async () => {
    const calls = installFetch([{ path: "/api/tickets", body: { tickets: emeka } }]);
    renderAt();
    await screen.findByText("TKT-000004");
    expect(statusButtons().map((b) => b.textContent)).toEqual(["All 5", "Open 3", "In progress 0", "Resolved 2", "Closed 0"]);
    expect(statusButtons().map((b) => b.getAttribute("aria-label"))).toEqual(["All, 5 tickets", "Open, 3 tickets", "In progress, 0 tickets", "Resolved, 2 tickets", "Closed, 0 tickets"]);
    expect(statusButtons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false"]);
    expect(statusButtons().every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Resolved, 2 tickets" }));
    expect(screen.queryByText("TKT-000004")).toBeNull();
    expect(screen.getByText("TKT-000129")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/tickets?status=resolved");
    expect(screen.getByRole("button", { name: "Resolved, 2 tickets" }).getAttribute("aria-pressed")).toBe("true");
    expect(calls.map((c) => c.path)).toEqual(["/api/tickets"]);
  });

  it("restores the filter from ?status= on load, and ignores an invalid one", async () => {
    installFetch([{ path: "/api/tickets", body: { tickets: emeka } }]);
    const view = renderAt("/tickets?status=open");
    await screen.findByText("TKT-000004");
    expect(screen.getByRole("button", { name: "Open, 3 tickets" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("TKT-000129")).toBeNull();
    view.unmount();
    installFetch([{ path: "/api/tickets", body: { tickets: emeka } }]);
    renderAt("/tickets?status=lost");
    await screen.findByText("TKT-000129");
    expect(screen.getByRole("button", { name: "All, 5 tickets" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows how long Emeka's tickets have gone without an update, and marks the open ones waiting 30 days or more", async () => {
    installFetch([{ path: "/api/tickets", body: { tickets: emeka } }]);
    renderAt();
    await screen.findByText("TKT-000004");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Ticket", "Subject", "Last update", "Category", "Priority", "Status", "Opened"]);
    expect(lastUpdateOf("TKT-000004").textContent).toBe("Mar 22, 2026193 days agoNo update in 193 days");
    expect(lastUpdateOf("TKT-000067").textContent).toContain("No update in 120 days");
    expect(lastUpdateOf("TKT-000069").textContent).toContain("No update in 118 days");
    // Resolved tickets show their age, never the marker.
    expect(lastUpdateOf("TKT-000113").textContent).toBe("Aug 18, 202644 days ago");
    expect(lastUpdateOf("TKT-000004").querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks an open ticket at 30 days without an update, not at 29, and says today for an update on or after asOf", async () => {
    installFetch([
      {
        path: "/api/tickets",
        body: {
          tickets: [
            ticket("TKT-000001", "open", "it", "2026-09-02T10:00:00.000Z"),
            ticket("TKT-000002", "in_progress", "it", "2026-09-01T10:00:00.000Z"),
            ticket("TKT-000003", "open", "it", "2026-10-09T12:00:00.000Z"),
            ticket("TKT-000005", "closed", "it", "2026-06-01T10:00:00.000Z"),
          ],
        },
      },
    ]);
    renderAt();
    await screen.findByText("TKT-000001");
    expect(lastUpdateOf("TKT-000001").textContent).toBe("Sep 2, 202629 days ago");
    expect(lastUpdateOf("TKT-000002").textContent).toBe("Sep 1, 202630 days agoNo update in 30 days");
    expect(lastUpdateOf("TKT-000003").textContent).toBe("Oct 9, 2026today");
    expect(lastUpdateOf("TKT-000005").textContent).not.toContain("No update");
  });

  it("shows only the date, with no age and no marker, without a business date", async () => {
    installFetch([{ path: "/api/tickets", body: { tickets: emeka } }]);
    renderAt("/tickets", null);
    await screen.findByText("TKT-000004");
    expect(lastUpdateOf("TKT-000004").textContent).toBe("Mar 22, 2026");
    expect(screen.queryByText(/No update in/)).toBeNull();
  });

  it("shows the same labels as the form: IT, HR (general), In progress", async () => {
    installFetch([{ path: "/api/tickets", body: { tickets: [ticket("TKT-000001", "in_progress", "it"), ticket("TKT-000002", "open", "hr_general")] } }]);
    renderAt();
    await screen.findByText("TKT-000001");
    expect(screen.getByText("IT")).toBeTruthy();
    expect(screen.getByText("HR (general)")).toBeTruthy();
    expect(screen.getAllByText("In progress").some((el) => el.classList.contains("status-pill"))).toBe(true);
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

  it("offers to show all statuses when a filter matches nothing, and moves focus to All", async () => {
    installFetch([{ path: "/api/tickets", body: { tickets: [ticket("TKT-000001", "open")] } }]);
    renderAt("/tickets?status=resolved");
    await screen.findByText("No resolved tickets");
    const showAll = screen.getByRole("button", { name: "Show all statuses" });
    showAll.focus();
    fireEvent.click(showAll);
    await screen.findByText("TKT-000001");
    expect(screen.getByTestId("location").textContent).toBe("/tickets");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "All, 1 ticket" }));
  });

  it("says when the list holds the service's 200 most recent tickets", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ticket(`TKT-${String(i + 1).padStart(6, "0")}`, i % 2 ? "open" : "closed"));
    installFetch([{ path: "/api/tickets", body: { tickets: many } }]);
    renderAt();
    expect((await screen.findByTestId("ticket-limit")).textContent).toBe("Showing your 200 most recent tickets; the counts cover these.");
    expect(screen.getByRole("button", { name: "Open, 100 tickets" })).toBeTruthy();
  });
});
