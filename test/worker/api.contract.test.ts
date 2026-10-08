// Every route's response validates against its shared zod schema, and errors use one envelope
// (400, 401, 403, 404, 409, 410 and 429). The route inventory at the end fails when a route is added
// to the Worker without a contract case here.
import { createExecutionContext, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  ActionListSchema,
  ApproveResponseSchema,
  ConversationCreatedSchema,
  ConversationListSchema,
  ConversationSchema,
  DevTokenSchema,
  GatewayLogsSchema,
  HealthSchema,
  MeSchema,
  OnboardingProgressSchema,
  PendingActionViewSchema,
  PersonasSchema,
  PolicyDocumentSchema,
  PolicyListSchema,
  PolicyVersionSchema,
  RejectResponseSchema,
  SessionListSchema,
  TeamSchema,
  TicketListSchema,
  TurnResultSchema,
} from "../../src/shared/api-types.ts";
import type { TurnTrace } from "../../src/shared/api-types.ts";
import { PERSONA_KEYS } from "../../src/shared/domain.ts";
import { buildApp } from "../../src/worker/app.ts";
import type { ConversationAgent } from "../../src/worker/chat/agent.ts";
import { agentFor } from "../../src/worker/routes/conversations.ts";
import worker from "../../src/worker/index.ts";
import { proposeTicket, ticketArgs } from "../helpers/actions.ts";
import { manifest, org, persona, planned, reportsOf, spareEmployees } from "../helpers/fixtures.ts";
import { api, BASE_URL, expectError, expectJson, tokenFor } from "../helpers/http.ts";

const spares = spareEmployees(6, (e) => !planned.has(e.id));
const spare = (i: number) => spares[i]!.email;

const docOfRank = (rank: 1 | 2 | 3) => manifest.documents.find((d) => d.rank === rank && d.versions.length > 1)!;

async function newConversation(as: string): Promise<string> {
  return (await expectJson(await api("/api/conversations", { as, body: {} }), ConversationCreatedSchema, 201)).id;
}

