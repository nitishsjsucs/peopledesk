// Deterministic rule-based provider for unit and integration tests and the CI eval smoke. It reads the
// same router and composer messages a real model reads. It is rejected by parseConfig in access mode,
// so it cannot ship to production. Its accuracy is never reported as a result.
import { STUB_MODEL } from "../env.ts";
import type { ComposerOutput, RouterInput, RouterOutput } from "../chat/prompts.ts";
import { parseComposerInput, parseRouterInput } from "../chat/prompts.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "./provider.ts";
import { estimateTokens, LlmUnavailableError, parseModelJson } from "./provider.ts";

const OUT_OF_SCOPE = /\b(weather|joke|poem|stock price|football|cricket|recipe|movie|capital of|lottery|horoscope)\b/;

// Generic phrasings that do not say which policy is meant (no qualifier naming the document).
const AMBIGUOUS = [
  /\bhow many days off do i get\b/,
  /\bhow much leave do i build up\b/,
  /\bhow much is the stipend\b/,
  /\bwhat'?s the stipend amount\b/,
  /^how long is the waiting period\??$/,
  /\bwaiting period before it starts\b/,
  /\bdaily spending limit\??$/,
  /\bhow much can i spend per day\b/,
  /\bdeadline to submit my claim\b/,
  /\bhow many days do i have to submit\??$/,
  /\babove what amount do i need pre-approval\b/,
  /^what is the pre-approval threshold\??$/,
];

