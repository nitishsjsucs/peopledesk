import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { ApprovalCard } from "../components/ApprovalCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { api } from "../lib/api.ts";
import { useAsync } from "../lib/use-async.ts";

/**
 * Own pending and past requests. ?focus=<actionId> (the MCP approvalUrl target, and the link from a
 * replaced request) highlights that card, scrolls to it and moves keyboard focus to it.
 */
export function ActionsPage() {
  const [params] = useSearchParams();
  const focus = params.get("focus");
  // Re-read when the focused request changes: a link to a replacement can name a request made since.
  const actions = useAsync(() => api.actions(), [focus]);
  useEffect(() => {
    if (!focus || !actions.data) return;
    const card = document.getElementById(`action-${focus}`)?.querySelector<HTMLElement>(".approval-card");
    if (!card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView?.({ block: "center" });
  }, [focus, actions.data]);
  const list = actions.data?.actions ?? [];
  const pending = list.filter((a) => a.status === "awaiting_approval");
  const past = list.filter((a) => a.status !== "awaiting_approval");
  return (
    <>
      <h1 className="page-title">My requests</h1>
      <p className="page-subtitle">Tickets and bookings wait here until you approve them. Approval is only ever this button.</p>
      {actions.error ? <ErrorBanner error={actions.error} onRetry={actions.reload} /> : null}
      {!actions.data && !actions.error ? (
        <p className="thinking" role="status">
          Loading your requests...
        </p>
      ) : null}
      {focus && actions.data && !list.some((a) => a.actionId === focus) ? (
        <div className="banner banner-info" data-testid="focus-not-found">
          <span>That request was not found among yours.</span>
          {/* With no requests at all, the empty state below offers the next steps instead. */}
          {list.length > 0 ? (
            <Link className="btn" to="/actions">
              See all your requests
            </Link>
          ) : null}
        </div>
      ) : null}
      {actions.data && list.length === 0 ? (
        <EmptyState title="No requests yet">
          <p>A ticket or an orientation booking you request waits here for your approval.</p>
          <p className="request-links" style={{ justifyContent: "center" }}>
            <Link to="/requests/ticket">Open a ticket</Link>
            <Link to="/chat">Ask in chat</Link>
          </p>
        </EmptyState>
      ) : null}
      {pending.length > 0 ? <h2 style={{ fontSize: 17 }}>Awaiting approval</h2> : null}
      {pending.map((a) => (
        <div key={a.actionId} id={`action-${a.actionId}`}>
          <ApprovalCard action={a} highlight={a.actionId === focus} />
        </div>
      ))}
      {past.length > 0 ? <h2 style={{ fontSize: 17 }}>Earlier</h2> : null}
      {past.map((a) => (
        <div key={a.actionId} id={`action-${a.actionId}`}>
          <ApprovalCard action={a} highlight={a.actionId === focus} />
        </div>
      ))}
    </>
  );
}
