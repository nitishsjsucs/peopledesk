// The steps of a request page (/requests/ticket and /requests/orientation): the form, the review card
// and the edit form. Each step is addressed by the URL (see lib/requests.ts), so a reload, Back or
// Forward shows the request as the server has it now, never a form for a request already replaced.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import type { PendingActionView } from "../../shared/api-types.ts";
import type { WriteToolName } from "../../shared/domain.ts";
import { api } from "../lib/api.ts";
import { conversationOf, focusUrl, isEditable, requestPath, reviewUrl, STEP_FOCUS, startAgainUrl, wantsStepFocus } from "../lib/requests.ts";
import { useAsync } from "../lib/use-async.ts";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";

export type RequestFormProps = {
  /**
   * The step's subtitle (what happens next). The form renders it only when it shows a form: a person
   * the page cannot book for gets the reason instead, without a subtitle about picking a session.
   */
  intro: ReactNode;
  /** Arguments of the request this form starts from (?edit= or ?from=); undefined on a new form. */
  initialArgs?: Record<string, unknown>;
  /** The request this form replaces (only on ?edit=). */
  supersedes?: string;
  onProposed: (view: PendingActionView) => void;
};

type Props = {
  tool: WriteToolName;
  titles: { new: string; edit: string; review: string };
  subtitle: string;
  renderForm: (props: RequestFormProps) => ReactNode;
};

type Step = { kind: "new" } | { kind: "review" | "edit" | "from"; id: string };

function stepOf(params: URLSearchParams): Step {
  for (const kind of ["review", "edit", "from"] as const) {
    const id = params.get(kind);
    if (id) return { kind, id };
  }
  return { kind: "new" };
}

export function RequestSteps(props: Props) {
  // Keyed by the search string: each step mounts fresh and reads the request's current state.
  return <Steps key={useLocation().search} {...props} />;
}

/**
 * The step's h1. A move between steps on this page (navigation state STEP_FOCUS) removes the control
 * that had focus, so the heading takes it once `focus` is true, that is once the request has loaded.
 */
function StepTitle({ children, focus = false }: { children: ReactNode; focus?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <h1 className="page-title" tabIndex={-1} ref={ref}>
      {children}
    </h1>
  );
}

function Steps({ tool, titles, subtitle, renderForm }: Props) {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const step = stepOf(params);
  const focusStep = wantsStepFocus(location.state);
  const own = useAsync(() => (step.kind === "new" ? Promise.resolve(null) : api.actions()), []);
  // A successful propose replaces this history entry with the review step of the new request, so a
  // reload or Back never shows a form whose request was already sent.
  const onProposed = (view: PendingActionView) => navigate(reviewUrl(view), { replace: true, state: STEP_FOCUS });

  if (step.kind === "new") {
    return (
      <>
        <StepTitle focus={focusStep}>{titles.new}</StepTitle>
        {renderForm({ intro: <p className="page-subtitle">{subtitle}</p>, onProposed })}
      </>
    );
  }

  const heading = step.kind === "review" ? titles.review : step.kind === "edit" ? titles.edit : titles.new;
  if (!own.data) {
    return (
      <>
        <StepTitle focus={focusStep && Boolean(own.error)}>{heading}</StepTitle>
        {own.error ? (
          <ErrorBanner error={own.error} onRetry={own.reload} />
        ) : (
          <p className="thinking" role="status">
            Loading your request...
          </p>
        )}
      </>
    );
  }

  const list = own.data.actions;
  const action = list.find((a) => a.actionId === step.id);
  if (!action) {
    return (
      <>
        <StepTitle focus={focusStep}>{heading}</StepTitle>
        <div className="banner banner-info">
          <span>That request was not found among yours.</span>
          <Link className="btn" to="/actions">
            See all your requests
          </Link>
        </div>
      </>
    );
  }
  if (action.tool !== tool) return <Navigate replace to={`${requestPath(action.tool)}?${params.toString()}`} state={location.state} />;

  const conversationId = conversationOf(action, list);
  const backToChat = conversationId ? <Link to={`/chat/${conversationId}`}>Back to conversation</Link> : null;
  const args = (action.arguments ?? {}) as Record<string, unknown>;

  if (step.kind === "review") {
    return (
      <>
        <StepTitle focus={focusStep}>{heading}</StepTitle>
        {action.status === "awaiting_approval" ? (
          <p className="page-subtitle">Check the details below. Nothing is submitted until you approve.</p>
        ) : null}
        <ApprovalCard action={action} />
        <p className="request-links">
          <Link to="/actions">All my requests</Link>
          {backToChat}
        </p>
      </>
    );
  }

  if (step.kind === "from") {
    return (
      <>
        <StepTitle focus={focusStep}>{heading}</StepTitle>
        {renderForm({ intro: <p className="page-subtitle">Prefilled from an earlier request. {subtitle}</p>, initialArgs: args, onProposed })}
      </>
    );
  }

  return (
    <EditStep
      action={action}
      heading={heading}
      focusHeading={focusStep}
      subtitle={subtitle}
      backToChat={backToChat}
      renderForm={renderForm}
      onProposed={onProposed}
    />
  );
}

