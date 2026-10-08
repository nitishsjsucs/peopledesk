// runTurn(): router -> (tool | retrieval -> composer) -> citation validation, at most one tool call per
// turn. The router runs before any document text is seen and the composer has no tool path, so
// retrieved content can never trigger an action. Tools are called through the in-process MCP client,
// so chat uses exactly the validation and authorization an external MCP client gets.
import type { PendingActionView, TurnResult, TurnTrace } from "../../shared/api-types.ts";
import { addDaysIso } from "../../shared/dates.ts";
import type { ToolErrorCode, ToolName, TurnErrorCode } from "../../shared/domain.ts";
import { TOOL_ERROR_CODES } from "../../shared/domain.ts";
import type { ApprovalRequired, Passage } from "../../shared/tool-schemas.ts";
import type { Principal } from "../auth/principal.ts";
import type { Services } from "../container.ts";
import { connectInProcess } from "../mcp/in-process-client.ts";
import type { ToolContext } from "../mcp/server.ts";
import type { RetrievalMeta } from "../mcp/tools/search-policies.ts";
import { RETRIEVAL_META_KEY } from "../mcp/tools/search-policies.ts";
import type { LlmProvider, LlmRequest } from "../llm/provider.ts";
import { LlmInvalidOutputError, LlmUnavailableError, raceAbort } from "../llm/provider.ts";
import { labelPassages, sourceLine, validateCitations } from "./citations.ts";
import { directorySlice, resolvePerson } from "./people.ts";
import {
  buildComposerMessages,
  buildRouterMessages,
  COMPOSER_JSON_SCHEMA,
  ComposerOutputSchema,
  ROUTER_JSON_SCHEMA,
  RouterOutputSchema,
} from "./prompts.ts";
import type { ComposerOutput, RouterInput, RouterOutput } from "./prompts.ts";
import {
  clarifyForFields,
  ERROR_TEXT,
  fieldsFromValidationText,
  renderApproval,
  renderOnboarding,
  renderSessions,
  renderTickets,
  TEXT,
  textForToolError,
} from "./render.ts";

/** "yes", "approve it", "go ahead"... typed in chat while an action is pending: executes nothing. */
export const APPROVE_IN_CHAT = /^(yes|ok|approve|approved|confirm|go ahead|do it)\b/i;

export const SEARCH_TOP_K = 6;
const ROUTER_MAX_TOKENS = 400;
const COMPOSER_MAX_TOKENS = 400;
const SEED = 7;

type CallToolResultLike = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export type McpClientLike = {
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close?(): Promise<void>;
};

export type TurnDeps = {
  provider: LlmProvider;
  services: Services;
  principal: Principal;
  conversationId: string;
  turnId: string;
  /** Business date for this turn (from the Worker's clock). */
  asOf: string;
  approvalOrigin: string;
  history: { userMessages: string[]; assistantTurns: Array<{ kind: string; tool?: string }> };
  evalRunId?: string;
  caseId?: string;
  signal?: AbortSignal;
  /** Defaults to the in-process MCP client. */
  connect?: (ctx: ToolContext) => Promise<McpClientLike>;
};

type Finish = Omit<TurnResult, "turnId" | "conversationId" | "trace" | "citations"> & Partial<Pick<TurnResult, "citations">>;

type Completion<T> = { value: T | null; ms: number; inputTokens: number; outputTokens: number; retries: number };

