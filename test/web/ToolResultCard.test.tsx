// The chat's tool result cards keep their shape: the onboarding and ticket views on their own pages
// changed, the cards in a conversation did not.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { ToolResultCard } from "../../src/web/components/ToolResultCard.tsx";
import { BusinessDateContext } from "../../src/web/lib/business-date.tsx";
import { progressFor, ticketsFor } from "./seed.ts";

const renderCard = (tool: Parameters<typeof ToolResultCard>[0]["tool"], result: unknown) =>
  render(
    <MemoryRouter>
      {/* Even with a business date known, the cards do not change. */}
      <BusinessDateContext.Provider value={{ asOf: "2026-10-01", settled: true }}>
        <ToolResultCard tool={tool} result={result} />
      </BusinessDateContext.Provider>
    </MemoryRouter>,
  );

describe("ToolResultCard", () => {
  it("renders get_onboarding_progress as the checklist table, with no grouping and no overdue", () => {
    const { container } = renderCard("get_onboarding_progress", progressFor("E0025"));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Task", "Owner", "Due", "Status"]);
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("Onboarding progress for Nadia Fernandes");
    expect(container.textContent).toContain("75% complete · 9 done · 1 in progress · 0 pending · 2 blocked");
    expect(container.textContent).not.toMatch(/overdue/i);
    expect(container.querySelector("[data-testid=grouped-checklist], .task-bar")).toBeNull();
  });

  it("renders list_my_tickets with its six columns and no Last update column", () => {
    renderCard("list_my_tickets", { tickets: ticketsFor("E0023") });
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Ticket", "Subject", "Category", "Priority", "Status", "Opened"]);
    expect(screen.queryByText(/No update in/)).toBeNull();
  });
});
