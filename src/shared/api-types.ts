// zod schemas for every HTTP request and response. Shared by the Worker (validation) and the SPA
// (parsing responses), so both sides agree on one contract.
import { z } from "zod";
import {
  API_ERROR_CODES,
  AUTH_MODES,
  IDENTITY_KINDS,
  LLM_PROVIDER_IDS,
  PERSONA_KEYS,
  REGIONS,
  RETRIEVER_KINDS,
  ROLES,
} from "./domain.ts";

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

export const MeSchema = z.object({
  employeeId: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(ROLES),
  region: z.enum(REGIONS),
  department: z.string(),
  jobTitle: z.string(),
  managerId: z.string().nullable(),
  startDate: z.string(),
  inOnboarding: z.boolean(),
  directReportIds: z.array(z.string()),
  identityKind: z.enum(IDENTITY_KINDS),
});
export type Me = z.infer<typeof MeSchema>;

export const PersonasSchema = z.object({
  personas: z.array(
    z.object({ key: z.enum(PERSONA_KEYS), employeeId: z.string(), email: z.string(), role: z.enum(ROLES), description: z.string() }),
  ),
});

export const DevTokenSchema = z.object({ token: z.string(), expiresAt: z.string() });
