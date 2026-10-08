import { describe, expect, it } from "vitest";
import type { Passage } from "../../src/shared/tool-schemas.ts";
import { labelPassages, sourceLine, validateCitations } from "../../src/worker/chat/citations.ts";
import { runTurn } from "../../src/worker/chat/orchestrator.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "../../src/worker/llm/provider.ts";
import { principalFor, testServices } from "../helpers/services.ts";

const passage = (n: number, overrides: Partial<Passage> = {}): Passage => ({
  passageId: `POL-00${n}@1#3`,
  docId: `POL-00${n}`,
  version: 1,
  title: `Policy ${n}`,
  section: "Policy",
  text: `- Fact number ${n}.`.padEnd(400, "x"),
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  sourceKey: `policies/r1-all/POL-00${n}/v01.md`,
  score: 1,
  ...overrides,
});

describe("CitationValidator", () => {
  it("keeps only labels returned this turn, counts the rest, dedupes and quotes 300 characters", () => {
    const labeled = labelPassages([passage(1), passage(2), passage(1)]);
    const out = validateCitations(["P2", "P9", "X1", "P1", "P2", "P3", "POL-001@1#3"], labeled);
    expect(out.citations.map((c) => c.passageId)).toEqual(["POL-002@1#3", "POL-001@1#3"]);
    expect(out.invalidDropped).toBe(3);
    expect(out.citations[0]?.quote).toHaveLength(300);
  });

  it("writes a source line naming doc id, version and effective date", () => {
    const { citations } = validateCitations(["P1"], labelPassages([passage(4, { title: "PTO Accrual", effectiveFrom: "2026-07-01" })]));
    expect(sourceLine(citations)).toBe("Source: PTO Accrual (POL-004 v1, effective 2026-07-01).");
    const two = validateCitations(["P1", "P2"], labelPassages([passage(1), passage(2)])).citations;
    expect(sourceLine(two)).toBe("Sources: Policy 1 (POL-001 v1, effective 2026-01-01); Policy 2 (POL-002 v1, effective 2026-01-01).");
  });
});

/** Router asks a policy question; composer answers citing only fabricated labels. */
class FabricatingProvider implements LlmProvider {
  readonly id = "stub" as const;
  readonly model = "fabricating";
  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const raw =
      req.purpose === "router"
        ? { intent: "policy_question", search_query: "paid time off accrue" }
        : { kind: "answer", answer: "You get 99 days.", citations: ["P42", "Z9"] };
    return { value: req.zod.parse(raw), rawText: JSON.stringify(raw), usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 0, gatewayLogId: null, retries: 0 };
  }
}

describe("answers without a valid citation", () => {
  it("are downgraded to the refusal text", async () => {
    const r = await runTurn(
      {
        provider: new FabricatingProvider(),
        services: testServices(),
        principal: await principalFor("tenured_employee"),
        conversationId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        asOf: "2026-10-01",
        approvalOrigin: "http://localhost",
        history: { userMessages: [], assistantTurns: [] },
      },
      "How fast does paid time off accrue?",
    );
    expect(r).toMatchObject({ kind: "refuse", text: "I couldn't find that in the policies available to you.", citations: [] });
    expect(r.trace.composer?.invalidCitationsDropped).toBe(2);
    expect(r.text).not.toContain("99");
  });
});
