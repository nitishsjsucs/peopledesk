// zod schemas for every HTTP request and response. Shared by the Worker (validation) and the SPA
// (parsing responses), so both sides agree on one contract.
import { z } from "zod";
import {
  ACTION_SOURCES,
  ACTION_STATUSES,
  API_ERROR_CODES,
  AUDIENCES,
  AUTH_MODES,
  ONBOARDING_OWNER_ROLES,
  ONBOARDING_TASK_CATEGORIES,
  ONBOARDING_TASK_STATUSES,
  SESSION_FORMATS,
  SESSION_REGIONS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  TOOL_ERROR_CODES,
  TOOL_NAMES,
  TURN_ERROR_CODES,
  TURN_KINDS,
  IDENTITY_KINDS,
  LLM_PROVIDER_IDS,
  PERSONA_KEYS,
  POLICY_CATEGORIES,
  REGIONS,
  RETRIEVER_KINDS,
  ROLES,
  VERSION_STATUSES,
  WRITE_TOOLS,
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

// Policies

export const PolicyListItemSchema = z.object({
  docId: z.string(),
  title: z.string(),
  category: z.enum(POLICY_CATEGORIES),
  audience: z.enum(AUDIENCES),
  currentVersion: z.number().int(),
  effectiveFrom: z.string(),
  updatedAt: z.string(),
});
export type PolicyListItem = z.infer<typeof PolicyListItemSchema>;
export const PolicyListSchema = z.object({ documents: z.array(PolicyListItemSchema) });

export const VersionSummarySchema = z.object({
  version: z.number().int(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  status: z.enum(VERSION_STATUSES),
  changeSummary: z.string(),
});
export type VersionSummary = z.infer<typeof VersionSummarySchema>;

export const PolicyDocumentSchema = z.object({
  docId: z.string(),
  title: z.string(),
  category: z.enum(POLICY_CATEGORIES),
  audience: z.enum(AUDIENCES),
  versions: z.array(VersionSummarySchema),
});
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export const VersionMetaSchema = VersionSummarySchema.extend({
  docId: z.string(),
  title: z.string(),
  category: z.enum(POLICY_CATEGORIES),
  audience: z.enum(AUDIENCES),
});
export type VersionMeta = z.infer<typeof VersionMetaSchema>;

export const PolicyVersionSchema = z.object({ meta: VersionMetaSchema, markdown: z.string(), r2Key: z.string() });
export type PolicyVersionView = z.infer<typeof PolicyVersionSchema>;

export const PolicyListQuerySchema = z.object({
  category: z.enum(POLICY_CATEGORIES).optional(),
  q: z.string().max(100).optional(),
});

// Tickets

export const TicketSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string(),
  description: z.string(),
  priority: z.enum(TICKET_PRIORITIES),
  status: z.enum(TICKET_STATUSES),
  relatedPolicyId: z.string().nullable(),
  createdVia: z.enum(TICKET_SOURCES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ticket = z.infer<typeof TicketSchema>;
export const TicketListSchema = z.object({ tickets: z.array(TicketSchema) });
export const TicketListQuerySchema = z.object({ status: z.enum(TICKET_STATUSES).optional() });

// Onboarding

export const OnboardingTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(ONBOARDING_TASK_CATEGORIES),
  ownerRole: z.enum(ONBOARDING_OWNER_ROLES),
  dueDate: z.string(),
  status: z.enum(ONBOARDING_TASK_STATUSES),
});
export const OnboardingProgressSchema = z.object({
  employeeId: z.string(),
  fullName: z.string(),
  startDate: z.string(),
  targetCompletionDate: z.string(),
  percentComplete: z.number().int().min(0).max(100),
  counts: z.object({ done: z.number().int(), inProgress: z.number().int(), pending: z.number().int(), blocked: z.number().int() }),
  tasks: z.array(OnboardingTaskSchema),
});
export type OnboardingProgress = z.infer<typeof OnboardingProgressSchema>;

// Team (the same directory slice the chat router sees)

export const TeamSchema = z.object({
  members: z.array(z.object({ employeeId: z.string(), fullName: z.string(), inOnboarding: z.boolean(), booked: z.boolean() })),
});
export type Team = z.infer<typeof TeamSchema>;

// Orientation sessions

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  startsAt: z.string(),
  durationMin: z.number().int(),
  format: z.enum(SESSION_FORMATS),
  region: z.enum(SESSION_REGIONS),
  location: z.string(),
  capacity: z.number().int(),
  seatsRemaining: z.number().int(),
});
export type Session = z.infer<typeof SessionSchema>;
export const SessionListSchema = z.object({ sessions: z.array(SessionSchema) });
export const SessionListQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  format: z.enum(SESSION_FORMATS).optional(),
  region: z.enum(SESSION_REGIONS).optional(),
});

