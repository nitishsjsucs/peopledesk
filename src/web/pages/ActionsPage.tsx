import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ApprovalCard } from "../components/ApprovalCard.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import { api } from "../lib/api.ts";
import { useAsync } from "../lib/use-async.ts";

/** Own pending and past requests. ?focus=<actionId> (the MCP approvalUrl target) highlights one. */
export function ActionsPage() {
  const [params] = useSearchParams();
  const focus = params.get("focus");
  const actions = useAsync(() => api.actions(), []);
  useEffect(() => {
    if (focus && actions.data) document.getElementById(`action-${focus}`)?.scrollIntoView?.({ block: "center" });
  }, [focus, actions.data]);
  const list = actions.data?.actions ?? [];
  const pending = list.filter((a) => a.status === "awaiting_approval");
  const past = list.filter((a) => a.status !== "awaiting_approval");
  return (
    <>
      <h1 className="page-title">My requests</h1>
      <p className="page-subtitle">Tickets and bookings wait here until you approve them. Approval is only ever this button.</p>
      {actions.error ? <ErrorBanner error={actions.error} onRetry={actions.reload} /> : null}
      {actions.data && list.length === 0 ? <EmptyState title="No requests yet" /> : null}
      {focus && actions.data && !list.some((a) => a.actionId === focus) ? (
        <div className="banner banner-info">That request was not found among yours.</div>
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
