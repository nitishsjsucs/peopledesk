import { Link, useSearchParams } from "react-router";
import { TICKET_STATUSES } from "../../shared/domain.ts";
import type { TicketStatus } from "../../shared/domain.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { TicketTable } from "../components/ToolResultCard.tsx";
import { api } from "../lib/api.ts";
import { TICKET_STATUS_LABEL } from "../lib/labels.ts";
import { useAsync } from "../lib/use-async.ts";

/** Own tickets. The status filter lives in ?status=, so it survives a reload, Back and a shared link. */
export function TicketsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("status") ?? "";
  const status = (TICKET_STATUSES as readonly string[]).includes(raw) ? (raw as TicketStatus) : "";
  const tickets = useAsync(() => api.tickets(status || undefined), [status]);
  const setStatus = (next: TicketStatus | "") =>
    setParams(
      (p) => {
        const out = new URLSearchParams(p);
        if (next) out.set("status", next);
        else out.delete("status");
        return out;
      },
      { replace: true },
    );
  const shown = tickets.data && !tickets.loading ? tickets.data.tickets : null;
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
                {TICKET_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {tickets.error ? <ErrorBanner error={tickets.error} onRetry={tickets.reload} /> : null}
      {tickets.loading && !tickets.error ? (
        <p className="thinking" role="status">
          Loading your tickets...
        </p>
      ) : null}
      {shown && shown.length === 0 ? (
        <EmptyState title={status ? `No ${TICKET_STATUS_LABEL[status].toLowerCase()} tickets` : "No tickets yet"}>
          <p className="request-links" style={{ justifyContent: "center" }}>
            {status ? (
              <button type="button" className="btn" onClick={() => setStatus("")}>
                Show all statuses
              </button>
            ) : null}
            <Link to="/requests/ticket">Open a ticket</Link>
          </p>
        </EmptyState>
      ) : null}
      {shown && shown.length > 0 ? (
        <div className="card">
          <TicketTable tickets={shown} />
        </div>
      ) : null}
    </>
  );
}