describe("read routes", () => {
  it("GET /api/health and /api/me", async () => {
    await expectJson(await api("/api/health", { as: "hr_admin" }), HealthSchema);
    const me = await expectJson(await api("/api/me", { as: "manager_with_new_hires" }), MeSchema);
    expect(me.directReportIds).toEqual(reportsOf(me.employeeId).map((e) => e.id));
    expect((await expectJson(await api("/api/me", { as: "new_hire_unbooked" }), MeSchema)).inOnboarding).toBe(true);
  });

  it("GET /api/tickets returns only the caller's tickets, newest first", async () => {
    const p = persona("tenured_employee");
    const body = await expectJson(await api("/api/tickets", { as: p.key }), TicketListSchema);
    const expected = org.tickets.filter((t) => t.requesterId === p.employeeId);
    expect(body.tickets.map((t) => t.id).sort()).toEqual(expected.map((t) => t.id).sort());
    expect(body.tickets.every((t) => t.requesterId === p.employeeId)).toBe(true);
    const sorted = [...body.tickets].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    expect(body.tickets.map((t) => t.id)).toEqual(sorted.map((t) => t.id));
    const open = await expectJson(await api("/api/tickets?status=open", { as: p.key }), TicketListSchema);
    expect(open.tickets.every((t) => t.status === "open")).toBe(true);
    await expectError(await api("/api/tickets?status=lost", { as: p.key }), 400, "validation_error");
  });

  it("GET /api/onboarding for self, and 404 without a plan", async () => {
    const p = persona("new_hire_unbooked");
    const body = await expectJson(await api("/api/onboarding", { as: p.key }), OnboardingProgressSchema);
    expect(body.employeeId).toBe(p.employeeId);
    expect(body.tasks).toHaveLength(12);
    expect(body.counts.done + body.counts.inProgress + body.counts.pending + body.counts.blocked).toBe(12);
    expect(body.percentComplete).toBe(Math.round((body.counts.done / 12) * 100));
    await expectError(await api("/api/onboarding", { as: "tenured_employee" }), 404, "not_found");
  });

  it("GET /api/onboarding/:employeeId for self, manager of, and hr_admin; 404 otherwise", async () => {
    const mgr = persona("manager_with_new_hires");
    const report = reportsOf(mgr.employeeId).find((e) => planned.has(e.id))!;
    const stranger = org.onboardingPlans.find((p) => !reportsOf(mgr.employeeId).some((e) => e.id === p.employeeId))!;
    await expectJson(await api(`/api/onboarding/${report.id}`, { as: mgr.key }), OnboardingProgressSchema);
    await expectJson(await api(`/api/onboarding/${stranger.employeeId}`, { as: "hr_admin" }), OnboardingProgressSchema);
    const self = persona("new_hire_booked");
    await expectJson(await api(`/api/onboarding/${self.employeeId}`, { as: self.key }), OnboardingProgressSchema);
    await expectError(await api(`/api/onboarding/${stranger.employeeId}`, { as: mgr.key }), 404, "not_found");
    await expectError(await api(`/api/onboarding/${report.id}`, { as: "tenured_employee" }), 404, "not_found");
    await expectError(await api("/api/onboarding/E9999", { as: "hr_admin" }), 404, "not_found");
  });

  it("GET /api/team returns the directory slice", async () => {
    const mgr = persona("manager_with_new_hires");
    const team = await expectJson(await api("/api/team", { as: mgr.key }), TeamSchema);
    expect(team.members.map((m) => m.employeeId)).toEqual(reportsOf(mgr.employeeId).map((e) => e.id));
    expect(team.members.filter((m) => m.inOnboarding)).toHaveLength(5);
    const hr = await expectJson(await api("/api/team", { as: "hr_admin" }), TeamSchema);
    expect(hr.members).toHaveLength(30);
    expect(hr.members.filter((m) => !m.booked)).toHaveLength(12);
    await expectError(await api("/api/team", { as: "tenured_employee" }), 403, "forbidden");
  });

  it("GET /api/orientation-sessions reports seats remaining", async () => {
    const all = await expectJson(await api("/api/orientation-sessions?to=2026-12-31", { as: "new_hire_unbooked" }), SessionListSchema);
    expect(all.sessions).toHaveLength(24);
    expect(all.sessions.filter((s) => s.seatsRemaining === 0)).toHaveLength(2);
    expect(all.sessions.reduce((n, s) => n + (s.capacity - s.seatsRemaining), 0)).toBe(18);
    const def = await expectJson(await api("/api/orientation-sessions", { as: "new_hire_unbooked" }), SessionListSchema);
    expect(def.sessions.every((s) => s.startsAt.slice(0, 10) <= "2026-11-30")).toBe(true);
    const virtual = await expectJson(await api("/api/orientation-sessions?format=virtual&to=2026-12-31", { as: "hr_admin" }), SessionListSchema);
    expect(virtual.sessions.every((s) => s.format === "virtual")).toBe(true);
    await expectError(await api("/api/orientation-sessions?from=yesterday", { as: "hr_admin" }), 400, "validation_error");
  });
});

