// The approval checkpoint in the UI: the preview of exactly what will be written, an expiry countdown,
// and Approve / Reject / Edit. Approve is an authenticated same-origin POST by the requesting person;
// nothing else in the app (and nothing in chat) can approve. Once a request is decided (by a click, by
// its stored state or by its expiry) the buttons give way to the outcome and the next step.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { PendingActionView } from "../../shared/api-types.ts";
import { api, ApiClientError } from "../lib/api.ts";
import { formatRelativeExpiry } from "../lib/format.ts";
import { editUrl, focusUrl, STEP_FOCUS, startAgainUrl } from "../lib/requests.ts";
import { errorMessage } from "./ErrorBanner.tsx";

type Props = { action: PendingActionView; highlight?: boolean };

/** What the card knows about a decided request: its stored state, or what approve or reject answered. */
type Decision = {
  status: PendingActionView["status"] | "unknown";
  result?: unknown;
  errorCode?: string;
  supersededBy?: string;
  replayed?: boolean;
  /** The server's own words, when the current state could not be read back. */
  note?: string;
};

const STATUS_LABEL: Record<Decision["status"], string> = {
  awaiting_approval: "awaiting approval",
  executing: "being approved",
  executed: "done",
  failed: "failed",
  rejected: "rejected",
  expired: "expired",
  unknown: "decided",
};

/** Plain words for an approval that could not be completed (the stored errorCode). */
const FAILURE_REASON: Record<string, string> = {
  session_full: "the session is full",
  already_booked: "this person already has an orientation booking",
  session_in_past: "the session has already started",
  not_in_onboarding: "the attendee is no longer in onboarding",
  forbidden: "you are no longer allowed to make this request",
  not_found: "the session no longer exists",
  conflict: "the request changed while it was being approved",
  stale_execution: "it could not be confirmed",
};

function fromView(a: PendingActionView): Decision | null {
  if (a.status === "awaiting_approval") return null;
  return {
    status: a.status,
    ...(a.result !== undefined ? { result: a.result } : {}),
    ...(a.errorCode ? { errorCode: a.errorCode } : {}),
    ...(a.supersededBy ? { supersededBy: a.supersededBy } : {}),
  };
}

const field = (a: PendingActionView, label: string) => a.preview.fields.find((f) => f.label === label)?.value;

/** The outcome sentence and the link to the next step. */
function outcomeOf(action: PendingActionView, d: Decision): { text: string; next: ReactNode } {
  const prefix = d.replayed ? "Already approved earlier. " : "";
  const startAgain = (
    <Link className="btn" to={startAgainUrl(action)} state={STEP_FOCUS}>
      Start again with these details
    </Link>
  );
  if (d.status === "executed") {
    const r = (d.result ?? {}) as Record<string, unknown>;
    if (typeof r["ticketId"] === "string") {
      return {
        text: `${prefix}Done: ticket ${r["ticketId"]} was created.`,
        next: (
          <Link className="btn" to="/tickets">
            View in My tickets
          </Link>
        ),
      };
    }
    if (action.tool === "schedule_orientation_session") {
      const attendee = field(action, "Attendee");
      const session = field(action, "Session") ?? String(r["sessionId"] ?? "the session");
      const starts = field(action, "Starts");
      return {
        text: `${prefix}Done: ${attendee ? `${attendee} is booked` : "booked"} into ${session}${starts ? `, starting ${starts}` : ""}.`,
        next: (
          <Link className="btn" to="/onboarding">
            View onboarding
          </Link>
        ),
      };
    }
    return { text: `${prefix}Done.`, next: null };
  }
  if (d.status === "failed") {
    const code = d.errorCode ?? "conflict";
    const reason = FAILURE_REASON[code] ?? code.replace(/_/g, " ");
    return {
      text: `${prefix}Approved, but it could not be completed: ${reason}.`,
      next:
        code === "session_full" ? (
          <Link className="btn" to={startAgainUrl(action)} state={STEP_FOCUS}>
            Pick another session
          </Link>
        ) : (
          startAgain
        ),
    };
  }
  if (d.status === "rejected" && d.supersededBy) {
    return {
      text: "Replaced by an edited request.",
      next: (
        <Link className="btn" to={focusUrl(d.supersededBy)}>
          See the new request
        </Link>
      ),
    };
  }
  if (d.status === "rejected") return { text: "Rejected. Nothing was submitted.", next: startAgain };
  if (d.status === "expired") return { text: "Expired before it was approved. Nothing was submitted.", next: startAgain };
  if (d.status === "executing") return { text: "This request is being approved. Reload the page to see the outcome.", next: null };
  return { text: d.note ?? "This request was already decided.", next: null };
}

