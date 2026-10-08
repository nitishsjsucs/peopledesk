import { Link } from "react-router";
import { api } from "../lib/api.ts";
import { useMe } from "../lib/session.tsx";
import { useAsync } from "../lib/use-async.ts";

const ROLE_LABEL = { employee: "Employee", manager: "Manager", hr_admin: "HR admin" } as const;

/** Greeting, quick actions and the number of requests waiting for the user's approval. */
export function HomePage() {
  const me = useMe();
  const pending = useAsync(() => api.actions("awaiting_approval"), []);
  const waiting = pending.data?.actions.length ?? 0;
  const quick: Array<[string, string, string]> = [
    ["/chat", "Ask a question", "Policy answers cite the version they come from."],
    ["/requests/ticket", "New ticket", "IT, payroll, benefits, facilities, HR or access."],
    ["/requests/orientation", "Schedule orientation", "Book a session with seats left."],
    ["/onboarding", me.role === "employee" ? "My onboarding" : "Onboarding", me.role === "employee" ? "Your checklist and progress." : "Your team's new hires and their progress."],
  ];
  return (
    <>
      <h1 className="page-title">
        Hello, {me.fullName.split(" ")[0]} <span className="role-badge">{ROLE_LABEL[me.role]}</span>
      </h1>
      <p className="page-subtitle">
        {me.jobTitle}, {me.department}
      </p>
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
      <div className="quick-actions">
        {quick.map(([to, title, hint]) => (
          <Link key={to} to={to} className="card quick-action">
            <strong>{title}</strong>
            <span className="message-meta">{hint}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