/** One model call with one retry on invalid output (the zod issues are appended to the conversation). */
async function complete<T>(deps: TurnDeps, req: Omit<LlmRequest<T>, "metadata" | "signal">, hints: string[]): Promise<Completion<T>> {
  const started = Date.now();
  const out: Completion<T> = { value: null, ms: 0, inputTokens: 0, outputTokens: 0, retries: 0 };
  let messages = req.messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await deps.provider.completeJson<T>({
        ...req,
        messages,
        signal: deps.signal,
        metadata: {
          conversationId: deps.conversationId,
          turnId: deps.turnId,
          purpose: req.purpose,
          ...(deps.evalRunId ? { evalRunId: deps.evalRunId } : {}),
          ...(deps.caseId ? { caseId: deps.caseId } : {}),
        },
      });
      out.inputTokens += r.usage.inputTokens;
      out.outputTokens += r.usage.outputTokens;
      out.retries += r.retries;
      if (r.gatewayLogId) hints.push(`${req.purpose}:${r.gatewayLogId}`);
      out.value = r.value;
      break;
    } catch (err) {
      if (!(err instanceof LlmInvalidOutputError)) throw err;
      out.inputTokens += err.usage.inputTokens;
      out.outputTokens += err.usage.outputTokens;
      if (attempt === 1) break;
      out.retries++;
      messages = [
        ...messages,
        { role: "assistant", content: err.rawText || "(no output)" },
        {
          role: "user",
          content: `That reply was invalid (${err.issues}). Reply again with exactly one JSON object that matches the schema.`,
        },
      ];
    }
  }
  out.ms = Date.now() - started;
  return out;
}

export async function runTurn(deps: TurnDeps, rawText: string): Promise<TurnResult> {
  const started = Date.now();
  const { services: s, principal } = deps;
  const message = rawText.trim();
  const trace: TurnTrace = {
    asOf: deps.asOf,
    llmProvider: deps.provider.id,
    model: deps.provider.model,
    totalMs: 0,
    router: { intent: "none", ms: 0, inputTokens: 0, outputTokens: 0, retries: 0 },
    gatewayLogIdHints: [],
  };
  const finish = (r: Finish): TurnResult => ({
    turnId: deps.turnId,
    conversationId: deps.conversationId,
    citations: [],
    ...r,
    trace: { ...trace, totalMs: Date.now() - started },
  });
  const error = (code: TurnErrorCode, detail?: string) =>
    finish({ kind: "error", text: ERROR_TEXT[code], error: { code, message: detail ?? ERROR_TEXT[code] } });

  try {
    // 1. Guard: approval is a button, never a chat message.
    if (APPROVE_IN_CHAT.test(message) && (await s.actions.hasPendingInConversation(principal, deps.conversationId))) {
      trace.router.intent = "approval_guard";
      return finish({ kind: "clarify", text: TEXT.useApproveButton });
    }

    // 2. Router: sees the message, recent user messages, the profile, the permitted directory slice and
    //    the upcoming sessions. Never document text.
    const slice = await directorySlice(s.db, principal);
    const sessions = await s.orientation.list(deps.asOf, { to: addDaysIso(deps.asOf, 90) });
    const routerInput: RouterInput = {
      message,
      previous_user_messages: deps.history.userMessages.slice(-4),
      previous_assistant_turns: deps.history.assistantTurns.slice(-4),
      profile: {
        employeeId: principal.employeeId,
        fullName: principal.fullName,
        role: principal.role,
        region: principal.region,
        isManager: principal.role === "manager",
      },
      directory: slice,
      upcoming_sessions: sessions.slice(0, 24).map((x) => ({
        id: x.id,
        date: x.startsAt.slice(0, 10),
        format: x.format,
        region: x.region,
        seatsRemaining: x.seatsRemaining,
      })),
      today: deps.asOf,
    };
    const routed = await complete<RouterOutput>(
      deps,
      {
        purpose: "router",
        messages: buildRouterMessages(routerInput),
        schemaName: "router_output",
        jsonSchema: ROUTER_JSON_SCHEMA,
        zod: RouterOutputSchema,
        maxTokens: ROUTER_MAX_TOKENS,
        temperature: 0,
        seed: SEED,
      },
      trace.gatewayLogIdHints,
    );
    trace.router = { intent: routed.value?.intent ?? "invalid", ms: routed.ms, inputTokens: routed.inputTokens, outputTokens: routed.outputTokens, retries: routed.retries };
    const route = routed.value;
    if (!route) return finish({ kind: "clarify", text: TEXT.genericClarify });
    if (route.tool) trace.router.tool = route.tool;

    switch (route.intent) {
      case "out_of_scope":
        return finish({ kind: "refuse", text: TEXT.outOfScope });
      case "clarify":
        return finish({ kind: "clarify", text: route.clarifying_question?.trim() || TEXT.genericClarify });
      case "tool_call":
        return await toolTurn(deps, route, slice, finish, error, trace);
      case "policy_question":
        return await policyTurn(deps, route, message, finish, error, trace);
    }
  } catch (err) {
    if (err instanceof LlmUnavailableError) return error(err.code, err.message);
    throw err;
  }
}

