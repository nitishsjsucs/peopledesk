import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { PendingActionView } from "../../shared/api-types.ts";
import { ApprovalCard } from "../components/ApprovalCard.tsx";
import { OrientationForm } from "../components/OrientationForm.tsx";

export function ScheduleOrientationPage() {
  // Edit on the review card navigates to this same route with new state. Keying by the location
  // remounts the page, so the prefilled form replaces the review card instead of being hidden by it.
  return <ScheduleOrientation key={useLocation().key} />;
}

function ScheduleOrientation() {
  const [params] = useSearchParams();
  const edit = (useLocation().state as { edit?: PendingActionView } | null)?.edit;
  const editArgs = edit && edit.tool === "schedule_orientation_session" ? (edit.arguments as { sessionId?: string; employeeId?: string }) : undefined;
  const [proposed, setProposed] = useState<PendingActionView | null>(null);
  return (
    <>
      <h1 className="page-title">{edit ? "Edit orientation request" : "Book orientation"}</h1>
      <p className="page-subtitle">Pick a session with seats left. Nothing is booked until you approve the request.</p>
      {proposed ? (
        <>
          <ApprovalCard action={proposed} />
          <p>
            <Link to="/actions">All my requests</Link>
          </p>
        </>
      ) : (
        <OrientationForm
          initialSessionId={editArgs?.sessionId ?? params.get("session") ?? undefined}
          initialEmployeeId={editArgs?.employeeId}
          supersedes={edit?.actionId}
          onProposed={setProposed}
        />
      )}
    </>
  );
}
