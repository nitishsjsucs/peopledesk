// zod schemas for every HTTP request and response. Shared by the Worker (validation) and the SPA
// (parsing responses), so both sides agree on one contract.
import { z } from "zod";
import { API_ERROR_CODES, AUTH_MODES, LLM_PROVIDER_IDS, RETRIEVER_KINDS } from "./domain.ts";

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthSchema = z.object({
  ok: z.literal(true),
  authMode: z.enum(AUTH_MODES),
  llmProvider: z.enum(LLM_PROVIDER_IDS),
  model: z.string(),
  retriever: z.enum(RETRIEVER_KINDS),
  asOf: z.string(),
  version: z.string(),
  datasetSha256: z.string().nullable(),
});
export type Health = z.infer<typeof HealthSchema>;