function EditStep({
  action,
  heading,
  focusHeading,
  subtitle,
  backToChat,
  renderForm,
  onProposed,
}: {
  action: PendingActionView;
  heading: string;
  focusHeading: boolean;
  subtitle: string;
  backToChat: ReactNode;
  renderForm: (props: RequestFormProps) => ReactNode;
  onProposed: (view: PendingActionView) => void;
}) {
  const editable = isEditable(action);
  // If the request expires while its edit form is open, the form keeps what was typed and submitting
  // it proposes a new request instead (the server would refuse to replace an expired one).
  const [expiredWhileEditing, setExpiredWhileEditing] = useState(false);
  useEffect(() => {
    if (!editable) return;
    const ms = Date.parse(action.expiresAt) - Date.now();
    const t = setTimeout(() => setExpiredWhileEditing(true), Math.max(0, Math.min(ms, 2_147_000_000)));
    return () => clearTimeout(t);
  }, [action.expiresAt, editable]);

  if (!editable) {
    return (
      <>
        <StepTitle focus={focusHeading}>{heading}</StepTitle>
        <NotEditable action={action} />
        <p className="request-links">
          <Link to="/actions">All my requests</Link>
          {backToChat}
        </p>
      </>
    );
  }
  return (
    <>
      <StepTitle focus={focusHeading}>{heading}</StepTitle>
      {renderForm({
        intro: (
          <>
            <p className="page-subtitle">{subtitle} Updating replaces the request you are editing.</p>
            {expiredWhileEditing ? (
              <div className="banner banner-info" role="status">
                The request you were editing expired, so submitting this form creates a new request.
              </div>
            ) : null}
          </>
        ),
        initialArgs: (action.arguments ?? {}) as Record<string, unknown>,
        ...(expiredWhileEditing ? {} : { supersedes: action.actionId }),
        onProposed,
      })}
      {backToChat ? <p className="request-links">{backToChat}</p> : null}
    </>
  );
}

/** Why a request can no longer be edited, and where to go instead. */
function NotEditable({ action }: { action: PendingActionView }) {
  const status = isEditable(action) ? action.status : action.status === "awaiting_approval" ? "expired" : action.status;
  const text =
    status === "rejected" && action.supersededBy
      ? "This request was already replaced by an edited request."
      : status === "executed"
        ? "This request was already approved."
        : status === "failed"
          ? "This request was already approved, but it could not be completed."
          : status === "rejected"
            ? "This request was already rejected."
            : status === "executing"
              ? "This request is being approved."
              : "This request expired before it was approved.";
  return (
    <div className="banner banner-info" data-testid="not-editable">
      <span>{text}</span>
      <span className="banner-actions">
        {action.supersededBy ? (
          <Link className="btn" to={focusUrl(action.supersededBy)}>
            See the new request
          </Link>
        ) : (
          <Link className="btn" to={startAgainUrl(action)} state={STEP_FOCUS}>
            Start again with these details
          </Link>
        )}
        {status === "executed" || status === "failed" ? (
          <Link className="btn" to={reviewUrl(action)} state={STEP_FOCUS}>
            See the outcome
          </Link>
        ) : null}
      </span>
    </div>
  );
}