export function ApprovalCard({ action, highlight }: Props) {
  const navigate = useNavigate();
  const [decision, setDecision] = useState<Decision | null>(
    () => fromView(action) ?? (Date.parse(action.expiresAt) <= Date.now() ? { status: "expired" } : null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("");
  const outcomeRef = useRef<HTMLDivElement>(null);
  const focusOutcome = useRef(false);
  const remainingBefore = useRef<number | null>(null);

  const remainingMs = Date.parse(action.expiresAt) - now;
  const expiry = formatRelativeExpiry(action.expiresAt, now);

  useEffect(() => {
    if (decision) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [decision]);

  // The countdown text is hidden from screen readers (it changes every second); this status region
  // speaks only at one minute left and at expiry, and only for a change seen while the card is open.
  useEffect(() => {
    if (decision) return;
    const before = remainingBefore.current;
    remainingBefore.current = remainingMs;
    if (remainingMs <= 0) {
      setDecision({ status: "expired" });
      if (before !== null && before > 0) setAnnouncement("This request expired");
      return;
    }
    if (before !== null && before > 60_000 && remainingMs <= 60_000) setAnnouncement("1 minute left to approve");
  }, [remainingMs, decision]);

  useEffect(() => {
    if (decision && focusOutcome.current) {
      focusOutcome.current = false;
      outcomeRef.current?.focus();
    }
  }, [decision]);

  /** After a 409 or 410, the request's current state from the server, or the server's own message. */
  async function currentState(e: ApiClientError): Promise<Decision> {
    try {
      const fresh = (await api.actions()).actions.find((a) => a.actionId === action.actionId);
      const d = fresh ? fromView(fresh) : null;
      if (d) return d;
    } catch {
      // fall through to what the error said
    }
    return e.code === "expired" ? { status: "expired" } : { status: "unknown", note: e.message };
  }

  async function decide(run: () => Promise<Decision>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await run();
      focusOutcome.current = true;
      setDecision(d);
    } catch (e) {
      if (e instanceof ApiClientError && (e.code === "expired" || e.code === "not_pending")) {
        const d = await currentState(e);
        focusOutcome.current = true;
        setDecision(d);
      } else {
        setError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  const approve = () =>
    decide(async () => {
      const outcome = await api.approve(action.actionId);
      return outcome.status === "executed"
        ? { status: "executed", result: outcome.result, replayed: outcome.replayed }
        : { status: "failed", errorCode: outcome.errorCode, replayed: outcome.replayed };
    });
  const reject = () =>
    decide(async () => {
      await api.reject(action.actionId);
      return { status: "rejected" };
    });
  const edit = () => {
    if (!busy) navigate(editUrl(action), { state: STEP_FOCUS });
  };

  const statusText = STATUS_LABEL[decision?.status ?? "awaiting_approval"];
  const outcome = decision ? outcomeOf(action, decision) : null;
  return (
    <section
      className={`approval-card${highlight ? " focus-ring" : ""}`}
      aria-label={`Request, ${statusText}: ${action.preview.title}`}
      data-testid="approval-card"
      data-status={decision?.status ?? "awaiting_approval"}
      tabIndex={highlight ? -1 : undefined}
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
      {outcome && decision ? (
        <div className="approval-outcome" ref={outcomeRef} tabIndex={-1} data-testid="approval-outcome">
          <p>
            <span className={`status-pill ${decision.status}`}>{statusText}</span> {outcome.text}
          </p>
          {outcome.next ? <div className="approval-next">{outcome.next}</div> : null}
        </div>
      ) : (
        <div className="approval-actions">
          {/* While a request is in flight the buttons stay focusable (aria-disabled), so focus is not lost. */}
          <button type="button" className="btn btn-primary" onClick={approve} aria-disabled={busy || undefined}>
            Approve
          </button>
          <button type="button" className="btn btn-danger" onClick={reject} aria-disabled={busy || undefined}>
            Reject
          </button>
          <button type="button" className="btn" onClick={edit} aria-disabled={busy || undefined}>
            Edit
          </button>
          <span className="approval-expiry" data-testid="approval-expiry" aria-hidden="true">
            Expires in {expiry}
          </span>
        </div>
      )}
      <span className="visually-hidden" role="status" data-testid="approval-announcer">
        {announcement}
      </span>
      {error ? (
        <p className="field-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}
