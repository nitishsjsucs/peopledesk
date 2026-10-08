import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { TicketTable } from "../components/ToolResultCard.tsx";
import { api } from "../lib/api.ts";
import { useAsync } from "../lib/use-async.ts";

export function TicketsPage() {
  const tickets = useAsync(() => api.tickets(), []);
  return (
    <>
      <h1 className="page-title">My tickets</h1>
      <p className="page-subtitle">
        Support tickets you opened. <Link to="/requests/ticket">Open a new one</Link>
      </p>
      {tickets.error ? <ErrorBanner error={tickets.error} onRetry={tickets.reload} /> : null}
      {tickets.data && tickets.data.tickets.length === 0 ? <EmptyState title="No tickets yet" /> : null}
      {tickets.data && tickets.data.tickets.length > 0 ? (
        <div className="card">
          <TicketTable tickets={tickets.data.tickets} />
        </div>
      ) : null}
    </>
  );
}
