import { useSearchParams } from "react-router";
import { OrientationForm } from "../components/OrientationForm.tsx";
import { RequestSteps } from "../components/RequestSteps.tsx";

/**
 * /requests/orientation: the session picker, then the review card. ?review=, ?edit= and ?from= address
 * the steps; on a new form ?session=ORI-### preselects a session and ?employee=E#### an attendee (only
 * when that person is one of the attendees the form lists).
 */
export function ScheduleOrientationPage() {
  const [params] = useSearchParams();
  return (
    <RequestSteps
      tool="schedule_orientation_session"
      titles={{ new: "Book orientation", edit: "Edit orientation request", review: "Review orientation request" }}
      subtitle="Pick a session with seats left. Nothing is booked until you approve the request."
      renderForm={({ initialArgs, supersedes, onProposed }) => (
        <OrientationForm
          initialSessionId={(initialArgs?.["sessionId"] as string | undefined) ?? (initialArgs ? undefined : (params.get("session") ?? undefined))}
          initialEmployeeId={(initialArgs?.["employeeId"] as string | undefined) ?? (initialArgs ? undefined : (params.get("employee") ?? undefined))}
          supersedes={supersedes}
          onProposed={onProposed}
        />
      )}
    />
  );
}
