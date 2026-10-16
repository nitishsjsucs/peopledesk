// Structured ticket form. Client validation uses the same zod schema as the MCP tool and the server
// (CreateSupportTicketInput), and the submit goes through POST /api/actions, so the form path proposes
// a pending action exactly like chat and MCP do. The schema's issues are shown in plain words, tied to
// their fields, with one summary and focus on the first field to fix.
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PendingActionView } from "../../shared/api-types.ts";
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "../../shared/domain.ts";
import { CreateSupportTicketInput } from "../../shared/tool-schemas.ts";
import { api, ApiClientError } from "../lib/api.ts";
import { TICKET_CATEGORY_LABEL, TICKET_PRIORITY_LABEL } from "../lib/labels.ts";
import { useAsync } from "../lib/use-async.ts";
import { SubmitError } from "./SubmitError.tsx";

export type TicketValues = { category: string; subject: string; description: string; priority: string; relatedPolicyId: string };
type Field = keyof TicketValues;

const EMPTY: TicketValues = { category: "it", subject: "", description: "", priority: "normal", relatedPolicyId: "" };

/** Field order on the form: the summary lists, and focus goes to, the first one with a problem. */
const FIELDS: Field[] = ["category", "subject", "description", "priority", "relatedPolicyId"];
const FIELD_LABEL: Record<Field, string> = {
  category: "Category",
  subject: "Subject",
  description: "Description",
  priority: "Priority",
  relatedPolicyId: "Related policy",
};

/** Plain words for a schema issue on a field (zod's own messages read like "Too small: expected string to have >=5 characters"). */
function issueText(field: Field, code: string): string {
  switch (field) {
    case "subject":
      return code === "too_big" ? "Subject can be at most 120 characters." : "Subject needs at least 5 characters.";
    case "description":
      return code === "too_big" ? "Description can be at most 2000 characters." : "Description needs at least 10 characters.";
    case "relatedPolicyId":
      return "Use a policy id like POL-014.";
    case "category":
      return "Choose a category.";
    case "priority":
      return "Choose a priority.";
  }
}

const HINT: Partial<Record<Field, string>> = {
  subject: "5 to 120 characters.",
  description: "What happened, and what you need. At least 10 characters.",
  relatedPolicyId: "Optional. A policy id such as POL-014; suggestions list the policies you can read.",
};

type Props = {
  initial?: Partial<TicketValues>;
  supersedes?: string;
  onProposed: (view: PendingActionView) => void;
};

export function TicketForm({ initial, supersedes, onProposed }: Props) {
  const [values, setValues] = useState<TicketValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Readable policies for the Related policy suggestions; the form works without them.
  const policies = useAsync(() => api.policies(), []);

  const set = (k: Field) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  function showErrors(next: Partial<Record<Field, string>>) {
    setErrors(next);
    const first = FIELDS.find((f) => next[f]);
    if (first) requestAnimationFrameSafe(() => formRef.current?.querySelector<HTMLElement>(`#ticket-${first}`)?.focus());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setSubmitError(null);
    const candidate = {
      category: values.category,
      subject: values.subject,
      description: values.description,
      priority: values.priority,
      ...(values.relatedPolicyId.trim() ? { relatedPolicyId: values.relatedPolicyId.trim().toUpperCase() } : {}),
    };
    const parsed = CreateSupportTicketInput.safeParse(candidate);
    if (!parsed.success) {
      const next: Partial<Record<Field, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "") as Field;
        if (FIELDS.includes(field)) next[field] ??= issueText(field, issue.code);
      }
      showErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onProposed(await api.propose("create_support_ticket", parsed.data, supersedes));
    } catch (err) {
      // The server checks what the client cannot: a related policy above the person's clearance.
      if (err instanceof ApiClientError && err.code === "validation_error" && err.message.startsWith("relatedPolicyId")) {
        showErrors({ relatedPolicyId: "Choose a policy you can read, for example POL-014." });
      } else {
        setSubmitError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  const invalid = FIELDS.filter((f) => errors[f]);
  const describedBy = (k: Field) => [HINT[k] ? `ticket-${k}-hint` : null, errors[k] ? `ticket-${k}-error` : null].filter(Boolean).join(" ") || undefined;
  const fieldProps = (k: Field) => ({
    id: `ticket-${k}`,
    value: values[k],
    onChange: set(k),
    "aria-invalid": errors[k] ? true : undefined,
    "aria-describedby": describedBy(k),
  });
  const hint = (k: Field) =>
    HINT[k] ? (
      <span className="field-hint" id={`ticket-${k}-hint`}>
        {HINT[k]}
      </span>
    ) : null;
  const err = (k: Field) =>
    errors[k] ? (
      <span className="field-error" id={`ticket-${k}-error`}>
        {errors[k]}
      </span>
    ) : null;

  return (
    <form className="card" onSubmit={submit} noValidate aria-label="New support ticket" ref={formRef}>
      {invalid.length > 0 ? (
        <p className="banner banner-error" role="alert" data-testid="ticket-error-summary">
          Check {invalid.length} {invalid.length === 1 ? "field" : "fields"}: {invalid.map((f) => FIELD_LABEL[f]).join(", ")}.
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="ticket-category">Category</label>
        <select {...fieldProps("category")}>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {TICKET_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        {err("category")}
      </div>
      <div className="field">
        <label htmlFor="ticket-subject">Subject</label>
        <input {...fieldProps("subject")} maxLength={120} />
        {hint("subject")}
        {err("subject")}
      </div>
      <div className="field">
        <label htmlFor="ticket-description">Description</label>
        <textarea {...fieldProps("description")} rows={5} maxLength={2000} />
        {hint("description")}
        {err("description")}
      </div>
      <div className="field">
        <label htmlFor="ticket-priority">Priority</label>
        <select {...fieldProps("priority")}>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TICKET_PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
        {err("priority")}
      </div>
      <div className="field">
        <label htmlFor="ticket-relatedPolicyId">Related policy (optional)</label>
        <input {...fieldProps("relatedPolicyId")} placeholder="POL-014" list="ticket-policy-options" autoComplete="off" />
        {policies.data ? (
          <datalist id="ticket-policy-options" data-testid="ticket-policy-options">
            {policies.data.documents.map((d) => (
              <option key={d.docId} value={d.docId}>
                {d.title}
              </option>
            ))}
          </datalist>
        ) : null}
        {hint("relatedPolicyId")}
        {err("relatedPolicyId")}
      </div>
      {submitError ? <SubmitError error={submitError} /> : null}
      <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>
        {supersedes ? "Update request" : "Review request"}
      </button>
    </form>
  );
}

/** Focus after React has rendered the error text, so a screen reader reads the field with its error. */
function requestAnimationFrameSafe(run: () => void) {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}
