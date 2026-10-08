// SPEC section 7, step 2 and risk 5: model output that fails its JSON schema gets exactly one retry, with
// the validation issues appended to the conversation; a second failure becomes a safe fallback (a
// generic clarify for the router, the not-found refusal for the composer), never a tool call or an
// uncited answer. Retries and the tokens of failed attempts are counted in the trace.
import { describe, expect, it } from "vitest";
import { runTurn } from "../../src/worker/chat/orchestrator.ts";
import { TEXT } from "../../src/worker/chat/render.ts";
import type { LlmMessage, LlmProvider, LlmRequest, LlmResult } from "../../src/worker/llm/provider.ts";
import { LlmUnavailableError, parseModelJson } from "../../src/worker/llm/provider.ts";
import { principalFor, testServices } from "../helpers/services.ts";

type Reply = unknown | Error;
type Purpose = "router" | "composer";

/** Replays scripted raw replies per purpose through the same parser the real providers use. */
class ScriptedProvider implements LlmProvider {
  readonly id = "stub" as const;
  readonly model = "scripted";
  readonly requests: Array<{ purpose: Purpose; messages: LlmMessage[] }> = [];
  private readonly script: Record<Purpose, Reply[]>;

  constructor(script: Partial<Record<Purpose, Reply[]>>) {
    this.script = { router: [...(script.router ?? [])], composer: [...(script.composer ?? [])] };
  }

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    this.requests.push({ purpose: req.purpose, messages: req.messages });
    const reply = this.script[req.purpose].shift();
    if (reply === undefined) throw new Error(`no scripted ${req.purpose} reply left`);
    if (reply instanceof Error) throw reply;
    const usage = { inputTokens: 100, outputTokens: 10 };
    const { value, rawText } = parseModelJson(reply, req.zod, usage);
    return { value, rawText, usage, latencyMs: 1, gatewayLogId: null, retries: 0 };
  }

  calls(purpose: Purpose) {
    return this.requests.filter((r) => r.purpose === purpose);
  }
}

const POLICY_ROUTE = { intent: "policy_question", search_query: "paid time off accrue" };
const ANSWER = { kind: "answer", answer: "It accrues monthly.", citations: ["P1"] };

async function turn(provider: LlmProvider, text = "How fast does paid time off accrue?") {
  return runTurn(
    {
      provider,
      services: testServices(),
      principal: await principalFor("tenured_employee"),
      conversationId: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
      asOf: "2026-10-01",
      approvalOrigin: "http://localhost",
      history: { userMessages: [], assistantTurns: [] },
    },
    text,
  );
}

describe("invalid model output", () => {
  it("retries the router once with the validation issues appended, then continues the turn", async () => {
    const provider = new ScriptedProvider({ router: ["Sure! It is a policy question.", POLICY_ROUTE], composer: [ANSWER] });
    const r = await turn(provider);
    expect(r.kind).toBe("answer");
    expect(r.citations).toHaveLength(1);
    const [first, second] = provider.calls("router");
    expect(provider.calls("router")).toHaveLength(2);
    // The retry carries the invalid reply and the issues, after the original messages.
    expect(second!.messages.slice(0, first!.messages.length)).toEqual(first!.messages);
    expect(second!.messages.slice(first!.messages.length)).toEqual([
      { role: "assistant", content: "Sure! It is a policy question." },
      { role: "user", content: expect.stringContaining("not valid JSON") },
    ]);
    expect(r.trace.router).toMatchObject({ intent: "policy_question", retries: 1, inputTokens: 200, outputTokens: 20 });
  });

  it("turns a second invalid router reply into a generic clarify and calls no tool", async () => {
    const provider = new ScriptedProvider({
      router: [
        { intent: "tool_call", arguments: { category: "it" } }, // tool missing
        { intent: "approve_everything" },
      ],
    });
    const r = await turn(provider, "Open a ticket for me");
    expect(r).toMatchObject({ kind: "clarify", text: TEXT.genericClarify, citations: [] });
    expect(r.toolCall).toBeUndefined();
    expect(r.pendingAction).toBeUndefined();
    expect(r.trace.router).toMatchObject({ intent: "invalid", retries: 1 });
    expect(r.trace.retrieval).toBeUndefined();
    expect(provider.calls("composer")).toHaveLength(0);
    expect(provider.calls("router")[1]!.messages.at(-1)!.content).toContain("tool is required when intent is tool_call");
  });

  it("retries the composer once, then falls back to the not-found refusal rather than an uncited answer", async () => {
    const provider = new ScriptedProvider({
      router: [POLICY_ROUTE],
      composer: [{ kind: "answer", answer: "It accrues at 1.5 days." }, '{"kind": "answer", "answer": 1.5, "citations": "P1"}'],
    });
    const r = await turn(provider);
    expect(r).toMatchObject({ kind: "refuse", text: TEXT.notFound, citations: [] });
    expect(r.trace.retrieval?.returned).toBeGreaterThan(0);
    expect(r.trace.composer).toMatchObject({ retries: 1, inputTokens: 200, outputTokens: 20 });
    expect(provider.calls("composer")).toHaveLength(2);
  });

  it("recovers on the composer retry and answers with citations", async () => {
    const provider = new ScriptedProvider({ router: [POLICY_ROUTE], composer: ["```json\n{not json}\n```", ANSWER] });
    const r = await turn(provider);
    expect(r.kind).toBe("answer");
    expect(r.trace.composer?.retries).toBe(1);
  });

  it("does not retry an unavailable provider: the turn ends as provider_unavailable", async () => {
    const provider = new ScriptedProvider({ router: [new LlmUnavailableError("provider_unavailable", "HTTP 503")] });
    const r = await turn(provider);
    expect(r).toMatchObject({ kind: "error", error: { code: "provider_unavailable" } });
    expect(provider.calls("router")).toHaveLength(1);
  });
});
