// The approval checkpoint in the UI: the preview of exactly what will be written, an expiry countdown,
// and Approve / Reject / Edit. Approve is an authenticated same-origin POST by the requesting person;
// nothing else in the app (and nothing in chat) can approve.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { ApproveResponse, PendingActionView } from "../../shared/api-types.ts";
import { api, ApiClientError } from "../lib/api.ts";
import { formatRelativeExpiry } from "../lib/format.ts";
import { errorMessage } from "./ErrorBanner.tsx";

type Props = { action: PendingActionView; highlight?: boolean };

type Decided = { status: PendingActionView["status"]; message: string };

export function describeOutcome(outcome: ApproveResponse): string {
  const prefix = outcome.replayed ? "Already approved earlier. " : "";
  if (outcome.status === "executed") {
    const r = outcome.result;
    if (typeof r["ticketId"] === "string") return `${prefix}Done: ticket ${r["ticketId"]} was created.`;
    if (typeof r["bookingId"] === "string") return `${prefix}Done: booked into ${String(r["sessionId"])}.`;
    return `${prefix}Done.`;
  }
  return `${prefix}Approved, but it could not be completed (${outcome.errorCode.replace(/_/g, " ")}).`;
}

function initialDecision(a: PendingActionView): Decided | null {
  if (a.status === "awaiting_approval") return null;
  if (a.status === "executed") {
    const r = (a.result ?? {}) as Record<string, unknown>;
    const message = r["ticketId"]
      ? `Done: ticket ${String(r["ticketId"])}.`
      : r["bookingId"]
        ? `Done: booked into ${String(r["sessionId"] ?? "the session")}.`
        : "Done.";
    return { status: "executed", message };
  }
  if (a.status === "failed") return { status: "failed", message: `Could not be completed (${(a.errorCode ?? "error").replace(/_/g, " ")}).` };
  if (a.status === "rejected") return { status: "rejected", message: a.supersededBy ? "Replaced by an edited request." : "Rejected. Nothing was submitted." };
  if (a.status === "expired") return { status: "expired", message: "Expired before it was approved. Nothing was submitted." };
  return { status: a.status, message: a.status };
}

export function ApprovalCard({ action, highlight }: Props) {
  const navigate = useNavigate();
  const [decided, setDecided] = useState<Decided | null>(() => initialDecision(action));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (decided) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [decided]);

  const expiry = formatRelativeExpiry(action.expiresAt, now);
  const expired = !decided && expiry === "expired";
  const disabled = busy || !!decided || expired;

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await api.approve(action.actionId);
      setDecided({ status: outcome.status, message: describeOutcome(outcome) });
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "expired") setDecided({ status: "expired", message: "Expired before it was approved." });
      else if (e instanceof ApiClientError && e.code === "not_pending") setDecided({ status: "rejected", message: e.message });
      else setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError(null);
    try {
      await api.reject(action.actionId);
      setDecided({ status: "rejected", message: "Rejected. Nothing was submitted." });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function edit() {
    const path = action.tool === "create_support_ticket" ? "/requests/ticket" : "/requests/orientation";
    navigate(path, { state: { edit: action } });
  }

  return (
    <section
      className={`approval-card${highlight ? " focus-ring" : ""}`}
      aria-label={`Request awaiting approval: ${action.preview.title}`}
      data-testid="approval-card"
    >
      <h3>{action.preview.title}</h3>
      <dl className="approval-fields">
        {action.preview.fields.map((f) => (
          <div key={f.label} style={{ display: "contents" }}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="approval-actions">
        <button type="button" className="btn btn-primary" onClick={approve} disabled={disabled}>
          Approve
        </button>
        <button type="button" className="btn btn-danger" onClick={reject} disabled={disabled}>
          Reject
        </button>
        <button type="button" className="btn" onClick={edit} disabled={disabled}>
          Edit
        </button>
        {!decided ? (
          <span className="approval-expiry" data-testid="approval-expiry">
            {expired ? "Expired" : `Expires in ${expiry}`}
          </span>
        ) : null}
      </div>
      {decided ? (
        <p className="approval-outcome" role="status">
          <span className={`status-pill ${decided.status}`}>{decided.status.replace(/_/g, " ")}</span> {decided.message}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}
