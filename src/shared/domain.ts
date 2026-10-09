// Domain vocabulary shared by the Worker, the SPA, the generator and the evals.
// Isomorphic: no Node, Workers or DOM APIs.

export const APP_VERSION = "1.0.0";

export const ROLES = ["employee", "manager", "hr_admin"] as const;
export type Role = (typeof ROLES)[number];

export const REGIONS = ["US", "IN", "UK"] as const;
export type Region = (typeof REGIONS)[number];

export const SESSION_REGIONS = ["US", "IN", "UK", "GLOBAL"] as const;
export type SessionRegion = (typeof SESSION_REGIONS)[number];

export const AUDIENCES = ["all", "managers", "hr"] as const;
export type Audience = (typeof AUDIENCES)[number];

export type Clearance = 1 | 2 | 3;

export const AUDIENCE_RANK: Readonly<Record<Audience, Clearance>> = { all: 1, managers: 2, hr: 3 };

export const ROLE_CLEARANCE: Readonly<Record<Role, Clearance>> = { employee: 1, manager: 2, hr_admin: 3 };

export const POLICY_CATEGORIES = [
  "time_off",
  "benefits",
  "compensation",
  "travel_expense",
  "remote_work",
  "it_security",
  "conduct",
  "onboarding_learning",
  "health_safety",
  "performance",
] as const;
export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

export const TICKET_CATEGORIES = ["it", "payroll", "benefits", "facilities", "hr_general", "access_request"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_SOURCES = ["seed", "chat", "form", "mcp"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const ONBOARDING_TASK_CATEGORIES = ["paperwork", "it_setup", "training", "meet_people", "orientation"] as const;
export type OnboardingTaskCategory = (typeof ONBOARDING_TASK_CATEGORIES)[number];

export const ONBOARDING_OWNER_ROLES = ["employee", "manager", "hr_admin", "it"] as const;
export type OnboardingOwnerRole = (typeof ONBOARDING_OWNER_ROLES)[number];

export const ONBOARDING_TASK_STATUSES = ["pending", "in_progress", "done", "blocked"] as const;
export type OnboardingTaskStatus = (typeof ONBOARDING_TASK_STATUSES)[number];

export const SESSION_FORMATS = ["virtual", "in_person"] as const;
export type SessionFormat = (typeof SESSION_FORMATS)[number];

export const TOOL_NAMES = [
  "search_policies",
  "create_support_ticket",
  "list_my_tickets",
  "get_onboarding_progress",
  "list_orientation_sessions",
  "schedule_orientation_session",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const WRITE_TOOLS = ["create_support_ticket", "schedule_orientation_session"] as const;
export type WriteToolName = (typeof WRITE_TOOLS)[number];

export const ACTION_STATUSES = ["awaiting_approval", "executing", "executed", "rejected", "expired", "failed"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ACTION_SOURCES = ["chat", "form", "mcp"] as const;
export type ActionSource = (typeof ACTION_SOURCES)[number];

export const TOOL_ERROR_CODES = [
  "forbidden",
  "not_found",
  "validation_error",
  "conflict",
  "rate_limited",
  "not_in_onboarding",
  "session_full",
  "already_booked",
  "session_in_past",
  // Not in the SPEC list: a retriever failure must surface as an error turn, never as a refusal.
  "retrieval_unavailable",
  // Not in the SPEC list: an unexpected exception inside a tool, reported without its message.
  "internal",
] as const;
export type ToolErrorCode = (typeof TOOL_ERROR_CODES)[number];

export const API_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "human_approval_required",
  "not_found",
  "validation_error",
  "conflict",
  "not_pending",
  "expired",
  "rate_limited",
  "turn_in_progress",
  "misconfigured",
  "misconfigured_auth_mode",
  "internal",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const LLM_PROVIDER_IDS = ["workers-ai", "openai-compatible", "stub", "adversarial-stub"] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export const RETRIEVER_KINDS = ["ai-search", "d1-fts"] as const;
export type RetrieverKind = (typeof RETRIEVER_KINDS)[number];

export const AUTH_MODES = ["dev", "access"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const IDENTITY_KINDS = ["user", "service_token"] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

export const PERSONA_KEYS = [
  "new_hire_unbooked",
  "new_hire_booked",
  "tenured_employee",
  "manager_with_new_hires",
  "manager_no_new_hires",
  "hr_admin",
] as const;
export type PersonaKey = (typeof PERSONA_KEYS)[number];

export const TURN_KINDS = ["answer", "clarify", "refuse", "tool_result", "approval_required", "error"] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

export const TURN_ERROR_CODES = ["retrieval_unavailable", "provider_unavailable", "turn_timeout", "internal"] as const;
export type TurnErrorCode = (typeof TURN_ERROR_CODES)[number];

export const VERSION_STATUSES = ["current", "superseded", "scheduled"] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const AUDIT_EVENTS = [
  "tool_call",
  "authz_denied",
  "action_proposed",
  "action_approved",
  "action_rejected",
  "action_executed",
  "action_failed",
  "policy_viewed",
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export const EMPLOYEE_ID_RE = /^E\d{4}$/;
export const DOC_ID_RE = /^POL-\d{3}$/;
export const SESSION_ID_RE = /^ORI-\d{3}$/;
export const TICKET_ID_RE = /^TKT-\d{6}$/;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** R2 key for one policy version, e.g. policies/r1-all/POL-014/v03.md. */
export function policyR2Key(docId: string, audience: Audience, version: number): string {
  return `policies/r${AUDIENCE_RANK[audience]}-${audience}/${docId}/v${String(version).padStart(2, "0")}.md`;
}

/** D1 chunk id, e.g. POL-014@3#2. */
export function chunkId(docId: string, version: number, ordinal: number): string {
  return `${docId}@${version}#${ordinal}`;
}
