import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { PendingActionView } from "../../src/shared/api-types.ts";
import { ApprovalCard, describeOutcome } from "../../src/web/components/ApprovalCard.tsx";
import { installFetch, pendingTicket } from "./fixtures.ts";

function EditTarget() {
  const state = useLocation().state as { edit?: PendingActionView } | null;
  return <p data-testid="edit-target">editing {(state?.edit?.arguments as { subject?: string } | undefined)?.subject}</p>;
}

function renderCard(action: PendingActionView) {
  return render(
    <MemoryRouter initialEntries={["/chat/c1"]}>
      <Routes>
        <Route path="/chat/:id" element={<ApprovalCard action={action} />} />
        <Route path="/requests/ticket" element={<EditTarget />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ApprovalCard", () => {
  it("shows the preview fields and the expiry", () => {
    installFetch([]);
    renderCard(pendingTicket());
    expect(screen.getByText("New support ticket")).toBeTruthy();
    expect(screen.getByText("Subject")).toBeTruthy();
    expect(screen.getByText("Laptop will not boot")).toBeTruthy();
    expect(screen.getByTestId("approval-expiry").textContent).toBe("Expires in 14 min");
  });

  it("approves through the approve endpoint, shows the outcome and disables the buttons", async () => {
    const action = pendingTicket();
    const calls = installFetch([
      {
        method: "POST",
        path: `/api/actions/${action.actionId}/approve`,
        body: { status: "executed", result: { ticketId: "TKT-000151" }, replayed: false },
      },
    ]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/ticket TKT-000151 was created/);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST /api/actions/${action.actionId}/approve`]);
    for (const name of ["Approve", "Reject", "Edit"]) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects through the reject endpoint", async () => {
    const action = pendingTicket();
    const calls = installFetch([{ method: "POST", path: `/api/actions/${action.actionId}/reject`, body: { status: "rejected" } }]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText(/Rejected. Nothing was submitted./);
    expect(calls[0]?.path).toBe(`/api/actions/${action.actionId}/reject`);
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a replayed approve as the stored outcome", async () => {
    const action = pendingTicket();
    installFetch([
      { method: "POST", path: `/api/actions/${action.actionId}/approve`, body: { status: "failed", errorCode: "session_full", replayed: true } },
    ]);
    renderCard(action);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(/Already approved earlier. Approved, but it could not be completed \(session full\)/);
  });

  it("names the session of an executed booking, and falls back when a stored result lacks it", () => {
    expect(describeOutcome({ status: "executed", result: { bookingId: "BKG-1", sessionId: "ORI-007" }, replayed: false })).toBe(
      "Done: booked into ORI-007.",
    );
    expect(describeOutcome({ status: "executed", result: { bookingId: "BKG-1" }, replayed: true })).toBe(
      "Already approved earlier. Done: booked into the session.",
    );
  });

  it("opens the prefilled form on Edit", async () => {
    installFetch([]);
    renderCard(pendingTicket());
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((await screen.findByTestId("edit-target")).textContent).toBe("editing Laptop will not boot");
  });

  it("renders an already decided action without buttons enabled", () => {
    installFetch([]);
    renderCard(pendingTicket({ status: "executed", result: { ticketId: "TKT-000151" } }));
    expect(screen.getByRole("status").textContent).toContain("TKT-000151");
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
