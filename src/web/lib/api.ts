// Typed fetch wrapper for the SPA. Every response is parsed with the same zod schemas the Worker uses;
// errors are parsed with the shared error envelope. Credentials are the Access cookie (production) or
// the dev CF_Authorization cookie; the browser adds Origin and Sec-Fetch-Site on POSTs.
import type { z } from "zod";
import {
  ActionListSchema,
  ApiErrorSchema,
  ApproveResponseSchema,
  ConversationCreatedSchema,
  ConversationListSchema,
  ConversationSchema,
  MeSchema,
  OnboardingProgressSchema,
  PendingActionViewSchema,
  PolicyDocumentSchema,
  PolicyListSchema,
  PolicyVersionSchema,
  RejectResponseSchema,
  SessionListSchema,
  TeamSchema,
  TicketListSchema,
  TurnResultSchema,
} from "../../shared/api-types.ts";
import type { ActionStatus, PolicyCategory, TicketStatus, WriteToolName } from "../../shared/domain.ts";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, requestId: string | null, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (input, init) => fetch(input, init);

/** Test seam: swap the fetch implementation. */
export function setFetch(f: Fetch): void {
  fetchImpl = f;
}

async function request<S extends z.ZodType>(method: "GET" | "POST", path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
  const res = await fetchImpl(path, {
    method,
    credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiClientError(res.status, e.code, e.message, e.requestId, e.details);
    }
    throw new ApiClientError(res.status, "internal", `Request failed with status ${res.status}.`, null);
  }
  return schema.parse(json) as z.infer<S>;
}

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  me: () => request("GET", "/api/me", MeSchema),
  conversations: () => request("GET", "/api/conversations", ConversationListSchema),
  createConversation: () => request("POST", "/api/conversations", ConversationCreatedSchema, {}),
  conversation: (id: string) => request("GET", `/api/conversations/${encodeURIComponent(id)}`, ConversationSchema),
  sendMessage: (id: string, text: string) =>
    request("POST", `/api/conversations/${encodeURIComponent(id)}/messages`, TurnResultSchema, { text }),
  policies: (filter: { category?: PolicyCategory; q?: string } = {}) =>
    request("GET", `/api/policies${qs({ category: filter.category, q: filter.q })}`, PolicyListSchema),
  policy: (docId: string) => request("GET", `/api/policies/${encodeURIComponent(docId)}`, PolicyDocumentSchema),
  policyVersion: (docId: string, version: number) =>
    request("GET", `/api/policies/${encodeURIComponent(docId)}/versions/${version}`, PolicyVersionSchema),
  tickets: (status?: TicketStatus) => request("GET", `/api/tickets${qs({ status })}`, TicketListSchema),
  onboarding: () => request("GET", "/api/onboarding", OnboardingProgressSchema),
  onboardingFor: (employeeId: string) => request("GET", `/api/onboarding/${encodeURIComponent(employeeId)}`, OnboardingProgressSchema),
  team: () => request("GET", "/api/team", TeamSchema),
  sessions: (filter: { from?: string; to?: string; format?: string; region?: string } = {}) =>
    request("GET", `/api/orientation-sessions${qs(filter)}`, SessionListSchema),
  actions: (status?: ActionStatus) => request("GET", `/api/actions${qs({ status })}`, ActionListSchema),
  propose: (tool: WriteToolName, args: unknown, supersedes?: string) =>
    request("POST", "/api/actions", PendingActionViewSchema, { tool, arguments: args, ...(supersedes ? { supersedes } : {}) }),
  approve: (actionId: string) => request("POST", `/api/actions/${encodeURIComponent(actionId)}/approve`, ApproveResponseSchema, {}),
  reject: (actionId: string, reason?: string) =>
    request("POST", `/api/actions/${encodeURIComponent(actionId)}/reject`, RejectResponseSchema, reason ? { reason } : {}),
};

export type Api = typeof api;
