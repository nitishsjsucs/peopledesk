import type { z } from "zod";
import type { LlmProviderId } from "../../shared/domain.ts";

export type JsonSchema = Record<string, unknown>;

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmMetadata = {
  conversationId: string;
  turnId: string;
  purpose: "router" | "composer";
  evalRunId?: string;
  caseId?: string;
};

export type LlmRequest<T> = {
  purpose: "router" | "composer";
  messages: LlmMessage[];
  schemaName: string;
  jsonSchema: JsonSchema;
  zod: z.ZodType<T>;
  maxTokens: number;
  temperature: number;
  seed?: number;
  metadata: LlmMetadata;
  signal?: AbortSignal;
};

export type LlmUsage = { inputTokens: number; outputTokens: number };

export type LlmResult<T> = {
  value: T;
  rawText: string;
  usage: LlmUsage;
  latencyMs: number;
  /** env.AI.aiGatewayLogId after the call: a hint only (it is per binding, so concurrent calls race). */
  gatewayLogId: string | null;
  retries: number;
};

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly model: string;
  completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

/** The model endpoint failed, timed out or was unreachable. */
export class LlmUnavailableError extends Error {
  readonly code: "provider_unavailable" | "turn_timeout";
  constructor(code: "provider_unavailable" | "turn_timeout", message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmUnavailableError";
    this.code = code;
  }
}

/** The model answered, but not with JSON that satisfies the schema. */
export class LlmInvalidOutputError extends Error {
  readonly rawText: string;
  readonly issues: string;
  readonly usage: LlmUsage;
  constructor(rawText: string, issues: string, usage: LlmUsage) {
    super(`model output failed validation: ${issues}`);
    this.name = "LlmInvalidOutputError";
    this.rawText = rawText;
    this.issues = issues;
    this.usage = usage;
  }
}

/** Parses model text (or an already-parsed object) against the request's zod schema. */
export function parseModelJson<T>(raw: unknown, schema: z.ZodType<T>, usage: LlmUsage): { value: T; rawText: string } {
  const rawText = typeof raw === "string" ? raw : JSON.stringify(raw);
  let data: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new LlmInvalidOutputError(rawText, "not valid JSON", usage);
    }
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new LlmInvalidOutputError(rawText, issues, usage);
  }
  return { value: parsed.data, rawText };
}

/** Rough token estimate for deterministic providers (about 4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Rejects with turn_timeout as soon as `signal` aborts. */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new LlmUnavailableError("turn_timeout", "turn aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new LlmUnavailableError("turn_timeout", "turn aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