const TICKET_WORDS = /\b(ticket|support request|broken|not working|won't|will not|doesn't work|does not work|can't|cannot|crash(?:es|ed)?|black screen|stopped working)\b/;
const DEVICE_WORDS = /\b(laptop|monitor|vpn|password|printer|badge|keyboard|mouse|wifi|wi-fi|headset|phone|chair|desk|account)\b/;
const LIST_TICKETS = /\b(my tickets|my support tickets|ticket status|status of my tickets?|my open tickets|tickets? i (?:opened|filed|raised))\b/;
const OTHERS_TICKETS = /\b([A-Z][a-z]+ [A-Z][a-z]+)'s (?:support )?tickets\b/;
const ONBOARDING = /\bonboarding\b/;
// Person-referential progress requests ("my onboarding", "onboarding progress for X", "X's onboarding"),
// as opposed to questions about the onboarding policies themselves.
const ONBOARDING_PROGRESS = /\b(my onboarding|onboarding (?:progress|status|tasks)|onboarding for|'s onboarding|how far along|onboarding checklist progress)\b/;
const ORIENTATION = /\borientation\b/;
const BOOK = /\b(book|schedule|sign (?:me |them |him |her )?up|register|enrol+|reserve)\b/;
const LIST_SESSIONS = /\b(list|show|upcoming|available|when are|which sessions|what sessions|sessions)\b/;
const NAME_AFTER_FOR = /\bfor ([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/;
const POSSESSIVE_NAME = /\b([A-Z][a-z]+ [A-Z][a-z]+)'s\b/;

function categoryFor(text: string): string {
  if (/\b(laptop|monitor|vpn|password|printer|keyboard|mouse|wifi|wi-fi|headset|phone|software|email)\b/.test(text)) return "it";
  if (/\b(access to|permission|admin rights|grant me)\b/.test(text)) return "access_request";
  if (/\b(pay|payroll|overtime|deposit|salary|tax)\b/.test(text)) return "payroll";
  if (/\b(benefit|insurance|dental|vision|retirement|stipend)\b/.test(text)) return "benefits";
  if (/\b(chair|desk|badge|room|office|door|parking)\b/.test(text)) return "facilities";
  return "hr_general";
}

/** Text with the "please open a ticket" request words removed; what remains describes the problem. */
function problemText(original: string): string {
  return original
    .replace(/\b(please|can you|could you|i need to|i want to|i'd like to|help me|for me|me)\b/gi, " ")
    .replace(/\b(open|file|create|raise|submit|log|make)\b/gi, " ")
    .replace(/\b(an?|the)?\s*(it |support )?(ticket|support request|request)\b/gi, " ")
    .replace(/[,.;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stubRoute(input: RouterInput): RouterOutput {
  const original = input.message.trim();
  const text = original.toLowerCase();
  const explicitId = /\bE\d{4}\b/.exec(original)?.[0];
  const sessionId = /\bORI-\d{3}\b/i.exec(original)?.[0]?.toUpperCase();

  if (OUT_OF_SCOPE.test(text)) return { intent: "out_of_scope" };
  if (AMBIGUOUS.some((re) => re.test(text))) {
    return { intent: "clarify", clarifying_question: "Which policy do you mean? Several policies could apply." };
  }

  const others = OTHERS_TICKETS.exec(original);
  if (LIST_TICKETS.test(text) || others) {
    return { intent: "tool_call", tool: "list_my_tickets", arguments: {}, ...(others ? { person_name: others[1] } : {}) };
  }

  if (ORIENTATION.test(text) && BOOK.test(text)) {
    const name = NAME_AFTER_FOR.exec(original)?.[1];
    const args: Record<string, unknown> = {};
    if (sessionId) args["sessionId"] = sessionId;
    if (explicitId) args["employeeId"] = explicitId;
    return { intent: "tool_call", tool: "schedule_orientation_session", arguments: args, ...(name && !explicitId ? { person_name: name } : {}) };
  }
  if (ORIENTATION.test(text) && LIST_SESSIONS.test(text)) {
    const format = /\bin[- ]person\b/.test(text) ? "in_person" : /\bvirtual\b/.test(text) ? "virtual" : undefined;
    return { intent: "tool_call", tool: "list_orientation_sessions", arguments: format ? { format } : {} };
  }

  if (ONBOARDING.test(text) && (ONBOARDING_PROGRESS.test(text) || explicitId)) {
    const name = POSSESSIVE_NAME.exec(original)?.[1] ?? NAME_AFTER_FOR.exec(original)?.[1];
    if (explicitId) return { intent: "tool_call", tool: "get_onboarding_progress", arguments: { employeeId: explicitId } };
    return { intent: "tool_call", tool: "get_onboarding_progress", arguments: {}, ...(name ? { person_name: name } : {}) };
  }

  if (TICKET_WORDS.test(text) || (DEVICE_WORDS.test(text) && /\b(help|issue|problem|fix)\b/.test(text))) {
    const problem = problemText(original);
    const args: Record<string, unknown> = { category: categoryFor(text), priority: "normal" };
    if (problem.split(" ").filter((w) => w.length > 2).length >= 3) {
      args["subject"] = problem.slice(0, 80).padEnd(5, ".");
      args["description"] = original.length >= 10 ? original : `${original} (reported in chat)`;
    }
    return { intent: "tool_call", tool: "create_support_ticket", arguments: args };
  }

  return { intent: "policy_question", search_query: original };
}

const TOKEN_RE = /[a-z0-9]+(?:\.[0-9]+)?/g;
const STOP = new Set(["the", "a", "an", "is", "are", "what", "how", "do", "does", "i", "my", "of", "for", "to", "in", "it", "still", "much", "many"]);

export function stubCompose(question: string, passages: Array<{ label: string; text: string }>): ComposerOutput {
  const first = passages[0];
  if (!first) return { kind: "refuse", answer: "I couldn't find that in the policies available to you.", citations: [] };
  const q = new Set((question.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => !STOP.has(t)));
  const sentences = first.text
    .split(/\n|(?<=\.)\s+/)
    .map((s) => s.replace(/^-\s*/, "").trim())
    .filter((s) => s.length > 0);
  let best = sentences[0] ?? first.text;
  let bestScore = -1;
  for (const s of sentences) {
    const score = (s.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => q.has(t)).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return { kind: "answer", answer: best, citations: [first.label] };
}

export class StubProvider implements LlmProvider {
  readonly id = "stub" as const;
  readonly model = STUB_MODEL;
  /** Test hook: when set, every call fails as an unavailable provider. */
  failWith?: "provider_unavailable" | "turn_timeout";

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    if (this.failWith) throw new LlmUnavailableError(this.failWith, "stub provider configured to fail");
    if (req.signal?.aborted) throw new LlmUnavailableError("turn_timeout", "turn aborted");
    const raw =
      req.purpose === "router"
        ? stubRoute(parseRouterInput(req.messages))
        : (() => {
            const input = parseComposerInput(req.messages);
            return stubCompose(input.question, input.passages);
          })();
    const rawText = JSON.stringify(raw);
    const usage = { inputTokens: estimateTokens(req.messages.map((m) => m.content).join("\n")), outputTokens: estimateTokens(rawText) };
    const { value } = parseModelJson(rawText, req.zod, usage);
    return { value, rawText, usage, latencyMs: Date.now() - started, gatewayLogId: null, retries: 0 };
  }
}
