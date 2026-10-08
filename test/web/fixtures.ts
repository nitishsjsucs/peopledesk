// Response fixtures and a routing fake fetch for the web tests (shapes validated by the shared zod schemas).
import type { Me, PendingActionView, TurnResult } from "../../src/shared/api-types.ts";
import { setFetch } from "../../src/web/lib/api.ts";

export const me: Me = {
  employeeId: "E0023",
  email: "emeka.adeyemi@peopledesk.test",
  fullName: "Emeka Adeyemi",
  role: "employee",
  region: "US",
  department: "Engineering",
  jobTitle: "Software Engineer",
  managerId: "E0007",
  startDate: "2024-01-08",
  inOnboarding: false,
  directReportIds: [],
  identityKind: "user",
};

export function turn(overrides: Partial<TurnResult>): TurnResult {
  return {
    turnId: crypto.randomUUID(),
    conversationId: "c1",
    kind: "answer",
    text: "",
    citations: [],
    trace: {
      asOf: "2026-10-01",
      llmProvider: "stub",
      model: "stub-rules-v1",
      totalMs: 12,
      router: { intent: "policy_question", ms: 1, inputTokens: 100, outputTokens: 10, retries: 0 },
      gatewayLogIdHints: [],
    },
    ...overrides,
  };
}

export const ptoCitation = {
  passageId: "POL-014@3#3",
  docId: "POL-014",
  version: 3,
  title: "PTO Accrual",
  section: "Policy",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  sourceKey: "policies/r1-all/POL-014/v03.md",
  quote: "- Paid time off accrues at 1.5 days per month.",
};

export function pendingTicket(overrides: Partial<PendingActionView> = {}): PendingActionView {
  return {
    actionId: "6f1c2b8e-3d1a-4c9b-9e1f-2a3b4c5d6e7f",
    tool: "create_support_ticket",
    status: "awaiting_approval",
    preview: {
      title: "New support ticket",
      fields: [
        { label: "Category", value: "IT" },
        { label: "Subject", value: "Laptop will not boot" },
        { label: "Priority", value: "normal" },
      ],
    },
    arguments: { category: "it", subject: "Laptop will not boot", description: "Black screen after the logo.", priority: "normal" },
    createdAt: "2026-10-08T10:00:00.000Z",
    expiresAt: new Date(Date.now() + 14 * 60_000 + 30_000).toISOString(),
    source: "chat",
    conversationId: "c1",
    ...overrides,
  };
}

export type Route = { method?: string; path: string | RegExp; status?: number; body: unknown | ((init: RequestInit) => unknown) };

/** Installs a fetch that answers by method and path; records every call. */
export function installFetch(routes: Route[]): Array<{ method: string; path: string; body: unknown }> {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  setFetch(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    calls.push({ method, path: url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const route = routes.find(
      (r) => (r.method ?? "GET") === method && (typeof r.path === "string" ? r.path === url : r.path.test(url)),
    );
    if (!route) return new Response(JSON.stringify({ error: { code: "not_found", message: `no fake for ${method} ${url}`, requestId: "t" } }), { status: 404 });
    const body = typeof route.body === "function" ? (route.body as (i: RequestInit) => unknown)(init ?? {}) : route.body;
    return new Response(JSON.stringify(body), { status: route.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}
