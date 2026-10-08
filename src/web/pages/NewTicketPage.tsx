import { useState } from "react";
import { Link, useLocation } from "react-router";
import type { PendingActionView } from "../../shared/api-types.ts";
import { ApprovalCard } from "../components/ApprovalCard.tsx";
import { TicketForm } from "../components/TicketForm.tsx";
import type { TicketValues } from "../components/TicketForm.tsx";

export function NewTicketPage() {
  const edit = (useLocation().state as { edit?: PendingActionView } | null)?.edit;
  const [proposed, setProposed] = useState<PendingActionView | null>(null);
  const initial = edit && edit.tool === "create_support_ticket" ? (edit.arguments as Partial<TicketValues>) : undefined;
  return (
    <>
      <h1 className="page-title">{edit ? "Edit ticket request" : "New support ticket"}</h1>
      <p className="page-subtitle">Nothing is created until you approve the request on the next step.</p>
      {proposed ? (
        <>
          <ApprovalCard action={proposed} />
          <p>
            <Link to="/actions">All my requests</Link>
          </p>
        </>
      ) : (
        <TicketForm initial={initial} supersedes={edit?.actionId} onProposed={setProposed} />
      )}
    </>
  );
}
