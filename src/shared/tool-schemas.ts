// zod input and output schemas for the six MCP tools. Input schemas are z.strictObject, so tools/list
// advertises additionalProperties: false and unknown keys are rejected. The SPA's forms import the
// same input schemas, so client-side and server-side validation cannot drift.
import { z } from "zod";
import {
  ACTION_STATUSES,
  POLICY_CATEGORIES,
  SESSION_FORMATS,
  SESSION_REGIONS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TOOL_ERROR_CODES,
} from "./domain.ts";
import { OnboardingProgressSchema, SessionSchema } from "./api-types.ts";

const isoDate = z.iso.date();

// 1. search_policies
export const SearchPoliciesInput = z.strictObject({
  query: z.string().trim().min(3).max(500),
  category: z.enum(POLICY_CATEGORIES).optional(),
  topK: z.number().int().min(1).max(8).default(6),
});
export const PassageSchema = z.object({
  passageId: z.string(),
  docId: z.string(),
  version: z.number().int(),
  title: z.string(),
  section: z.string(),
  text: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  sourceKey: z.string(),
  score: z.number(),
});
export type Passage = z.infer<typeof PassageSchema>;
export const SearchPoliciesOutput = z.object({ passages: z.array(PassageSchema), asOf: z.string() });

// 2. create_support_ticket (write: proposes, never writes)
export const CreateSupportTicketInput = z.strictObject({
  category: z.enum(TICKET_CATEGORIES),
  subject: z.string().trim().min(5).max(120),
  description: z.string().trim().min(10).max(2000),
  priority: z.enum(TICKET_PRIORITIES).default("normal"),
  relatedPolicyId: z.string().regex(/^POL-\d{3}$/).optional(),
});
export type CreateSupportTicketArgs = z.infer<typeof CreateSupportTicketInput>;

export const ActionPreviewSchema = z.object({
  title: z.string(),
  fields: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type ActionPreview = z.infer<typeof ActionPreviewSchema>;

export const ApprovalRequiredOutput = z.object({
  status: z.literal("approval_required"),
  actionId: z.string(),
  expiresAt: z.string(),
  preview: ActionPreviewSchema,
  approvalUrl: z.string(),
});
export type ApprovalRequired = z.infer<typeof ApprovalRequiredOutput>;

// 3. list_my_tickets
export const ListMyTicketsInput = z.strictObject({
  status: z.enum(TICKET_STATUSES).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const ListMyTicketsOutput = z.object({
  tickets: z.array(
    z.object({
      id: z.string(),
      category: z.enum(TICKET_CATEGORIES),
      subject: z.string(),
      priority: z.enum(TICKET_PRIORITIES),
      status: z.enum(TICKET_STATUSES),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

// 4. get_onboarding_progress
export const GetOnboardingProgressInput = z.strictObject({ employeeId: z.string().regex(/^E\d{4}$/).optional() });
export const GetOnboardingProgressOutput = OnboardingProgressSchema;

// 5. list_orientation_sessions
export const ListOrientationSessionsInput = z.strictObject({
  fromDate: isoDate.optional(),
  toDate: isoDate.optional(),
  format: z.enum(SESSION_FORMATS).optional(),
  region: z.enum(SESSION_REGIONS).optional(),
});
export const ListOrientationSessionsOutput = z.object({ sessions: z.array(SessionSchema) });

// 6. schedule_orientation_session (write: proposes, never writes)
export const ScheduleOrientationSessionInput = z.strictObject({
  sessionId: z.string().regex(/^ORI-\d{3}$/),
  employeeId: z.string().regex(/^E\d{4}$/).optional(),
});
export type ScheduleOrientationSessionArgs = z.infer<typeof ScheduleOrientationSessionInput>;

export const WRITE_TOOL_INPUTS = {
  create_support_ticket: CreateSupportTicketInput,
  schedule_orientation_session: ScheduleOrientationSessionInput,
} as const;

export const ToolErrorSchema = z.object({ error: z.object({ code: z.enum(TOOL_ERROR_CODES), message: z.string() }) });

export const PendingActionStatusSchema = z.enum(ACTION_STATUSES);
