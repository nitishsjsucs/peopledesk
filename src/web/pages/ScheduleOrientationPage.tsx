import { useSearchParams } from "react-router";
import { OrientationForm } from "../components/OrientationForm.tsx";
import { RequestSteps } from "../components/RequestSteps.tsx";
import { useMe } from "../lib/session.tsx";

/**
 * /requests/orientation: the session picker, then the review card. ?review=, ?edit= and ?from= address
 * the steps, and their form starts from that request's session and attendee (the requester when the
 * request names no employeeId). On a new form ?session=ORI-### preselects a session and ?employee=E####
 * an attendee. Either is kept only while it can still be booked (OrientationForm).
 */
export function ScheduleOrientationPage() {
  const [params] = useSearchParams();
  const me = useMe();
  return (
    <RequestSteps
      tool="schedule_orientation_session"
      titles={{ new: "Book orientation", edit: "Edit orientation request", review: "Review orientation request" }}
      subtitle="Pick a session with seats left. Nothing is booked until you approve the request."
      renderForm={({ initialArgs, supersedes, onProposed }) => (
        <OrientationForm
          initialSessionId={(initialArgs?.["sessionId"] as string | undefined) ?? (initialArgs ? undefined : (params.get("session") ?? undefined))}
          initialEmployeeId={initialArgs ? ((initialArgs["employeeId"] as string | undefined) ?? me.employeeId) : (params.get("employee") ?? undefined)}
          supersedes={supersedes}
          onProposed={onProposed}
        />
      )}
    />
  );
}