async function callTool(deps: TurnDeps, name: ToolName, args: Record<string, unknown>, trace: TurnTrace): Promise<CallToolResultLike> {
  const ctx: ToolContext = {
    principal: deps.principal,
    services: deps.services,
    approvalOrigin: deps.approvalOrigin,
    source: "chat",
    conversationId: deps.conversationId,
    ...(deps.signal ? { signal: deps.signal } : {}),
  };
  const client = await (deps.connect ?? connectInProcess)(ctx);
  const started = Date.now();
  try {
    return (await raceAbort(client.callTool({ name, arguments: args }), deps.signal)) as CallToolResultLike;
  } finally {
    trace.tool = { name, ms: Date.now() - started };
    await client.close?.().catch(() => undefined);
  }
}

function toolErrorCode(r: CallToolResultLike): ToolErrorCode | "input_validation" | null {
  if (!r.isError) return null;
  const code = (r.structuredContent?.["error"] as { code?: string } | undefined)?.code;
  if (code && (TOOL_ERROR_CODES as readonly string[]).includes(code)) return code as ToolErrorCode;
  // The SDK rejects schema violations before the tool runs, with text and no structured error.
  return "input_validation";
}

const errorText = (r: CallToolResultLike) => (r.content ?? []).map((c) => c.text ?? "").join(" ");

async function toolTurn(
  deps: TurnDeps,
  route: RouterOutput,
  slice: Awaited<ReturnType<typeof directorySlice>>,
  finish: (r: Finish) => TurnResult,
  error: (code: TurnErrorCode, detail?: string) => TurnResult,
  trace: TurnTrace,
): Promise<TurnResult> {
  const tool = route.tool as ToolName;
  const args: Record<string, unknown> = { ...(route.arguments ?? {}) };

  // 3. Person resolution, deterministic: names resolve only against the permitted slice, and an
  //    unknown name gets the same refusal as an unpermitted one.
  const name = route.person_name?.trim();
  if (name) {
    const who = resolvePerson(name, deps.principal, slice);
    if (tool === "list_my_tickets") {
      // The tool has no way to name someone else.
      if (who.kind !== "self") return finish({ kind: "refuse", text: TEXT.person });
    } else if (tool === "get_onboarding_progress" || tool === "schedule_orientation_session") {
      if (who.kind === "unknown") return finish({ kind: "refuse", text: TEXT.person });
      if (who.kind === "person") args["employeeId"] = who.employeeId;
      else delete args["employeeId"];
    }
  }

  // 4. Exactly one tool call, through MCP.
  const result = await callTool(deps, tool, args, trace);
  const code = toolErrorCode(result);
  if (code === null) {
    const structured = result.structuredContent ?? {};
    if (tool === "create_support_ticket" || tool === "schedule_orientation_session") {
      const approval = structured as unknown as ApprovalRequired;
      const view = (await deps.services.actions.getOwn(deps.principal, approval.actionId)) as PendingActionView;
      return finish({
        kind: "approval_required",
        text: renderApproval(view),
        toolCall: { tool, arguments: args, status: "ok" },
        toolResult: structured,
        pendingAction: view,
      });
    }
    const text =
      tool === "list_my_tickets"
        ? renderTickets(structured as { tickets: Array<{ status: string }> })
        : tool === "get_onboarding_progress"
          ? renderOnboarding(structured as Parameters<typeof renderOnboarding>[0])
          : renderSessions(structured as Parameters<typeof renderSessions>[0]);
    return finish({ kind: "tool_result", text, toolCall: { tool, arguments: args, status: "ok" }, toolResult: structured });
  }

  if (code === "retrieval_unavailable") return error("retrieval_unavailable");
  if (code === "input_validation" || code === "validation_error") {
    const message = errorText(result);
    const fields = fieldsFromValidationText(message);
    return finish({
      kind: "clarify",
      text: clarifyForFields(tool, fields),
      toolCall: { tool, arguments: args, status: "error", error: { code: "validation_error", message: message.slice(0, 300) } },
    });
  }
  const mapped = textForToolError(code, tool);
  return finish({
    kind: mapped.kind,
    text: mapped.text,
    toolCall: { tool, arguments: args, status: "error", error: { code, message: errorText(result).slice(0, 300) } },
  });
}

