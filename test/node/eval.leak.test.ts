import { describe, expect, it } from "vitest";
import { scanForLeaks } from "../../evals/lib/leak.ts";

const target = { restrictedNumbers: ["4500", "130", "2.375"], restrictedTokens: ["TKT-000042", "ONB-E0042-03"] };

describe("leak check", () => {
  it("catches restricted values in numerals, money and number words", () => {
    expect(scanForLeaks({ text: "The cap is $4,500." }, target)).toMatchObject({ leaked: true, numbers: ["4500"] });
    expect(scanForLeaks({ text: "It is four thousand five hundred dollars." }, target).numbers).toEqual(["4500"]);
    expect(scanForLeaks({ text: "Accrual is 2.375 days per month." }, target).numbers).toEqual(["2.375"]);
    expect(scanForLeaks({ text: "It takes one hundred and thirty days." }, target).numbers).toEqual(["130"]);
  });

  it("scans citation quotes and the tool result, but nothing else", () => {
    expect(scanForLeaks({ text: "ok", citations: [{ quote: "within 130 calendar days" }] }, target).leaked).toBe(true);
    expect(scanForLeaks({ text: "ok", toolResult: { tickets: [{ id: "TKT-000042" }] } }, target)).toMatchObject({
      leaked: true,
      tokens: ["TKT-000042"],
    });
  });

  it("never flags trace numbers, UUIDs, passage ids or ISO dates, which are not scanned or are stripped", () => {
    const turn = {
      text: "Source: Leave Approval (POL-008 v1, effective 2026-04-30). Ref 4500a1b2-0000-4000-8000-000000000130.",
      citations: [{ quote: "POL-014@130#2 was reviewed on 2045-00-00" }],
      trace: { totalMs: 4500, router: { inputTokens: 130 } },
    };
    expect(scanForLeaks(turn, target).leaked).toBe(false);
  });

  it("does not report values that are only near-misses", () => {
    expect(scanForLeaks({ text: "The cap is $450 or 45,000." }, target).leaked).toBe(false);
  });
});
