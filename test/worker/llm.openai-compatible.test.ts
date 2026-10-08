import { describe, expect, it } from "vitest";
import { RouterOutputSchema } from "../../src/worker/chat/prompts.ts";
import { OpenAiCompatibleProvider } from "../../src/worker/llm/openai-compatible.ts";
import type { FetchLike } from "../../src/worker/llm/openai-compatible.ts";
import type { LlmRequest } from "../../src/worker/llm/provider.ts";

const req = (signal?: AbortSignal): LlmRequest<unknown> => ({
  purpose: "router",
  messages: [{ role: "user", content: "hello" }],
  schemaName: "router_output",
  jsonSchema: { type: "object", properties: { intent: { type: "string" } } },
  zod: RouterOutputSchema,
  maxTokens: 256,
  temperature: 0,
  seed: 42,
  metadata: { conversationId: "c", turnId: "t", purpose: "router" },
  ...(signal ? { signal } : {}),
});

describe("OpenAiCompatibleProvider", () => {
  it("posts the json_schema wrapper with name and strict, thinking disabled, seed and temperature", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json({
        choices: [{ message: { content: '{"intent":"policy_question","search_query":"pto"}' } }],
        usage: { prompt_tokens: 149, completion_tokens: 44 },
      });
    };
    const p = new OpenAiCompatibleProvider({ baseUrl: "http://127.0.0.1:8120/v1/", model: "qwen3-1.7b-q4_0", fetch: fetchImpl });
    const out = await p.completeJson(req());
    expect(seen[0]?.url).toBe("http://127.0.0.1:8120/v1/chat/completions");
    expect(seen[0]?.body).toMatchObject({
      model: "qwen3-1.7b-q4_0",
      temperature: 0,
      seed: 42,
      max_tokens: 256,
      response_format: { type: "json_schema", json_schema: { name: "router_output", strict: true, schema: req().jsonSchema } },
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(out.value).toEqual({ intent: "policy_question", search_query: "pto" });
    expect(out.usage).toEqual({ inputTokens: 149, outputTokens: 44 });
    expect(out.gatewayLogId).toBeNull();
  });

  it("maps non-200 responses to provider_unavailable", async () => {
    const p = new OpenAiCompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: async () => new Response("down", { status: 503 }) });
    await expect(p.completeJson(req())).rejects.toMatchObject({ name: "LlmUnavailableError", code: "provider_unavailable" });
  });

  it("aborts on its own timeout and maps it to provider_unavailable", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const p = new OpenAiCompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: hang, timeoutMs: 20 });
    await expect(p.completeJson(req())).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("maps the turn's own abort to turn_timeout", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const p = new OpenAiCompatibleProvider({ baseUrl: "http://x/v1", model: "m", fetch: hang });
    const controller = new AbortController();
    const pending = p.completeJson(req(controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "turn_timeout" });
  });

  it("rejects output that does not satisfy the schema", async () => {
    const p = new OpenAiCompatibleProvider({
      baseUrl: "http://x/v1",
      model: "m",
      fetch: async () => Response.json({ choices: [{ message: { content: '{"intent":"tool_call"}' } }] }),
    });
    await expect(p.completeJson(req())).rejects.toMatchObject({ name: "LlmInvalidOutputError" });
  });
});
