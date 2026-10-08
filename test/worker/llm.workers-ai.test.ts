import { describe, expect, it } from "vitest";
import { ComposerOutputSchema, RouterOutputSchema } from "../../src/worker/chat/prompts.ts";
import { BindingGatewayLogReader } from "../../src/worker/llm/gateway-log.ts";
import { LlmInvalidOutputError, LlmUnavailableError } from "../../src/worker/llm/provider.ts";
import type { LlmRequest } from "../../src/worker/llm/provider.ts";
import { WorkersAiProvider } from "../../src/worker/llm/workers-ai.ts";

type Call = { model: string; inputs: Record<string, unknown>; options: Record<string, unknown> };

class FakeAi {
  calls: Call[] = [];
  aiGatewayLogId: string | null = null;
  private readonly responses: Array<unknown | Error>;
  constructor(responses: Array<unknown | Error>) {
    this.responses = responses;
  }
  async run(model: string, inputs: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ model, inputs, options });
    this.aiGatewayLogId = `log-${this.calls.length}`;
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next;
  }
}

const routerReq = (evalRunId?: string): LlmRequest<unknown> => ({
  purpose: "router",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ],
  schemaName: "router",
  jsonSchema: { type: "object" },
  zod: RouterOutputSchema,
  maxTokens: 300,
  temperature: 0,
  seed: 7,
  metadata: { conversationId: "c1", turnId: "t1", purpose: "router", ...(evalRunId ? { evalRunId, caseId: "ans-001" } : {}) },
});

const provider = (ai: FakeAi) => new WorkersAiProvider({ ai, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", gatewayId: "peopledesk" });

describe("WorkersAiProvider", () => {
  it("sends JSON mode with the schema and AI Gateway options with exactly 5 metadata entries", async () => {
    const ai = new FakeAi([{ response: '{"intent":"out_of_scope"}', usage: { prompt_tokens: 120, completion_tokens: 9 } }]);
    const out = await provider(ai).completeJson(routerReq());
    expect(out.value).toEqual({ intent: "out_of_scope" });
    expect(out.usage).toEqual({ inputTokens: 120, outputTokens: 9 });
    const call = ai.calls[0]!;
    expect(call.model).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(call.inputs).toMatchObject({
      response_format: { type: "json_schema", json_schema: { type: "object" } },
      max_tokens: 300,
      temperature: 0,
      seed: 7,
    });
    const gateway = call.options["gateway"] as Record<string, unknown>;
    expect(gateway).toMatchObject({ id: "peopledesk", collectLog: true, requestTimeoutMs: 25_000, skipCache: false });
    expect(gateway["metadata"]).toEqual({ turnId: "t1", purpose: "router", conversationId: "c1", evalRunId: "none", caseId: "none" });
    expect(Object.keys(gateway["metadata"] as object)).toHaveLength(5);
  });

  it("skips the gateway cache only for eval turns", async () => {
    const ai = new FakeAi([{ response: { intent: "out_of_scope" } }]);
    await provider(ai).completeJson(routerReq("run-1"));
    const gateway = ai.calls[0]!.options["gateway"] as Record<string, unknown>;
    expect(gateway["skipCache"]).toBe(true);
    expect(gateway["metadata"]).toMatchObject({ evalRunId: "run-1", caseId: "ans-001" });
  });

  it("captures aiGatewayLogId as a hint and parses an object or a string response", async () => {
    const ai = new FakeAi([{ response: { kind: "refuse", answer: "No.", citations: [] } }, { response: '{"kind":"answer","answer":"Yes.","citations":["P1"]}' }]);
    const p = provider(ai);
    const req = { ...routerReq(), purpose: "composer" as const, zod: ComposerOutputSchema };
    const a = await p.completeJson(req);
    const b = await p.completeJson(req);
    expect(a.value).toMatchObject({ kind: "refuse" });
    expect(b.value).toMatchObject({ kind: "answer", citations: ["P1"] });
    expect(a.gatewayLogId).toBe("log-1");
    expect(b.gatewayLogId).toBe("log-2");
  });

  it("retries once on 'JSON Mode couldn't be met', then gives up with invalid output", async () => {
    const ok = new FakeAi([new Error("AiError: JSON Mode couldn't be met"), { response: { intent: "clarify" } }]);
    const out = await provider(ok).completeJson(routerReq());
    expect(out.retries).toBe(1);
    expect(ok.calls).toHaveLength(2);
    const bad = new FakeAi([new Error("JSON Mode couldn't be met"), new Error("JSON Mode couldn't be met")]);
    await expect(provider(bad).completeJson(routerReq())).rejects.toBeInstanceOf(LlmInvalidOutputError);
    expect(bad.calls).toHaveLength(2);
  });

  it("maps other failures to provider_unavailable", async () => {
    const ai = new FakeAi([new Error("3040: capacity exceeded")]);
    await expect(provider(ai).completeJson(routerReq())).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(provider(new FakeAi([new Error("x")])).completeJson(routerReq())).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});

describe("BindingGatewayLogReader", () => {
  const log = (id: string, turnId: string): AiGatewayLog => ({
    id,
    provider: "workers-ai",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    path: "/",
    duration: 812,
    status_code: 200,
    success: true,
    cached: false,
    tokens_in: 150,
    tokens_out: 40,
    cost: 0.0001,
    metadata: { turnId, purpose: "router" },
    request_size: 1,
    request_head_complete: true,
    response_size: 1,
    response_head_complete: true,
    created_at: new Date(),
  });

  it("reports a log whose metadata.turnId does not match the hint as missing", async () => {
    const logs: Record<string, AiGatewayLog> = { a: log("a", "t1"), b: log("b", "someone-else") };
    const reader = new BindingGatewayLogReader({ getLog: async (id) => logs[id] ?? Promise.reject(new Error("not found")) });
    const out = await reader.readTurn("t1", [
      { logId: "a", purpose: "router" },
      { logId: "b", purpose: "composer" },
      { logId: "c", purpose: "composer" },
    ]);
    expect(out.found).toEqual([{ logId: "a", purpose: "router", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", tokensIn: 150, tokensOut: 40, durationMs: 812, cost: 0.0001, cached: false }]);
    expect(out.missing.map((m) => m.logId)).toEqual(["b", "c"]);
  });
});
