import { useState } from "react";
import { Link } from "react-router";
import { TICKET_STATUSES } from "../../shared/domain.ts";
import type { TicketStatus } from "../../shared/domain.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { TicketTable } from "../components/ToolResultCard.tsx";
import { api } from "../lib/api.ts";
import { useAsync } from "../lib/use-async.ts";

export function TicketsPage() {
  const [status, setStatus] = useState<TicketStatus | "">("");
  const tickets = useAsync(() => api.tickets(status || undefined), [status]);
  return (
    <>
      <h1 className="page-title">My tickets</h1>
      <p className="page-subtitle">
        Support tickets you opened. <Link to="/requests/ticket">Open a new one</Link>
      </p>
      <div className="filters">
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="ticket-status">Status</label>
          <select id="ticket-status" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | "")}>
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
      {tickets.error ? <ErrorBanner error={tickets.error} onRetry={tickets.reload} /> : null}
      {tickets.data && tickets.data.tickets.length === 0 ? <EmptyState title={status ? "No tickets with this status" : "No tickets yet"} /> : null}
      {tickets.data && tickets.data.tickets.length > 0 ? (
        <div className="card">
          <TicketTable tickets={tickets.data.tickets} />
        </div>
      ) : null}
    </>
  );
}