async function policyTurn(
  deps: TurnDeps,
  route: RouterOutput,
  message: string,
  finish: (r: Finish) => TurnResult,
  error: (code: TurnErrorCode, detail?: string) => TurnResult,
  trace: TurnTrace,
): Promise<TurnResult> {
  const suggested = route.search_query?.trim() ?? "";
  const query = (suggested.length >= 3 ? suggested : message).slice(0, 500);
  if (query.length < 3) return finish({ kind: "clarify", text: TEXT.genericClarify });

  // 5. Retrieval through search_policies (clearance and effective-date filters, then the permission gate).
  const result = await callTool(deps, "search_policies", { query, topK: SEARCH_TOP_K }, trace);
  const meta = result._meta?.[RETRIEVAL_META_KEY] as RetrievalMeta | undefined;
  if (meta) {
    trace.retrieval = {
      query: meta.query,
      returned: meta.returned,
      droppedForClearance: meta.droppedForClearance,
      droppedNotEffective: meta.droppedNotEffective,
      passageIds: meta.passageIds,
      ...(meta.aiSearchChunkIds ? { aiSearchChunkIds: meta.aiSearchChunkIds } : {}),
      ms: meta.ms,
      retriever: meta.retriever,
    };
  }
  delete trace.tool;
  const code = toolErrorCode(result);
  // A broken index must never masquerade as a correct refusal.
  if (code === "retrieval_unavailable") return error("retrieval_unavailable");
  if (code !== null) return error("internal", errorText(result).slice(0, 300));
  const passages = ((result.structuredContent?.["passages"] ?? []) as Passage[]).slice(0, SEARCH_TOP_K);
  if (passages.length === 0) return finish({ kind: "refuse", text: TEXT.notFound });

  // 6. Composer over labeled passages, then the citation validator.
  const labeled = labelPassages(passages);
  const composed = await complete<ComposerOutput>(
    deps,
    {
      purpose: "composer",
      messages: buildComposerMessages({
        question: message,
        today: deps.asOf,
        passages: labeled.map((p) => ({
          label: p.label,
          docId: p.docId,
          version: p.version,
          title: p.title,
          section: p.section,
          effectiveFrom: p.effectiveFrom,
          effectiveTo: p.effectiveTo,
          text: p.text,
        })),
      }),
      schemaName: "composer_output",
      jsonSchema: COMPOSER_JSON_SCHEMA,
      zod: ComposerOutputSchema,
      maxTokens: COMPOSER_MAX_TOKENS,
      temperature: 0,
      seed: SEED,
    },
    trace.gatewayLogIdHints,
  );
  const out = composed.value;
  const { citations, invalidDropped } = out ? validateCitations(out.citations, labeled) : { citations: [], invalidDropped: 0 };
  trace.composer = {
    ms: composed.ms,
    inputTokens: composed.inputTokens,
    outputTokens: composed.outputTokens,
    invalidCitationsDropped: invalidDropped,
    retries: composed.retries,
  };
  if (!out || out.kind === "refuse") return finish({ kind: "refuse", text: TEXT.notFound });
  if (out.kind === "clarify") {
    return finish({ kind: "clarify", text: out.clarifying_question?.trim() || out.answer.trim() || TEXT.genericClarify, citations });
  }
  // An answer with zero valid citations is never shown.
  if (citations.length === 0) return finish({ kind: "refuse", text: TEXT.notFound });
  const answer = out.answer.replace(/\s*[[(]P\d+[\])]/g, "").trim();
  return finish({ kind: "answer", text: `${answer}\n\n${sourceLine(citations)}`, citations });
}
