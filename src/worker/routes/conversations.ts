// Conversations: D1 holds ownership and titles; the ConversationAgent holds the transcript. The agent
// name is built from the verified principal and a conversation id that must already exist in D1 with
// the same owner, so a request can never address someone else's agent.
import { getAgentByName } from "agents";
import { Hono } from "hono";
import type { Context } from "hono";
import { CreateConversationRequestSchema, SendMessageRequestSchema } from "../../shared/api-types.ts";
import type { TurnResult } from "../../shared/api-types.ts";
import { UUID_RE } from "../../shared/domain.ts";
import { AppError } from "../errors.ts";
import type { AppEnv } from "../hono-env.ts";
import { BindingGatewayLogReader } from "../llm/gateway-log.ts";
import { validate } from "../validation.ts";

const EVAL_HEADER = "X-PeopleDesk-Eval";
const EVAL_HEADER_RE = /^([\w.-]{1,64}):([\w.-]{1,64})$/;

const notFound = () => new AppError(404, "not_found", "Conversation not found.");

async function ownedConversation(c: Context<AppEnv>): Promise<{ id: string; title: string }> {
  const id = c.req.param("id") ?? "";
  if (!UUID_RE.test(id)) throw notFound();
  const row = await c.env.DB.prepare("SELECT id, title FROM conversations WHERE id = ?1 AND employee_id = ?2")
    .bind(id, c.get("principal").employeeId)
    .first<{ id: string; title: string }>();
  if (!row) throw notFound();
  return row;
}

export function agentFor(env: Env, employeeId: string, conversationId: string) {
  return getAgentByName(env.CONVERSATION_AGENT, `${employeeId}:${conversationId}`);
}

export const conversationRoutes = new Hono<AppEnv>()
  .get("/conversations", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE employee_id = ?1 ORDER BY updated_at DESC LIMIT 100",
    )
      .bind(c.get("principal").employeeId)
      .all<{ id: string; title: string; created_at: string; updated_at: string }>();
    return c.json({
      conversations: results.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at })),
    });
  })
  .post("/conversations", validate("json", CreateConversationRequestSchema), async (c) => {
    const id = crypto.randomUUID();
    const now = c.get("clock").nowIso();
    await c.env.DB.prepare("INSERT INTO conversations (id, employee_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)")
      .bind(id, c.get("principal").employeeId, "New conversation", now)
      .run();
    return c.json({ id }, 201);
  })
  .get("/conversations/:id", async (c) => {
    const conv = await ownedConversation(c);
    const principal = c.get("principal");
    const agent = await agentFor(c.env, principal.employeeId, conv.id);
    return c.json({ id: conv.id, title: conv.title, messages: await agent.getTranscript({ principal }) });
  })
  .post("/conversations/:id/messages", validate("json", SendMessageRequestSchema), async (c) => {
    const conv = await ownedConversation(c);
    const principal = c.get("principal");
    const { text } = c.req.valid("json");
    // The eval header only labels gateway metadata (evalRunId, caseId) and turns off the gateway
    // cache. It cannot change the provider, the retriever or the auth mode.
    const evalTag = EVAL_HEADER_RE.exec(c.req.header(EVAL_HEADER) ?? "");
    const agent = await agentFor(c.env, principal.employeeId, conv.id);
    const outcome = await agent.sendMessage({
      principal,
      text,
      asOf: c.get("clock").asOf(),
      requestOrigin: new URL(c.req.url).origin,
      ...(evalTag ? { evalRunId: evalTag[1], caseId: evalTag[2] } : {}),
    });
    if (!("result" in outcome)) {
      throw new AppError(409, "turn_in_progress", "A reply is still being prepared in this conversation.");
    }
    const result = outcome.result as TurnResult;
    const now = c.get("clock").nowIso();
    const title = conv.title === "New conversation" ? text.trim().slice(0, 60) : conv.title;
    await c.env.DB.prepare("UPDATE conversations SET title = ?2, updated_at = ?3 WHERE id = ?1").bind(conv.id, title, now).run();
    return c.json(result);
  })
  .get("/conversations/:id/turns/:turnId/gateway-logs", async (c) => {
    const s = c.get("services");
    if (s.config.llm.provider !== "workers-ai" || !c.env.AI) throw new AppError(404, "not_found", "Gateway logs exist only for Workers AI.");
    const conv = await ownedConversation(c);
    const principal = c.get("principal");
    const agent = await agentFor(c.env, principal.employeeId, conv.id);
    const turnId = c.req.param("turnId");
    const trace = await agent.getTurnTrace({ principal, turnId });
    if (!trace) throw new AppError(404, "not_found", "Turn not found.");
    const hints = trace.gatewayLogIdHints.map((h) => {
      const i = h.indexOf(":");
      return { purpose: h.slice(0, i), logId: h.slice(i + 1) };
    });
    const reader = new BindingGatewayLogReader(c.env.AI.gateway(s.config.llm.gatewayId));
    const { found, missing } = await reader.readTurn(turnId, hints);
    return c.json({ logs: found, missing });
  });
