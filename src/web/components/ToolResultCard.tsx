import { Link } from "react-router";
import type { OnboardingProgress, Session } from "../../shared/api-types.ts";
import type { ToolName } from "../../shared/domain.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";

type TicketRow = { id: string; subject: string; category: string; status: string; priority: string; createdAt: string };

export function TicketTable({ tickets }: { tickets: TicketRow[] }) {
  if (tickets.length === 0) return <p className="message-meta">No tickets.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Subject</th>
            <th scope="col">Category</th>
            <th scope="col">Priority</th>
            <th scope="col">Status</th>
            <th scope="col">Opened</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id}>
              <td>{t.id}</td>
              <td>{t.subject}</td>
              <td>{t.category.replace(/_/g, " ")}</td>
              <td>{t.priority}</td>
              <td>
                <span className={`status-pill ${t.status}`}>{t.status.replace(/_/g, " ")}</span>
              </td>
              <td>{formatDate(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OnboardingChecklist({ progress }: { progress: OnboardingProgress }) {
  return (
    <div>
      <div>
        <strong>{progress.fullName}</strong> · started {formatDate(progress.startDate)} · target {formatDate(progress.targetCompletionDate)}
      </div>
      <div className="progress" role="progressbar" aria-valuenow={progress.percentComplete} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress.percentComplete}%` }} />
      </div>
      <div className="message-meta">
        {progress.percentComplete}% complete · {progress.counts.done} done · {progress.counts.inProgress} in progress ·{" "}
        {progress.counts.pending} pending · {progress.counts.blocked} blocked
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Owner</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {progress.tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>{t.ownerRole.replace(/_/g, " ")}</td>
                <td>{formatDate(t.dueDate)}</td>
                <td>
                  <span className={`status-pill ${t.status}`}>{t.status.replace(/_/g, " ")}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SessionTable({ sessions, bookable = true }: { sessions: Session[]; bookable?: boolean }) {
  if (sessions.length === 0) return <p className="message-meta">No sessions in this window.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col">Starts</th>
            <th scope="col">Where</th>
            <th scope="col">Seats left</th>
            {bookable ? <th scope="col"><span className="visually-hidden">Book</span></th> : null}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>
                {s.title}
                <div className="message-meta">{s.id}</div>
              </td>
              <td>{formatDateTime(s.startsAt)}</td>
              <td>{s.location}</td>
              <td>
                {s.seatsRemaining} of {s.capacity}
              </td>
              {bookable ? (
                <td>
                  {s.seatsRemaining > 0 ? <Link to={`/requests/orientation?session=${s.id}`}>Book</Link> : <span className="message-meta">Full</span>}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ToolResultCard({ tool, result }: { tool: ToolName; result: unknown }) {
  if (tool === "list_my_tickets") return <TicketTable tickets={(result as { tickets: TicketRow[] }).tickets} />;
  if (tool === "get_onboarding_progress") return <OnboardingChecklist progress={result as OnboardingProgress} />;
  if (tool === "list_orientation_sessions") return <SessionTable sessions={(result as { sessions: Session[] }).sessions} />;
  return null;
}
