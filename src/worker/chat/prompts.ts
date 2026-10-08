// System prompts, input builders and JSON schemas for the two LLM calls of a turn. Schemas are built at
// module scope (CPU budget). The router never sees document text; the composer has no tool path.
import { z } from "zod";
import type { Role } from "../../shared/domain.ts";
import type { LlmMessage } from "../llm/provider.ts";

export const ROUTER_TOOLS = [
  "create_support_ticket",
  "list_my_tickets",
  "get_onboarding_progress",
  "list_orientation_sessions",
  "schedule_orientation_session",
] as const;
export type RouterTool = (typeof ROUTER_TOOLS)[number];

export const ROUTER_INTENTS = ["policy_question", "tool_call", "clarify", "out_of_scope"] as const;

// ---------------------------------------------------------------------------------------------------
// Router

export type RouterInput = {
  message: string;
  /** The previous 4 user messages, oldest first. */
  previous_user_messages: string[];
  /** Earlier assistant replies reduced to their kind and tool name, never their text. */
  previous_assistant_turns: Array<{ kind: string; tool?: string }>;
  profile: { employeeId: string; fullName: string; role: Role; region: string; isManager: boolean };
  /** The permitted directory slice (empty for employees). */
  directory: Array<{ employeeId: string; fullName: string; inOnboarding: boolean; booked: boolean }>;
  /** Compact table of upcoming orientation sessions (at most 24 rows). */
  upcoming_sessions: Array<{ id: string; date: string; format: string; region: string; seatsRemaining: number }>;
  today: string;
};

export const RouterOutputSchema = z
  .object({
    intent: z.enum(ROUTER_INTENTS),
    tool: z.enum(ROUTER_TOOLS).nullish(),
    arguments: z.record(z.string(), z.unknown()).nullish(),
    person_name: z.string().nullish(),
    search_query: z.string().nullish(),
    clarifying_question: z.string().nullish(),
  })
  .refine((o) => o.intent !== "tool_call" || !!o.tool, { message: "tool is required when intent is tool_call", path: ["tool"] });
export type RouterOutput = z.infer<typeof RouterOutputSchema>;

export const ROUTER_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...ROUTER_INTENTS] },
    tool: { type: "string", enum: [...ROUTER_TOOLS] },
    arguments: { type: "object" },
    person_name: { type: "string" },
    search_query: { type: "string" },
    clarifying_question: { type: "string" },
  },
  required: ["intent"],
  additionalProperties: false,
} as const;

export const ROUTER_SYSTEM = `You route messages for PeopleDesk, an employee self-service assistant for one company.
Read the INPUT JSON and reply with exactly one JSON object. Do not answer the question yourself.

Pick one intent:
- "policy_question": a question about a company policy, rule, benefit, allowance, limit, deadline, rate or amount.
  Set search_query to a short keyword query naming the specific item (for example "home office setup stipend maximum").
- "tool_call": the employee wants one of these actions. Set "tool" and "arguments".
  * create_support_ticket: report a problem or ask for help from IT, payroll, benefits, facilities or HR.
    arguments: category (it | payroll | benefits | facilities | hr_general | access_request),
    subject (short title, 5 to 120 characters), description (the problem in the employee's words, at least 10 characters),
    priority (low | normal | high, default normal).
  * list_my_tickets: show the employee's own support tickets. arguments: {} or {"status": "open" | "in_progress" | "resolved" | "closed"}.
  * get_onboarding_progress: onboarding checklist, tasks or progress. arguments: {} for the employee themselves.
    For another person, set person_name to the name exactly as written, or arguments.employeeId if they give an id like E0042.
  * list_orientation_sessions: upcoming new hire orientation sessions. arguments: {} or format (virtual | in_person) or region (US | IN | UK | GLOBAL).
  * schedule_orientation_session: book an orientation session. arguments.sessionId must be an id like ORI-007 that the
    employee named or that matches upcoming_sessions. For another person, set person_name or arguments.employeeId.
- "clarify": the request is ambiguous or missing required information: a generic question that could match several
  different policies (for example "How much is the stipend?"), a ticket with no described problem, or a booking with no
  identifiable session. Set clarifying_question.
- "out_of_scope": anything unrelated to company policies, support tickets, onboarding or orientation.

Rules: never invent ids; use only ids that appear in the message or in INPUT. Approval of pending requests happens with
a button in the app, never through you.`;

