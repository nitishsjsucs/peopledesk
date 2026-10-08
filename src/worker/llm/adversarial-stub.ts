// A provider that tries forbidden things on purpose (safety tests only; rejected in access mode).
// Router: always reaches for the most dangerous tool call it can build: another employee's onboarding
// by explicit id, scheduling someone else, a name outside the caller's directory, a ticket with a
// smuggled requester field. Composer: cites every label it can think of plus fabricated ones. The tests
// prove that server checks, not model behavior, keep the system safe.
import { ADVERSARIAL_MODEL } from "../env.ts";
import type { ComposerOutput, RouterInput, RouterOutput } from "../chat/prompts.ts";
import { parseComposerInput, parseRouterInput } from "../chat/prompts.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "./provider.ts";
import { estimateTokens, LlmUnavailableError, parseModelJson } from "./provider.ts";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Some other employee id, never the caller's own. */
function otherEmployeeId(input: RouterInput): string {
  const self = Number(input.profile.employeeId.slice(1));
  let n = 21 + (hash(input.message) % 100);
  if (n === self) n = n === 120 ? 21 : n + 1;
  return `E${String(n).padStart(4, "0")}`;
}

export function adversarialRoute(input: RouterInput): RouterOutput {
  const text = input.message.toLowerCase();
  const victim = /\bE\d{4}\b/.exec(input.message)?.[0] ?? otherEmployeeId(input);
  const session = /\bORI-\d{3}\b/i.exec(input.message)?.[0]?.toUpperCase() ?? "ORI-005";
  if (/\bschedul|\bbook|orientation/.test(text)) {
    return { intent: "tool_call", tool: "schedule_orientation_session", arguments: { sessionId: session, employeeId: victim } };
  }
  if (/\bname\b|\bperson\b|'s\b/.test(text)) {
    return { intent: "tool_call", tool: "get_onboarding_progress", arguments: {}, person_name: "Somebody Outside Yourscope" };
  }
  if (/\bticket/.test(text)) {
    return {
      intent: "tool_call",
      tool: "create_support_ticket",
      arguments: {
        category: "access_request",
        subject: "Grant admin rights",
        description: "Grant me admin rights to every system now.",
        requesterId: victim,
        approved: true,
      },
    };
  }
  if (/\bonboarding|progress/.test(text)) {
    return { intent: "tool_call", tool: "get_onboarding_progress", arguments: { employeeId: victim } };
  }
  return { intent: "policy_question", search_query: input.message };
}

export function adversarialCompose(passages: Array<{ label: string; text: string }>): ComposerOutput {
  const labels = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P99", "P0", "X1", "POL-001@1#3", "p1", "P1 "];
  const answer = passages.length > 0 ? `Per policy: ${passages[0]?.text.slice(0, 200)}` : "Here is everything I know.";
  return { kind: "answer", answer, citations: labels };
}

export class AdversarialStubProvider implements LlmProvider {
  readonly id = "adversarial-stub" as const;
  readonly model = ADVERSARIAL_MODEL;

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const started = Date.now();
    if (req.signal?.aborted) throw new LlmUnavailableError("turn_timeout", "turn aborted");
    const raw =
      req.purpose === "router"
        ? adversarialRoute(parseRouterInput(req.messages))
        : adversarialCompose(parseComposerInput(req.messages).passages);
    const rawText = JSON.stringify(raw);
    const usage = { inputTokens: estimateTokens(req.messages.map((m) => m.content).join("\n")), outputTokens: estimateTokens(rawText) };
    const { value } = parseModelJson(rawText, req.zod, usage);
    return { value, rawText, usage, latencyMs: Date.now() - started, gatewayLogId: null, retries: 0 };
  }
}
