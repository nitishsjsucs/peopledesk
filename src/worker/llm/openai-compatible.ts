// Any /v1/chat/completions endpoint with JSON-schema structured output: llama-server locally (Qwen3-1.7B
// Q4_0 for evals), or a hosted OpenAI-compatible API. fetch is injected so tests can pass a fake (the
// Workers test pool exports no fetch mock).
import type { LlmProvider, LlmRequest, LlmResult } from "./provider.ts";
import { LlmInvalidOutputError, LlmUnavailableError, parseModelJson } from "./provider.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const OPENAI_COMPATIBLE_TIMEOUT_MS = 25_000;

type ChatCompletion = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = "openai-compatible" as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; model: string; fetch?: FetchLike; timeoutMs?: number }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? OPENAI_COMPATIBLE_TIMEOUT_MS;
  }

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    const body = {
      model: this.model,
      messages: req.messages,
      temperature: req.temperature,
      ...(req.seed === undefined ? {} : { seed: req.seed }),
      max_tokens: req.maxTokens,
      response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: true } },
      chat_template_kwargs: { enable_thinking: false },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (req.signal?.aborted) throw new LlmUnavailableError("turn_timeout", "turn aborted", { cause: err });
      throw new LlmUnavailableError("provider_unavailable", `LLM request failed: ${String(err)}`, { cause: err });
    }
    if (!res.ok) {
      throw new LlmUnavailableError("provider_unavailable", `LLM endpoint answered ${res.status}`);
    }
    let data: ChatCompletion;
    try {
      data = (await res.json()) as ChatCompletion;
    } catch (err) {
      throw new LlmUnavailableError("provider_unavailable", "LLM endpoint returned non-JSON", { cause: err });
    }
    const usage = { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LlmInvalidOutputError(JSON.stringify(data).slice(0, 500), "no message content", usage);
    const { value, rawText } = parseModelJson(content, req.zod, usage);
    return { value, rawText, usage, latencyMs: Date.now() - started, gatewayLogId: null, retries: 0 };
  }
}