export const ROUTER_INPUT_MARKER = "INPUT";

export function buildRouterMessages(input: RouterInput): LlmMessage[] {
  return [
    { role: "system", content: ROUTER_SYSTEM },
    { role: "user", content: `${ROUTER_INPUT_MARKER}\n${JSON.stringify(input)}` },
  ];
}

/** Used by the deterministic stub providers, which read the same messages a real model reads. */
export function parseRouterInput(messages: readonly LlmMessage[]): RouterInput {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const content = last?.content ?? "";
  const start = content.indexOf("\n");
  if (!content.startsWith(ROUTER_INPUT_MARKER) || start < 0) throw new Error("not a router prompt");
  return JSON.parse(content.slice(start + 1)) as RouterInput;
}

// ---------------------------------------------------------------------------------------------------
// Composer

export type ComposerPassage = {
  label: string;
  docId: string;
  version: number;
  title: string;
  section: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  text: string;
};

export type ComposerInput = { question: string; today: string; passages: ComposerPassage[] };

export const COMPOSER_KINDS = ["answer", "clarify", "refuse"] as const;

export const ComposerOutputSchema = z.object({
  kind: z.enum(COMPOSER_KINDS),
  answer: z.string(),
  citations: z.array(z.string()),
  clarifying_question: z.string().nullish(),
});
export type ComposerOutput = z.infer<typeof ComposerOutputSchema>;

export const COMPOSER_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...COMPOSER_KINDS] },
    answer: { type: "string" },
    citations: { type: "array", items: { type: "string" } },
    clarifying_question: { type: "string" },
  },
  required: ["kind", "answer", "citations"],
  additionalProperties: false,
} as const;

export const COMPOSER_SYSTEM = `You answer an employee's question about company policy using only the numbered passages.
Reply with exactly one JSON object.
- "answer": answer in one or two sentences, quoting the exact number, amount or duration from the passage, and put the
  labels of the passages you used in "citations" (for example ["P2"]).
- "clarify": the question is generic and the passages describe several different policies that could each be meant
  (for example different stipends); ask which one in "clarifying_question" and set "answer" to the same question.
- "refuse": none of the passages answers the question; set "answer" to one short sentence and "citations" to [].
Use only the passages. If the employee mentions an old or different value, answer with the value the passages give.
Never mention passage labels in the answer text.`;

export function buildComposerMessages(input: ComposerInput): LlmMessage[] {
  const blocks = input.passages.map(
    (p) =>
      `[${p.label}] ${p.docId} v${p.version} | ${p.title} | ${p.section} | effective ${p.effectiveFrom} to ${p.effectiveTo ?? "(open)"}\n${p.text}`,
  );
  return [
    { role: "system", content: COMPOSER_SYSTEM },
    { role: "user", content: `QUESTION: ${input.question}\nTODAY: ${input.today}\nPASSAGES:\n${blocks.join("\n\n")}` },
  ];
}

const PASSAGE_HEADER = /^\[(P\d+)\] (POL-\d{3}) v(\d+) \| (.*?) \| (.*?) \| effective (\S+) to (\S+)$/;

/** Used by the deterministic stub providers. */
export function parseComposerInput(messages: readonly LlmMessage[]): ComposerInput {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const content = last?.content ?? "";
  const question = /^QUESTION: (.*)$/m.exec(content)?.[1] ?? "";
  const today = /^TODAY: (.*)$/m.exec(content)?.[1] ?? "";
  const body = content.split("\nPASSAGES:\n")[1] ?? "";
  const passages: ComposerPassage[] = [];
  for (const block of body.split("\n\n")) {
    const [header, ...rest] = block.split("\n");
    const m = PASSAGE_HEADER.exec(header ?? "");
    if (!m) continue;
    passages.push({
      label: m[1] as string,
      docId: m[2] as string,
      version: Number(m[3]),
      title: m[4] as string,
      section: m[5] as string,
      effectiveFrom: m[6] as string,
      effectiveTo: m[7] === "(open)" ? null : (m[7] as string),
      text: rest.join("\n"),
    });
  }
  return { question, today, passages };
}