// Pending actions (approval checkpoints)

export const PendingActionViewSchema = z.object({
  actionId: z.string(),
  tool: z.enum(WRITE_TOOLS),
  status: z.enum(ACTION_STATUSES),
  preview: z.object({ title: z.string(), fields: z.array(z.object({ label: z.string(), value: z.string() })) }),
  arguments: z.unknown(),
  createdAt: z.string(),
  expiresAt: z.string(),
  source: z.enum(ACTION_SOURCES),
  conversationId: z.string().nullable(),
  result: z.unknown().optional(),
  errorCode: z.string().optional(),
  supersededBy: z.string().optional(),
});
export type PendingActionView = z.infer<typeof PendingActionViewSchema>;
export const ActionListSchema = z.object({ actions: z.array(PendingActionViewSchema) });
export const ActionListQuerySchema = z.object({ status: z.enum(ACTION_STATUSES).optional() });

export const ProposeActionRequestSchema = z.strictObject({
  tool: z.enum(WRITE_TOOLS),
  arguments: z.unknown(),
  supersedes: z.uuid().optional(),
});

export const ApproveRequestSchema = z.strictObject({});
export const ApproveResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("executed"), result: z.record(z.string(), z.unknown()), replayed: z.boolean() }),
  z.object({ status: z.literal("failed"), errorCode: z.string(), replayed: z.boolean() }),
]);
export type ApproveResponse = z.infer<typeof ApproveResponseSchema>;

export const RejectRequestSchema = z.strictObject({ reason: z.string().max(200).optional() });
export const RejectResponseSchema = z.object({ status: z.literal("rejected") });

// Chat

export const CitationSchema = z.object({
  passageId: z.string(),
  docId: z.string(),
  version: z.number().int(),
  title: z.string(),
  section: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  sourceKey: z.string(),
  quote: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const TurnTraceSchema = z.object({
  asOf: z.string(),
  llmProvider: z.string(),
  model: z.string(),
  totalMs: z.number(),
  router: z.object({
    intent: z.string(),
    tool: z.string().optional(),
    ms: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    retries: z.number(),
  }),
  retrieval: z
    .object({
      query: z.string(),
      returned: z.number(),
      droppedNotEffective: z.number(),
      passageIds: z.array(z.string()),
      aiSearchChunkIds: z.array(z.string()).optional(),
      ms: z.number(),
      retriever: z.enum(RETRIEVER_KINDS),
    })
    .optional(),
  tool: z.object({ name: z.string(), ms: z.number() }).optional(),
  composer: z
    .object({
      ms: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      invalidCitationsDropped: z.number(),
      retries: z.number(),
    })
    .optional(),
  /** "<purpose>:<env.AI.aiGatewayLogId>" after each call: hints only; logs are joined by metadata. */
  gatewayLogIdHints: z.array(z.string()),
});
export type TurnTrace = z.infer<typeof TurnTraceSchema>;

export const TurnResultSchema = z.object({
  turnId: z.string(),
  conversationId: z.string(),
  kind: z.enum(TURN_KINDS),
  text: z.string(),
  citations: z.array(CitationSchema),
  toolCall: z
    .object({
      tool: z.enum(TOOL_NAMES),
      arguments: z.unknown(),
      status: z.enum(["ok", "error"]),
      error: z.object({ code: z.enum(TOOL_ERROR_CODES), message: z.string() }).optional(),
    })
    .optional(),
  toolResult: z.unknown().optional(),
  pendingAction: PendingActionViewSchema.optional(),
  error: z.object({ code: z.enum(TURN_ERROR_CODES), message: z.string() }).optional(),
  trace: TurnTraceSchema,
});
export type TurnResult = z.infer<typeof TurnResultSchema>;

export const TranscriptMessageSchema = z.object({
  id: z.number().int(),
  turnId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  kind: z.string(),
  text: z.string(),
  payload: z.unknown().optional(),
  createdAt: z.string(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessageSchema>;

export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const ConversationListSchema = z.object({ conversations: z.array(ConversationSummarySchema) });
export const ConversationCreatedSchema = z.object({ id: z.string() });
export const ConversationSchema = z.object({ id: z.string(), title: z.string(), messages: z.array(TranscriptMessageSchema) });
export const SendMessageRequestSchema = z.strictObject({ text: z.string().trim().min(1).max(2000) });
export const CreateConversationRequestSchema = z.strictObject({});

export const GatewayLogsSchema = z.object({
  logs: z.array(
    z.object({
      logId: z.string(),
      purpose: z.string(),
      model: z.string(),
      tokensIn: z.number().optional(),
      tokensOut: z.number().optional(),
      durationMs: z.number(),
      cost: z.number().optional(),
      cached: z.boolean(),
    }),
  ),
  missing: z.array(z.object({ logId: z.string(), reason: z.string() })),
});
