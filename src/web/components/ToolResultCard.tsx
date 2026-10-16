import { Link } from "react-router";
import type { OnboardingProgress, Session } from "../../shared/api-types.ts";
import type { ToolName } from "../../shared/domain.ts";
import { daysBetween, plural } from "../lib/dates.ts";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { labelOf, TICKET_CATEGORY_LABEL, TICKET_PRIORITY_LABEL, TICKET_STATUS_LABEL } from "../lib/labels.ts";

type TicketRow = { id: string; subject: string; category: string; status: string; priority: string; createdAt: string; updatedAt?: string };

/** An open or in-progress ticket with no update for this many days is marked as waiting. */
export const STALE_AFTER_DAYS = 30;

/** Days since a ticket's last update, from the business date; 0 when it was updated on or after it. */
export const daysSinceUpdate = (updatedAt: string, asOf: string) => Math.max(0, daysBetween(updatedAt, asOf));

function LastUpdate({ ticket, asOf }: { ticket: TicketRow; asOf: string | null }) {
  const updatedAt = ticket.updatedAt ?? ticket.createdAt;
  const days = asOf ? daysSinceUpdate(updatedAt, asOf) : null;
  const stale = days !== null && days >= STALE_AFTER_DAYS && (ticket.status === "open" || ticket.status === "in_progress");
  return (
    <td className="ticket-updated">
      <span className="ticket-updated-date">{formatDate(updatedAt)}</span>
      {days !== null ? <span className="ticket-updated-ago">{days === 0 ? "today" : `${plural(days, "day")} ago`}</span> : null}
      {stale ? (
        <span className="ticket-stale" data-testid={`stale-${ticket.id}`}>
          <svg className="ticket-stale-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z M12 7v5l3.5 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          No update in {plural(days, "day")}
        </span>
      ) : null}
    </td>
  );
}

/**
 * The ticket table. The chat's list_my_tickets card shows it as it always has; My tickets turns on
 * lastUpdate, a Last update column right after Subject with how long each ticket has gone without an
 * update (from the business date), so the one to chase stands out.
 */
export function TicketTable({ tickets, lastUpdate }: { tickets: TicketRow[]; lastUpdate?: { asOf: string | null } }) {
  if (tickets.length === 0) return <p className="message-meta">No tickets.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Ticket</th>
            <th scope="col">Subject</th>
            {lastUpdate ? <th scope="col">Last update</th> : null}
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
              {lastUpdate ? <LastUpdate ticket={t} asOf={lastUpdate.asOf} /> : null}
              <td>{labelOf(TICKET_CATEGORY_LABEL, t.category)}</td>
              <td>{labelOf(TICKET_PRIORITY_LABEL, t.priority)}</td>
              <td>
                <span className={`status-pill ${t.status}`}>{labelOf(TICKET_STATUS_LABEL, t.status)}</span>
              </td>
              <td className={lastUpdate ? "ticket-date" : undefined}>{formatDate(t.createdAt)}</td>
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
      <div
        className="progress"
        role="progressbar"
        aria-label={`Onboarding progress for ${progress.fullName}`}
        aria-valuenow={progress.percentComplete}
        aria-valuemin={0}
        aria-valuemax={100}
      >
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
