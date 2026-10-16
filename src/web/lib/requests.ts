// Where each request lives in the UI. The review and edit steps of /requests/ticket and
// /requests/orientation are addressed by search parameters, so they survive a reload, Back and Forward:
//   ?review=<actionId>  the request's approval card, in its current state
//   ?edit=<actionId>    the prefilled form; submitting replaces (supersedes) that request
//   ?from=<actionId>    the prefilled form; submitting proposes a new request and replaces nothing
// The server stays the authority: every step reads GET /api/actions and proposes through POST /api/actions.
import type { PendingActionView } from "../../shared/api-types.ts";
import type { WriteToolName } from "../../shared/domain.ts";

type ActionRef = Pick<PendingActionView, "actionId" | "tool">;

export function requestPath(tool: WriteToolName): string {
  return tool === "create_support_ticket" ? "/requests/ticket" : "/requests/orientation";
}

export const reviewUrl = (a: ActionRef) => `${requestPath(a.tool)}?review=${encodeURIComponent(a.actionId)}`;
export const editUrl = (a: ActionRef) => `${requestPath(a.tool)}?edit=${encodeURIComponent(a.actionId)}`;
export const startAgainUrl = (a: ActionRef) => `${requestPath(a.tool)}?from=${encodeURIComponent(a.actionId)}`;
export const focusUrl = (actionId: string) => `/actions?focus=${encodeURIComponent(actionId)}`;

/** Whether the server would still accept an edit (a supersede) of this request. */
export function isEditable(a: Pick<PendingActionView, "status" | "expiresAt">, nowMs: number = Date.now()): boolean {
  return a.status === "awaiting_approval" && Date.parse(a.expiresAt) > nowMs;
}

/**
 * The conversation a request came from. A request edited on a form page has no conversation of its
 * own, so this follows the supersede links back to the original request (a list of the viewer's own
 * requests, newest 100, as GET /api/actions returns it).
 */
export function conversationOf(a: PendingActionView, list: readonly PendingActionView[]): string | null {
  let current: PendingActionView | undefined = a;
  const seen = new Set<string>();
  while (current && !seen.has(current.actionId)) {
    if (current.conversationId) return current.conversationId;
    seen.add(current.actionId);
    const id: string = current.actionId;
    current = list.find((x) => x.supersededBy === id);
  }
  return null;
}
