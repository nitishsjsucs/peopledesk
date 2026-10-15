// Workers AI list prices used for labeled cost estimates (Workers AI pricing page, checked 2026-10-08).
// A figure computed here is "this token volume at Workers AI list price", never a cost incurred.
export const PRICING_CHECKED = "2026-10-08";

export const WORKERS_AI_LIST_PRICES: Readonly<Record<string, { inputPerMillion: number; outputPerMillion: number }>> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { inputPerMillion: 0.293, outputPerMillion: 2.253 },
};

export const REFERENCE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export function listPriceUsd(inputTokens: number, outputTokens: number, model = REFERENCE_MODEL): number {
  const p = WORKERS_AI_LIST_PRICES[model];
  if (!p) throw new Error(`no list price for ${model}`);
  return (inputTokens * p.inputPerMillion + outputTokens * p.outputPerMillion) / 1_000_000;
}

/**
 * Workers AI neurons per million tokens (Workers AI pricing page, checked 2026-10-15). The Workers Free
 * plan includes 10,000 neurons a day for the whole account; the eval runner's --max-neurons budget uses
 * these to stop a production run before it spends more than its share.
 */
export const WORKERS_AI_NEURONS: Readonly<Record<string, { inputPerMillion: number; outputPerMillion: number }>> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { inputPerMillion: 26_668, outputPerMillion: 204_805 },
};

export function neurons(inputTokens: number, outputTokens: number, model = REFERENCE_MODEL): number {
  const p = WORKERS_AI_NEURONS[model];
  if (!p) throw new Error(`no neuron rate for ${model}`);
  return (inputTokens * p.inputPerMillion + outputTokens * p.outputPerMillion) / 1_000_000;
}
