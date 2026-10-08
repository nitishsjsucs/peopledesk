import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { MeContext } from "../../src/web/lib/session.tsx";
import { NewTicketPage } from "../../src/web/pages/NewTicketPage.tsx";
import { installFetch, me, pendingTicket } from "./fixtures.ts";

function renderPage(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/requests/ticket", state }]}>
      <MeContext.Provider value={me}>
        <Routes>
          <Route path="/requests/ticket" element={<NewTicketPage />} />
        </Routes>
      </MeContext.Provider>
    </MemoryRouter>,
  );
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("TicketForm", () => {
  it("validates on the client with the shared zod schema and sends nothing when invalid", () => {
    const calls = installFetch([]);
    renderPage();
    fill("Subject", "Hi");
    fill("Description", "short");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.some((t) => /at least 5|>=5|5 character/i.test(t ?? ""))).toBe(true);
    expect(alerts.some((t) => /at least 10|>=10|10 character/i.test(t ?? ""))).toBe(true);
    expect(screen.getByLabelText("Subject").getAttribute("aria-invalid")).toBe("true");
    expect(calls).toHaveLength(0);
  });

  it("submits to /api/actions and shows the pending action for review", async () => {
    const proposed = pendingTicket({ status: "awaiting_approval", source: "form", conversationId: null });
    const calls = installFetch([{ method: "POST", path: "/api/actions", status: 201, body: proposed }]);
    renderPage();
    fill("Category", "facilities");
    fill("Subject", "Desk chair is broken");
    fill("Description", "The height adjustment on my desk chair no longer works.");
    fill("Priority", "low");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/actions",
        body: {
          tool: "create_support_ticket",
          arguments: {
            category: "facilities",
            subject: "Desk chair is broken",
            description: "The height adjustment on my desk chair no longer works.",
            priority: "low",
          },
        },
      },
    ]);
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("prefills from an edited action and supersedes it on submit", async () => {
    const old = pendingTicket();
    const calls = installFetch([{ method: "POST", path: "/api/actions", status: 201, body: pendingTicket({ actionId: crypto.randomUUID() }) }]);
    renderPage({ edit: old });
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Laptop will not boot");
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    await screen.findByTestId("approval-card");
    expect((calls[0]?.body as { supersedes?: string }).supersedes).toBe(old.actionId);
  });

  it("goes back from the review step to the prefilled form on Edit, and the update supersedes the proposal", async () => {
    let n = 0;
    const calls = installFetch([
      {
        method: "POST",
        path: "/api/actions",
        status: 201,
        body: (init: RequestInit) => {
          const sent = JSON.parse(String(init.body)) as { arguments: Record<string, unknown> };
          n++;
          return pendingTicket({ actionId: `00000000-0000-4000-8000-00000000000${n}`, arguments: sent.arguments, source: "form", conversationId: null });
        },
      },
    ]);
    renderPage();
    fill("Subject", "Monitor flickers");
    fill("Description", "The external monitor flickers every few seconds.");
    fireEvent.click(screen.getByRole("button", { name: "Review request" }));
    await screen.findByTestId("approval-card");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // The form comes back, prefilled from the proposal, instead of the review card staying on screen.
    expect(await screen.findByRole("heading", { name: "Edit ticket request" })).toBeTruthy();
    expect(screen.queryByTestId("approval-card")).toBeNull();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).value).toBe("Monitor flickers");
    fill("Subject", "Monitor flickers and goes black");
    fireEvent.click(screen.getByRole("button", { name: "Update request" }));
    await screen.findByTestId("approval-card");
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toMatchObject({
      tool: "create_support_ticket",
      arguments: { subject: "Monitor flickers and goes black" },
      supersedes: "00000000-0000-4000-8000-000000000001",
    });
  });
});
