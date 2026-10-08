// Deterministic texts for tool results, refusals, clarifications and approvals. Tool results are never
// paraphrased by a model, so data cannot be restated incorrectly.
import type { OnboardingProgress, PendingActionView, Session } from "../../shared/api-types.ts";
import type { ToolErrorCode, TurnErrorCode } from "../../shared/domain.ts";

export const TEXT = {
  notFound: "I couldn't find that in the policies available to you.",
  person: "I can only look up that information for you and the people you support.",
  outOfScope: "I can help with company policies, support tickets, onboarding and orientation sessions.",
  useApproveButton: "Use the Approve button on the request card to confirm.",
  genericClarify: "Could you tell me a bit more about what you need?",
} as const;

export const ERROR_TEXT: Record<TurnErrorCode, string> = {
  retrieval_unavailable: "Policy search is unavailable right now, so I can't answer that safely. Please try again shortly.",
  provider_unavailable: "The assistant is unavailable right now. Please try again shortly.",
  turn_timeout: "That took too long to answer. Please try again.",
  internal: "Something went wrong on our side. Please try again.",
};

const FIELD_PROMPTS: Record<string, string> = {
  description: "a short description of the problem",
  subject: "a short title for the problem",
  category: "what kind of help you need (IT, payroll, benefits, facilities, HR or an access request)",
  sessionId: "which orientation session you want (for example ORI-007)",
  employeeId: "who the booking is for",
  query: "what policy you are asking about",
};

/** Clarification for a validation error, naming the missing or invalid fields. */
export function clarifyForFields(tool: string, fields: readonly string[]): string {
  const wanted = [...new Set(fields)].map((f) => FIELD_PROMPTS[f] ?? f);
  const action =
    tool === "create_support_ticket" ? "open that ticket" : tool === "schedule_orientation_session" ? "book that session" : "do that";
  if (wanted.length === 0) return `To ${action} I need a little more information.`;
  return `To ${action} I need ${wanted.join(" and ")}.`;
}

/** Field names mentioned in a validation message ("Input validation error: ... description: Required"). */
export function fieldsFromValidationText(text: string): string[] {
  const fields = new Set<string>();
  for (const m of text.matchAll(/\b(description|subject|category|priority|sessionId|employeeId|relatedPolicyId|query|status|limit|format|region|fromDate|toDate)\b/g)) {
    fields.add(m[1] as string);
  }
  return [...fields];
}

/** Text for a tool error that is not a validation problem. */
export function textForToolError(code: ToolErrorCode, tool: string): { kind: "refuse" | "clarify"; text: string } {
  switch (code) {
    case "forbidden":
      return { kind: "refuse", text: TEXT.person };
    case "not_found":
      return tool === "schedule_orientation_session"
        ? { kind: "clarify", text: "I couldn't find that orientation session. Which session would you like?" }
        : { kind: "refuse", text: TEXT.person };
    case "not_in_onboarding":
      return { kind: "refuse", text: "Orientation sessions can only be booked for people who are in onboarding." };
    case "already_booked":
      return { kind: "refuse", text: "That person already has an orientation session booked." };
    case "session_full":
      return { kind: "clarify", text: "That session is full. Would you like a different session?" };
    case "session_in_past":
      return { kind: "clarify", text: "That session has already started. Would you like a later session?" };
    case "rate_limited":
      return { kind: "refuse", text: "You already have 5 requests waiting for approval. Approve or reject one first." };
    case "validation_error":
      return { kind: "clarify", text: TEXT.genericClarify };
    case "conflict":
    case "retrieval_unavailable":
      return { kind: "refuse", text: "I couldn't complete that request. Please try again." };
  }
}

export function renderTickets(result: { tickets: Array<{ status: string }> }): string {
  const n = result.tickets.length;
  if (n === 0) return "You have no support tickets.";
  const open = result.tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;
  return `You have ${n} support ${n === 1 ? "ticket" : "tickets"}; ${open} ${open === 1 ? "is" : "are"} still open or in progress.`;
}

export function renderOnboarding(p: OnboardingProgress): string {
  return (
    `${p.fullName}'s onboarding is ${p.percentComplete}% complete: ${p.counts.done} done, ` +
    `${p.counts.inProgress} in progress, ${p.counts.pending} pending and ${p.counts.blocked} blocked.`
  );
}

export function renderSessions(result: { sessions: Session[] }): string {
  const n = result.sessions.length;
  if (n === 0) return "There are no orientation sessions in that window.";
  const open = result.sessions.filter((s) => s.seatsRemaining > 0).length;
  return `There ${n === 1 ? "is" : "are"} ${n} upcoming orientation ${n === 1 ? "session" : "sessions"}; ${open} ${open === 1 ? "has" : "have"} seats left.`;
}

export function renderApproval(view: PendingActionView): string {
  return `I prepared this request: ${view.preview.title}. Nothing has been submitted yet. Review it and press Approve to go ahead, or Reject to cancel.`;
}
