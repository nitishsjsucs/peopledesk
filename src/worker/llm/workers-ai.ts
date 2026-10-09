// Production provider: Workers AI through AI Gateway, JSON mode with a JSON schema.
// Gateway metadata is exactly 5 entries (AI Gateway's documented maximum): turnId, purpose,
// conversationId, evalRunId, caseId, with "none" for absent eval fields so the shape never changes.
// Logs are joined by (turnId, purpose) metadata; env.AI.aiGatewayLogId is kept only as a hint.
import type { LlmProvider, LlmRequest, LlmResult } from "./provider.ts";
import { LlmInvalidOutputError, LlmUnavailableError, parseModelJson, raceAbort } from "./provider.ts";

export const WORKERS_AI_TIMEOUT_MS = 25_000;
const JSON_MODE_FAILURE = /JSON Mode couldn't be met/i;

/** The slice of the AI binding this provider uses (a fake in tests). */
export type AiBindingLike = {
  run(model: string, inputs: Record<string, unknown>, options: Record<string, unknown>): Promise<unknown>;
  aiGatewayLogId: string | null;
};

type RunOutput = { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };

export class WorkersAiProvider implements LlmProvider {
  readonly id = "workers-ai" as const;
  readonly model: string;
  private readonly ai: AiBindingLike;
  private readonly gatewayId: string;

  constructor(opts: { ai: AiBindingLike; model: string; gatewayId: string }) {
    this.ai = opts.ai;
    this.model = opts.model;
    this.gatewayId = opts.gatewayId;
  }

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const isEval = !!req.metadata.evalRunId;
    const inputs = {
      messages: req.messages,
      response_format: { type: "json_schema", json_schema: req.jsonSchema },
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      ...(req.seed === undefined ? {} : { seed: req.seed }),
    };
    const options = {
      gateway: {
        id: this.gatewayId,
        collectLog: true,
        requestTimeoutMs: WORKERS_AI_TIMEOUT_MS,
        // Eval calls skip the gateway cache so cached responses cannot flatter latency or cost.
        skipCache: isEval,
        metadata: {
          turnId: req.metadata.turnId,
          purpose: req.purpose,
          conversationId: req.metadata.conversationId,
          evalRunId: req.metadata.evalRunId ?? "none",
          caseId: req.metadata.caseId ?? "none",
        },
      },
      ...(req.signal ? { signal: req.signal } : {}),
    };

    let out: RunOutput;
    try {
      out = (await raceAbort(this.ai.run(this.model, inputs, options), req.signal)) as RunOutput;
    } catch (err) {
      if (err instanceof LlmUnavailableError) throw err;
      // "JSON Mode couldn't be met" is invalid output, not an outage. The orchestrator gives it the
      // turn's single retry and counts that retry in the trace, so there is no second retry layer here.
      if (JSON_MODE_FAILURE.test(String((err as Error)?.message ?? err))) {
        throw new LlmInvalidOutputError("", "JSON Mode couldn't be met", { inputTokens: 0, outputTokens: 0 });
      }
      throw new LlmUnavailableError("provider_unavailable", `Workers AI call failed: ${String(err)}`, { cause: err });
    }
    const usage = { inputTokens: out.usage?.prompt_tokens ?? 0, outputTokens: out.usage?.completion_tokens ?? 0 };
    // In JSON mode `response` may already be an object.
    const { value, rawText } = parseModelJson(out.response, req.zod, usage);
    return { value, rawText, usage, latencyMs: Date.now() - started, gatewayLogId: this.ai.aiGatewayLogId ?? null, retries: 0 };
  }
}
