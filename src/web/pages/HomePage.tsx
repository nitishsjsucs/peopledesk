import { Link } from "react-router";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { api } from "../lib/api.ts";
import { formatDateTime } from "../lib/format.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

const ROLE_LABEL = { employee: "Employee", manager: "Manager", hr_admin: "HR admin" } as const;

type QuickAction = { to: string; title: string; hint: string; testId?: string };

const people = (n: number) => (n === 1 ? "1 person needs an orientation session" : `${n} people need an orientation session`);

/**
 * Greeting, the number of requests waiting for the user's approval, and quick actions that fit the
 * person: orientation only when someone they can book for still needs a session, onboarding only when
 * there is a checklist to see. When the booking or the team cannot be checked, an error with Try again
 * says so, instead of the orientation card quietly missing.
 */
export function HomePage() {
  const me = useMe();
  const pending = useAsync(() => api.actions("awaiting_approval"), []);
  const booking = useAsync(() => (me.inOnboarding ? api.orientationBooking() : Promise.resolve(null)), [me.inOnboarding]);
  const progress = useAsync(() => (me.inOnboarding ? api.onboarding() : Promise.resolve(null)), [me.inOnboarding]);
  const team = useAsync(() => (me.role === "employee" ? Promise.resolve(null) : api.team()), [me.role]);
  const waiting = pending.data?.actions.length ?? 0;

  const ownBooking = booking.data?.booking ?? null;
  const selfNeedsSession = me.inOnboarding && booking.data !== null && booking.data.booking === null;
  const teamUnbooked = (team.data?.members ?? []).filter((m) => m.inOnboarding && !m.booked && m.employeeId !== me.employeeId).length;

  const quick: QuickAction[] = [{ to: "/chat", title: "Ask a question", hint: "Policy answers cite the version they come from." }];
  if (selfNeedsSession || teamUnbooked > 0) {
    const hints = [...(selfNeedsSession ? ["You have not booked your orientation session yet"] : []), ...(teamUnbooked > 0 ? [people(teamUnbooked)] : [])];
    quick.push({ to: "/requests/orientation", title: "Book orientation", hint: `${hints.join(". ")}.`, testId: "quick-book-orientation" });
  }
  if (ownBooking) {
    quick.push({
      to: "/onboarding",
      title: "Your orientation",
      hint: `${ownBooking.title}, ${formatDateTime(ownBooking.startsAt)}.`,
      testId: "quick-own-orientation",
    });
  }
  if (me.role === "employee" && me.inOnboarding) {
    quick.push({
      to: "/onboarding",
      title: "My onboarding",
      hint: progress.data ? `${progress.data.percentComplete}% complete.` : "Your checklist and progress.",
      testId: "quick-onboarding",
    });
  } else if (me.role !== "employee") {
    const scope = me.role === "hr_admin" ? "Everyone in onboarding" : "Your direct reports in onboarding";
    quick.push({ to: "/onboarding", title: "Onboarding", hint: me.inOnboarding ? `${scope}, and your own checklist.` : `${scope}.`, testId: "quick-onboarding" });
  }
  quick.push(
    { to: "/requests/ticket", title: "New ticket", hint: "IT, payroll, benefits, facilities, HR or access." },
    { to: "/tickets", title: "My tickets", hint: "The tickets you opened and their status." },
    { to: "/policies", title: "Policies", hint: "Every policy you can read, at the version in effect today." },
  );

  return (
    <>
      <h1 className="page-title">
        Hello, {me.fullName.split(" ")[0]} <span className="role-badge">{ROLE_LABEL[me.role]}</span>
      </h1>
      <p className="page-subtitle">
        {me.jobTitle}, {me.department}
      </p>
      {pending.error ? <ErrorBanner error={pending.error} onRetry={pending.reload} /> : null}
      {!pending.data && !pending.error ? (
        <p className="thinking" role="status">
          Checking for requests waiting for your approval...
        </p>
      ) : null}
      {pending.data ? (
        <div className={`banner ${waiting > 0 ? "banner-info" : ""}`} data-testid="pending-count">
          <span>
            {waiting === 0
              ? "No requests are waiting for your approval."
              : `${waiting} ${waiting === 1 ? "request is" : "requests are"} waiting for your approval.`}
          </span>
          {waiting > 0 ? (
            <Link className="btn" to="/actions">
              Review
            </Link>
          ) : null}
        </div>
      ) : null}
      {booking.error ? <ErrorBanner context="Could not check your orientation booking." error={booking.error} onRetry={booking.reload} /> : null}
      {team.error ? (
        <ErrorBanner context="Could not check who you support still needs an orientation session." error={team.error} onRetry={team.reload} />
      ) : null}
      <div className="quick-actions">
        {quick.map(({ to, title, hint, testId }) => (
          <Link key={title} to={to} className="card quick-action" data-testid={testId}>
            <strong>{title}</strong>
            <span className="message-meta">{hint}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
