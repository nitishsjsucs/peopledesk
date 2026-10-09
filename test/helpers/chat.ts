import { env, runInDurableObject } from "cloudflare:test";
import { getAgentByName } from "agents";
import { ConversationCreatedSchema, TurnResultSchema } from "../../src/shared/api-types.ts";
import type { TurnResult } from "../../src/shared/api-types.ts";
import type { ConversationAgent } from "../../src/worker/chat/agent.ts";
import type { LlmMetadata, LlmProvider, LlmRequest } from "../../src/worker/llm/provider.ts";
import { StubProvider } from "../../src/worker/llm/stub.ts";
import { api, expectJson } from "./http.ts";

export async function newConversation(as: string, baseUrl?: string): Promise<string> {
  return (await expectJson(await api("/api/conversations", { as, body: {}, ...(baseUrl ? { baseUrl } : {}) }), ConversationCreatedSchema, 201)).id;
}

export async function send(
  as: string,
  conversationId: string,
  text: string,
  headers?: Record<string, string>,
  baseUrl?: string,
): Promise<TurnResult> {
  return expectJson(
    await api(`/api/conversations/${conversationId}/messages`, {
      as,
      body: { text },
      ...(headers ? { headers } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    }),
    TurnResultSchema,
  );
}

/** One fresh conversation per question, like the eval runner. */
export async function ask(as: string, text: string): Promise<TurnResult> {
  return send(as, await newConversation(as), text);
}

/**
 * Installs, through the agent's test-only providerOverride, a stub provider that records each LLM
 * call's gateway metadata. Returns the recorded list and a function that removes the override.
 */
export async function recordLlmMetadata(
  employeeId: string,
  conversationId: string,
): Promise<{ seen: LlmMetadata[]; restore: () => Promise<void> }> {
  const seen: LlmMetadata[] = [];
  const inner = new StubProvider();
  const recorder: LlmProvider = {
    id: inner.id,
    model: inner.model,
    completeJson: <T>(req: LlmRequest<T>) => {
      seen.push({ ...req.metadata });
      return inner.completeJson(req);
    },
  };
  const agent = await getAgentByName(env.CONVERSATION_AGENT, `${employeeId}:${conversationId}`);
  await runInDurableObject(agent, (a: ConversationAgent) => {
    a.providerOverride = recorder;
  });
  return {
    seen,
    restore: () =>
      runInDurableObject(agent, (a: ConversationAgent) => {
        a.providerOverride = undefined;
      }),
  };
}
