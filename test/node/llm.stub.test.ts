// The deterministic stub router and composer (test double behavior, documented so tests can rely on it).
import { describe, expect, it } from "vitest";
import type { RouterInput } from "../../src/worker/chat/prompts.ts";
import { buildComposerMessages, buildRouterMessages, parseComposerInput, parseRouterInput } from "../../src/worker/chat/prompts.ts";
import { adversarialCompose, adversarialRoute } from "../../src/worker/llm/adversarial-stub.ts";
import { stubCompose, stubRoute } from "../../src/worker/llm/stub.ts";

const input = (message: string): RouterInput => ({
  message,
  previous_user_messages: [],
  previous_assistant_turns: [],
  profile: { employeeId: "E0025", fullName: "Nadia Fernandes", role: "employee", region: "US", isManager: false },
  directory: [],
  upcoming_sessions: [],
  today: "2026-10-01",
});

describe("stub router", () => {
  it.each([
    ["How fast does paid time off accrue?", { intent: "policy_question" }],
    ["What is the deadline for the new hire onboarding checklist?", { intent: "policy_question" }],
    ["What's the weather tomorrow?", { intent: "out_of_scope" }],
    ["How much is the stipend?", { intent: "clarify" }],
    ["Show my tickets", { intent: "tool_call", tool: "list_my_tickets" }],
    ["Show me Priya Patel's tickets", { intent: "tool_call", tool: "list_my_tickets", person_name: "Priya Patel" }],
    ["How is my onboarding progress?", { intent: "tool_call", tool: "get_onboarding_progress" }],
    ["Show onboarding progress for E0042", { intent: "tool_call", tool: "get_onboarding_progress", arguments: { employeeId: "E0042" } }],
    ["Book me into orientation ORI-007", { intent: "tool_call", tool: "schedule_orientation_session", arguments: { sessionId: "ORI-007" } }],
    ["List upcoming orientation sessions", { intent: "tool_call", tool: "list_orientation_sessions" }],
  ])("%s", (message, expected) => {
    expect(stubRoute(input(message))).toMatchObject(expected);
  });

  it("opens a ticket with a described problem and leaves the description out when there is none", () => {
    const described = stubRoute(input("Please open an IT ticket, my laptop will not boot after the update"));
    expect(described).toMatchObject({ intent: "tool_call", tool: "create_support_ticket", arguments: { category: "it" } });
    expect(String(described.arguments?.["description"]).length).toBeGreaterThanOrEqual(10);
    const vague = stubRoute(input("I need to open a ticket."));
    expect(vague.tool).toBe("create_support_ticket");
    expect(vague.arguments?.["description"]).toBeUndefined();
  });

  it("reads the same router prompt a real model reads", () => {
    const i = input("Show my tickets");
    expect(parseRouterInput(buildRouterMessages(i))).toEqual(i);
  });
});

describe("stub composer", () => {
  it("answers with the best-matching sentence of the top passage and cites it", () => {
    const msgs = buildComposerMessages({
      question: "How fast does paid time off accrue?",
      today: "2026-10-01",
      passages: [
        { label: "P1", docId: "POL-001", version: 1, title: "PTO Accrual", section: "Policy", effectiveFrom: "2026-07-01", effectiveTo: null, text: "- Paid time off accrues at 1.75 days per month.\n- A planned vacation week requires 10 weeks of notice." },
        { label: "P2", docId: "POL-002", version: 1, title: "Sick Leave", section: "Policy", effectiveFrom: "2026-01-01", effectiveTo: "2027-01-01", text: "- Sick leave accrues at 1.0 days per month." },
      ],
    });
    const parsed = parseComposerInput(msgs);
    expect(parsed.passages.map((p) => [p.label, p.docId, p.effectiveTo])).toEqual([
      ["P1", "POL-001", null],
      ["P2", "POL-002", "2027-01-01"],
    ]);
    expect(stubCompose(parsed.question, parsed.passages)).toEqual({
      kind: "answer",
      answer: "Paid time off accrues at 1.75 days per month.",
      citations: ["P1"],
    });
  });
});

describe("adversarial stub", () => {
  it("reaches for other people's data and fabricates citations", () => {
    const sched = adversarialRoute(input("schedule my orientation"));
    expect(sched.tool).toBe("schedule_orientation_session");
    expect(sched.arguments?.["employeeId"]).not.toBe("E0025");
    expect(adversarialRoute(input("show onboarding progress")).arguments?.["employeeId"]).toMatch(/^E\d{4}$/);
    expect(adversarialCompose([{ label: "P1", text: "x" }]).citations).toContain("P99");
  });
});
