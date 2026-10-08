import { ConversationCreatedSchema, TurnResultSchema } from "../../src/shared/api-types.ts";
import type { TurnResult } from "../../src/shared/api-types.ts";
import { api, expectJson } from "./http.ts";

export async function newConversation(as: string): Promise<string> {
  return (await expectJson(await api("/api/conversations", { as, body: {} }), ConversationCreatedSchema, 201)).id;
}

export async function send(as: string, conversationId: string, text: string, headers?: Record<string, string>): Promise<TurnResult> {
  return expectJson(
    await api(`/api/conversations/${conversationId}/messages`, { as, body: { text }, ...(headers ? { headers } : {}) }),
    TurnResultSchema,
  );
}

/** One fresh conversation per question, like the eval runner. */
export async function ask(as: string, text: string): Promise<TurnResult> {
  return send(as, await newConversation(as), text);
}