describe("policy routes", () => {
  it("GET /api/policies is clearance-filtered and accepts category and q", async () => {
    const employee = await expectJson(await api("/api/policies", { as: "tenured_employee" }), PolicyListSchema);
    expect(employee.documents).toHaveLength(70);
    expect(employee.documents.every((d) => d.audience === "all")).toBe(true);
    expect((await expectJson(await api("/api/policies", { as: "hr_admin" }), PolicyListSchema)).documents).toHaveLength(100);
    const timeOff = await expectJson(await api("/api/policies?category=time_off", { as: "manager_no_new_hires" }), PolicyListSchema);
    expect(timeOff.documents).toHaveLength(9);
    expect(timeOff.documents.every((d) => d.category === "time_off")).toBe(true);
    const doc = docOfRank(1);
    const q = await expectJson(await api(`/api/policies?q=${encodeURIComponent(doc.title)}`, { as: "tenured_employee" }), PolicyListSchema);
    expect(q.documents.map((d) => d.docId)).toContain(doc.docId);
    await expectError(await api("/api/policies?category=snacks", { as: "tenured_employee" }), 400, "validation_error");
  });

  it("GET /api/policies/:docId and /versions/:version, with 404 above clearance", async () => {
    const doc = docOfRank(1);
    const body = await expectJson(await api(`/api/policies/${doc.docId}`, { as: "tenured_employee" }), PolicyDocumentSchema);
    expect(body.versions.map((v) => v.version)).toEqual(doc.versions.map((v) => v.version));
    expect(body.versions.map((v) => v.status)).toEqual(doc.versions.map((v) => v.status));
    const v = doc.versions[0]!;
    const version = await expectJson(
      await api(`/api/policies/${doc.docId}/versions/${v.version}`, { as: "tenured_employee" }),
      PolicyVersionSchema,
    );
    expect(version.r2Key).toBe(v.r2Key);
    expect(version.markdown).toContain(`doc_id: ${doc.docId}`);
    const restricted = docOfRank(3);
    await expectError(await api(`/api/policies/${restricted.docId}`, { as: "manager_no_new_hires" }), 404, "not_found");
    await expectError(await api(`/api/policies/${restricted.docId}/versions/1`, { as: "tenured_employee" }), 404, "not_found");
    await expectError(await api("/api/policies/POL-999", { as: "hr_admin" }), 404, "not_found");
    await expectJson(await api(`/api/policies/${restricted.docId}/versions/1`, { as: "hr_admin" }), PolicyVersionSchema);
  });
});

describe("conversation routes", () => {
  it("create, list, send a message, and read the transcript", async () => {
    const as = spare(0);
    const id = await newConversation(as);
    const list = await expectJson(await api("/api/conversations", { as }), ConversationListSchema);
    expect(list.conversations.map((c) => c.id)).toContain(id);
    const turn = await expectJson(
      await api(`/api/conversations/${id}/messages`, { as, body: { text: "How do I report a phishing email?" } }),
      TurnResultSchema,
    );
    expect(turn.conversationId).toBe(id);
    const conv = await expectJson(await api(`/api/conversations/${id}`, { as }), ConversationSchema);
    expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conv.messages[1]!.turnId).toBe(turn.turnId);
  });

  it("answers 404 for another person's conversation and 400 for an invalid message", async () => {
    const id = await newConversation(spare(1));
    await expectError(await api(`/api/conversations/${id}`, { as: spare(2) }), 404, "not_found");
    await expectError(await api(`/api/conversations/${id}/messages`, { as: spare(2), body: { text: "hello there" } }), 404, "not_found");
    await expectError(await api(`/api/conversations/${id}/messages`, { as: spare(1), body: { text: "   " } }), 400, "validation_error");
    await expectError(await api(`/api/conversations/${id}/messages`, { as: spare(1), body: { text: "hi", extra: 1 } }), 400, "validation_error");
    await expectError(await api("/api/conversations/not-a-uuid", { as: spare(1) }), 404, "not_found");
  });

  it("answers 404 for gateway logs unless the provider is Workers AI", async () => {
    const as = spare(1);
    const id = await newConversation(as);
    const turn = await expectJson(await api(`/api/conversations/${id}/messages`, { as, body: { text: "Show my tickets" } }), TurnResultSchema);
    await expectError(await api(`/api/conversations/${id}/turns/${turn.turnId}/gateway-logs`, { as }), 404, "not_found");
  });
});

