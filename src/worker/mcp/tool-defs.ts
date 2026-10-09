// Tool metadata and JSON Schemas, computed once per isolate (CPU budget, SPEC section 10). The MCP SDK
// converts a tool's Standard Schema to JSON Schema for tools/list and pre-dispatch validation; with a
// per-request server factory that conversion would repeat on every request. Each schema is therefore
// wrapped so its JSON Schema conversion is memoized at module scope, and the per-request factory only
// binds the principal and services to these precomputed definitions.
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";
import type { ToolName } from "../../shared/domain.ts";
import {
  ApprovalRequiredOutput,
  CreateSupportTicketInput,
  GetOnboardingProgressInput,
  GetOnboardingProgressOutput,
  ListMyTicketsInput,
  ListMyTicketsOutput,
  ListOrientationSessionsInput,
  ListOrientationSessionsOutput,
  ScheduleOrientationSessionInput,
  SearchPoliciesInput,
  SearchPoliciesOutput,
} from "../../shared/tool-schemas.ts";

type Cached<T extends z.ZodType> = StandardSchemaWithJSON<z.input<T>, z.output<T>>;
type JsonSchemaOptions = Parameters<Cached<z.ZodType>["~standard"]["jsonSchema"]["input"]>[0];

/** Wraps a zod schema so its JSON Schema conversion runs once per isolate and target. */
export function cachedSchema<T extends z.ZodType>(schema: T): Cached<T> {
  const std = schema["~standard"] as unknown as Cached<T>["~standard"];
  const memo = new Map<string, Record<string, unknown>>();
  const once = (key: string, make: () => Record<string, unknown>) => {
    let v = memo.get(key);
    if (!v) {
      v = make();
      memo.set(key, v);
    }
    return v;
  };
  return {
    "~standard": {
      version: 1,
      vendor: std.vendor,
      validate: std.validate,
      jsonSchema: {
        input: (opts: JsonSchemaOptions) => once(`in:${opts.target}`, () => std.jsonSchema.input(opts)),
        output: (opts: JsonSchemaOptions) => once(`out:${opts.target}`, () => std.jsonSchema.output(opts)),
      },
    },
  };
}

type Annotations = { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean };

const readOnly: Annotations = { readOnlyHint: true, openWorldHint: false };
const proposes: Annotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export const TOOL_DEFS = {
  search_policies: {
    title: "Search policies",
    description:
      "Search the company policies you are cleared to read, as of the current business date. Returns passages with " +
      "document id, version, section and effective dates. Superseded and not-yet-effective versions are never returned.",
    input: cachedSchema(SearchPoliciesInput),
    output: cachedSchema(SearchPoliciesOutput),
    annotations: readOnly,
  },
  create_support_ticket: {
    title: "Create support ticket",
    description:
      "Propose a support ticket with you as the requester. Nothing is created yet: the result is a pending action that " +
      "the requesting user must approve in PeopleDesk (open approvalUrl); a service token cannot approve.",
    input: cachedSchema(CreateSupportTicketInput),
    output: cachedSchema(ApprovalRequiredOutput),
    annotations: proposes,
  },
  list_my_tickets: {
    title: "List my tickets",
    description: "List your own support tickets, newest first. There is no way to list another person's tickets.",
    input: cachedSchema(ListMyTicketsInput),
    output: cachedSchema(ListMyTicketsOutput),
    annotations: readOnly,
  },
  get_onboarding_progress: {
    title: "Get onboarding progress",
    description:
      "Onboarding checklist and percent complete for yourself (default), for a direct report if you are their manager, " +
      "or for anyone with an onboarding plan if you are an HR administrator.",
    input: cachedSchema(GetOnboardingProgressInput),
    output: cachedSchema(GetOnboardingProgressOutput),
    annotations: readOnly,
  },
  list_orientation_sessions: {
    title: "List orientation sessions",
    description: "Upcoming new hire orientation sessions with seats remaining. Defaults to the next 60 days.",
    input: cachedSchema(ListOrientationSessionsInput),
    output: cachedSchema(ListOrientationSessionsOutput),
    annotations: readOnly,
  },
  schedule_orientation_session: {
    title: "Schedule orientation session",
    description:
      "Propose booking an orientation session for yourself, a direct report in onboarding (managers) or anyone in " +
      "onboarding (HR administrators). Nothing is booked until the requesting user approves the pending action in " +
      "PeopleDesk (open approvalUrl); a service token cannot approve.",
    input: cachedSchema(ScheduleOrientationSessionInput),
    output: cachedSchema(ApprovalRequiredOutput),
    annotations: proposes,
  },
} as const satisfies Record<ToolName, unknown>;
