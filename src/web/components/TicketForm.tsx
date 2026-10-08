// Structured ticket form. Client validation uses the same zod schema as the MCP tool and the server
// (CreateSupportTicketInput), and the submit goes through POST /api/actions, so the form path proposes
// a pending action exactly like chat and MCP do.
import { useState } from "react";
import type { FormEvent } from "react";
import type { PendingActionView } from "../../shared/api-types.ts";
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "../../shared/domain.ts";
import { CreateSupportTicketInput } from "../../shared/tool-schemas.ts";
import { api } from "../lib/api.ts";
import { errorMessage } from "./ErrorBanner.tsx";

const CATEGORY_LABEL: Record<(typeof TICKET_CATEGORIES)[number], string> = {
  it: "IT",
  payroll: "Payroll",
  benefits: "Benefits",
  facilities: "Facilities",
  hr_general: "HR (general)",
  access_request: "Access request",
};

export type TicketValues = { category: string; subject: string; description: string; priority: string; relatedPolicyId: string };

const EMPTY: TicketValues = { category: "it", subject: "", description: "", priority: "normal", relatedPolicyId: "" };

type Props = {
  initial?: Partial<TicketValues>;
  supersedes?: string;
  onProposed: (view: PendingActionView) => void;
};

export function TicketForm({ initial, supersedes, onProposed }: Props) {
  const [values, setValues] = useState<TicketValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof TicketValues, string>>>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof TicketValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
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
      const next: Partial<Record<keyof TicketValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "") as keyof TicketValues;
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      onProposed(await api.propose("create_support_ticket", parsed.data, supersedes));
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  }

  const err = (k: keyof TicketValues) =>
    errors[k] ? (
      <span className="field-error" id={`ticket-${k}-error`} role="alert">
        {errors[k]}
      </span>
    ) : null;

  return (
    <form className="card" onSubmit={submit} noValidate aria-label="New support ticket">
      <div className="field">
        <label htmlFor="ticket-category">Category</label>
        <select id="ticket-category" value={values.category} onChange={set("category")}>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        {err("category")}
      </div>
      <div className="field">
        <label htmlFor="ticket-subject">Subject</label>
        <input
          id="ticket-subject"
          value={values.subject}
          onChange={set("subject")}
          maxLength={120}
          aria-invalid={!!errors.subject}
          aria-describedby={errors.subject ? "ticket-subject-error" : undefined}
        />
        <span className="field-hint">5 to 120 characters.</span>
        {err("subject")}
      </div>
      <div className="field">
        <label htmlFor="ticket-description">Description</label>
        <textarea
          id="ticket-description"
          value={values.description}
          onChange={set("description")}
          rows={5}
          maxLength={2000}
          aria-invalid={!!errors.description}
          aria-describedby={errors.description ? "ticket-description-error" : undefined}
        />
        <span className="field-hint">What happened, and what you need. At least 10 characters.</span>
        {err("description")}
      </div>
      <div className="field">
        <label htmlFor="ticket-priority">Priority</label>
        <select id="ticket-priority" value={values.priority} onChange={set("priority")}>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ticket-policy">Related policy (optional)</label>
        <input id="ticket-policy" value={values.relatedPolicyId} onChange={set("relatedPolicyId")} placeholder="POL-014" />
        {err("relatedPolicyId")}
      </div>
      {submitError ? (
        <p className="field-error" role="alert">
          {errorMessage(submitError)}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {supersedes ? "Update request" : "Review request"}
      </button>
    </form>
  );
}