describe("gateway-logs route with Workers AI (fake AI binding)", () => {
  // The Worker's fetch is called with a Workers AI env; the route reads the turn's trace from the
  // Agent (which reads nothing from env here) and the logs through env.AI.gateway(id).getLog.
  const log = (id: string, turnId: string, purpose: string, extra: Partial<AiGatewayLog> = {}): AiGatewayLog => ({
    id,
    provider: "workers-ai",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    path: "/",
    duration: 640,
    status_code: 200,
    success: true,
    cached: false,
    tokens_in: 900,
    tokens_out: 60,
    metadata: { turnId, purpose },
    request_size: 1,
    request_head_complete: true,
    response_size: 1,
    response_head_complete: true,
    created_at: new Date(),
    ...extra,
  });

  it("returns the logs whose metadata matches the turn and reports the rest as missing", async () => {
    const as = spare(3);
    const employeeId = spares[3]!.id;
    const id = await newConversation(as);
    const turn = await expectJson(await api(`/api/conversations/${id}/messages`, { as, body: { text: "Show my tickets" } }), TurnResultSchema);
    // The stub provider records no hints, so give the stored trace the hints a Workers AI turn would have.
    const stub = await agentFor(env, employeeId, id);
    await runInDurableObject(stub, (agent: ConversationAgent) => {
      const trace: TurnTrace = { ...turn.trace, gatewayLogIdHints: ["router:log-r", "composer:log-c", "composer:log-gone"] };
      agent.sql`UPDATE pd_turns SET trace_json = ${JSON.stringify(trace)} WHERE turn_id = ${turn.turnId}`;
    });
    const logs: Record<string, AiGatewayLog> = {
      "log-r": log("log-r", turn.turnId, "router", { cost: 0.00042 }),
      "log-c": log("log-c", "another-turn", "composer"),
    };
    const gatewayIds: string[] = [];
    const ai = {
      gateway: (gatewayId: string) => {
        gatewayIds.push(gatewayId);
        return { getLog: async (logId: string) => logs[logId] ?? Promise.reject(new Error("log not found")) };
      },
      run: async () => {
        throw new Error("no model calls on this route");
      },
    };
    const workersAiEnv = {
      ...env,
      LLM_PROVIDER: "workers-ai",
      WORKERS_AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      AI_GATEWAY_ID: "peopledesk",
      AI: ai,
    } as unknown as Env;
    const get = async (path: string, who = as) =>
      worker.fetch(
        new Request(`${BASE_URL}${path}`, { headers: { "Cf-Access-Jwt-Assertion": await tokenFor(who) } }),
        workersAiEnv,
        createExecutionContext(),
      );

    const body = await expectJson(await get(`/api/conversations/${id}/turns/${turn.turnId}/gateway-logs`), GatewayLogsSchema);
    expect(gatewayIds).toEqual(["peopledesk"]);
    expect(body.logs).toEqual([
      { logId: "log-r", purpose: "router", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", tokensIn: 900, tokensOut: 60, durationMs: 640, cost: 0.00042, cached: false },
    ]);
    expect(body.missing.map((m) => m.logId)).toEqual(["log-c", "log-gone"]);
    await expectError(await get(`/api/conversations/${id}/turns/${crypto.randomUUID()}/gateway-logs`), 404, "not_found");
    await expectError(await get(`/api/conversations/${id}/turns/${turn.turnId}/gateway-logs`, spare(4)), 404, "not_found");
  });
});

describe("action routes", () => {
  it("propose (201), list, approve and reject", async () => {
    const as = spare(5);
    const a = await proposeTicket(as, ticketArgs(1));
    const b = await proposeTicket(as, ticketArgs(2));
    const listed = await expectJson(await api("/api/actions?status=awaiting_approval", { as }), ActionListSchema);
    expect(listed.actions.map((x) => x.actionId).sort()).toEqual([a.actionId, b.actionId].sort());
    const approved = await expectJson(await api(`/api/actions/${a.actionId}/approve`, { as, body: {} }), ApproveResponseSchema);
    expect(approved).toMatchObject({ status: "executed", replayed: false });
    const rejected = await expectJson(await api(`/api/actions/${b.actionId}/reject`, { as, body: { reason: "Not needed." } }), RejectResponseSchema);
    expect(rejected).toEqual({ status: "rejected" });
    const all = await expectJson(await api("/api/actions", { as }), ActionListSchema);
    expect(all.actions.map((x) => [x.actionId, x.status]).sort()).toEqual(
      [
        [a.actionId, "executed"],
        [b.actionId, "rejected"],
      ].sort(),
    );
    for (const x of all.actions) PendingActionViewSchema.parse(x);
    await expectError(await api("/api/actions?status=maybe", { as }), 400, "validation_error");
  });
});

describe("dev routes", () => {
  it("GET /dev/personas, POST /dev/token and GET /dev/login", async () => {
    const personas = await expectJson(await api("/dev/personas"), PersonasSchema);
    expect(personas.personas.map((p) => p.key).sort()).toEqual([...PERSONA_KEYS].sort());
    const res = await api("/dev/token", { body: { email: persona("tenured_employee").email } });
    expect(res.headers.get("set-cookie")).toMatch(/^CF_Authorization=.+HttpOnly/i);
    const issued = await expectJson(res, DevTokenSchema);
    await expectJson(await api("/api/me", { token: issued.token }), MeSchema);
    const login = await api("/dev/login");
    expect(login.status).toBe(200);
    expect(login.headers.get("content-type")).toMatch(/^text\/html/);
  });
});

describe("error envelope", () => {
  it("uses one shape for 400, 401, 403, 404, 409, 410, 429 and unknown routes", async () => {
    await expectError(await api("/api/me"), 401, "unauthenticated");
    await expectError(await api("/api/team", { as: "tenured_employee" }), 403, "forbidden");
    await expectError(await api("/api/nope", { as: "tenured_employee" }), 404, "not_found");
    await expectError(await api("/api/actions", { as: "tenured_employee", body: { tool: "delete_everything", arguments: {} } }), 400, "validation_error");
    await expectError(await api("/api/actions", { as: "tenured_employee", body: {}, origin: "https://evil.example" }), 403, "forbidden");

    const as = spare(4);
    const rejected = await proposeTicket(as, ticketArgs(3));
    await api(`/api/actions/${rejected.actionId}/reject`, { as, body: {} });
    await expectError(await api(`/api/actions/${rejected.actionId}/approve`, { as, body: {} }), 409, "not_pending");

    const expired = await proposeTicket(as, ticketArgs(4));
    await env.DB.prepare("UPDATE pending_actions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1").bind(expired.actionId).run();
    await expectError(await api(`/api/actions/${expired.actionId}/approve`, { as, body: {} }), 410, "expired");

    for (let i = 0; i < 5; i++) await proposeTicket(as, ticketArgs(10 + i));
    await expectError(
      await api("/api/actions", { as, body: { tool: "create_support_ticket", arguments: ticketArgs(20) } }),
      429,
      "rate_limited",
    );
  });
});

describe("route inventory", () => {
  // Every route the Worker registers, each covered by a case above (or, for /mcp, by the mcp.* files).
  const COVERED = [
    "GET /dev/personas",
    "POST /dev/token",
    "GET /dev/login",
    "ALL /mcp",
    "GET /api/health",
    "GET /api/me",
    "GET /api/policies",
    "GET /api/policies/:docId",
    "GET /api/policies/:docId/versions/:version",
    "GET /api/tickets",
    "GET /api/onboarding",
    "GET /api/onboarding/:employeeId",
    "GET /api/orientation-sessions",
    "GET /api/team",
    "POST /api/actions",
    "GET /api/actions",
    "POST /api/actions/:id/approve",
    "POST /api/actions/:id/reject",
    "GET /api/conversations",
    "POST /api/conversations",
    "GET /api/conversations/:id",
    "POST /api/conversations/:id/messages",
    "GET /api/conversations/:id/turns/:turnId/gateway-logs",
  ];

  it("has a contract case for every registered route", () => {
    const registered = new Set(
      buildApp()
        .routes.filter((r) => !r.path.endsWith("*"))
        .map((r) => `${r.method} ${r.path}`),
    );
    expect([...registered].sort()).toEqual([...COVERED].sort());
  });
});
