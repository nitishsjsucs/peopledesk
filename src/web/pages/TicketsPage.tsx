import { useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { TICKET_STATUSES } from "../../shared/domain.ts";
import type { TicketStatus } from "../../shared/domain.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { TicketTable } from "../components/ToolResultCard.tsx";
import { api } from "../lib/api.ts";
import { useBusinessDate } from "../lib/business-date.tsx";
import { plural } from "../lib/dates.ts";
import { TICKET_STATUS_LABEL } from "../lib/labels.ts";
import { useAsync } from "../lib/use-async.ts";

/** The most tickets GET /api/tickets returns (TicketService.listOwn's limit). */
export const TICKET_LIST_LIMIT = 200;

/**
 * Own tickets, asked for once and filtered here. The status buttons are also the counts; the filter
 * lives in ?status=, so it survives a reload, Back and a shared link. Last update shows how long each
 * ticket has gone without an update, from the business date.
 */
export function TicketsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("status") ?? "";
  const status = (TICKET_STATUSES as readonly string[]).includes(raw) ? (raw as TicketStatus) : "";
  const { asOf } = useBusinessDate();
  const tickets = useAsync(() => api.tickets(), []);
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
  const all = tickets.data?.tickets ?? null;
  const shown = all ? all.filter((t) => !status || t.status === status) : null;
  const countOf = (s: TicketStatus | "") => (all ? all.filter((t) => !s || t.status === s).length : 0);
  const allRef = useRef<HTMLButtonElement>(null);
  // Showing all statuses removes the empty state and its button, so focus goes to the All button.
  const showAll = () => {
    setStatus("");
    allRef.current?.focus();
  };
  const filterButton = (value: TicketStatus | "", label: string) => {
    const n = countOf(value);
    return (
      <button
        key={value || "all"}
        type="button"
        ref={value ? undefined : allRef}
        className={`btn filter-btn status-filter${status === value ? " active" : ""}`}
        aria-pressed={status === value}
        aria-label={all ? `${label}, ${plural(n, "ticket")}` : label}
        onClick={() => setStatus(value)}
      >
        {label} <span className="filter-count">{all ? n : ""}</span>
      </button>
    );
  };
  return (
    <>
      <h1 className="page-title">My tickets</h1>
      <p className="page-subtitle">
        Support tickets you opened. <Link to="/requests/ticket">Open a new one</Link>
      </p>
      <div className="filters filter-buttons status-filters" role="group" aria-label="Status">
        {filterButton("", "All")}
        {TICKET_STATUSES.map((s) => filterButton(s, TICKET_STATUS_LABEL[s]))}
      </div>
      {tickets.error ? <ErrorBanner error={tickets.error} onRetry={tickets.reload} /> : null}
      {tickets.loading && !tickets.error ? (
        <p className="thinking" role="status">
          Loading your tickets...
        </p>
      ) : null}
      {all && all.length >= TICKET_LIST_LIMIT ? (
        <p className="message-meta" data-testid="ticket-limit">
          Showing your {TICKET_LIST_LIMIT} most recent tickets; the counts cover these.
        </p>
      ) : null}
      {shown && shown.length === 0 ? (
        <EmptyState title={status ? `No ${TICKET_STATUS_LABEL[status].toLowerCase()} tickets` : "No tickets yet"}>
          <p className="request-links" style={{ justifyContent: "center" }}>
            {status ? (
              <button type="button" className="btn" onClick={showAll}>
                Show all statuses
              </button>
            ) : null}
            <Link to="/requests/ticket">Open a ticket</Link>
          </p>
        </EmptyState>
      ) : null}
      {shown && shown.length > 0 ? (
        <div className="card">
          <TicketTable tickets={shown} lastUpdate={{ asOf }} />
        </div>
      ) : null}
    </>
  );
}
