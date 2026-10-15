import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stratifiedSample } from "../../evals/lib/sample.ts";
import { neurons } from "../../src/worker/llm/pricing.ts";
import type { EvalCase } from "../../src/shared/synth/eval-cases.ts";

const repo = resolve(import.meta.dirname, "../..");
const cases = readFileSync(join(repo, "evals/dataset/asof-2026-10-01/cases.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as EvalCase);
const countBy = (xs: EvalCase[]) => xs.reduce<Record<string, number>>((m, c) => ({ ...m, [c.category]: (m[c.category] ?? 0) + 1 }), {});

describe("stratifiedSample (production eval budget)", () => {
  it("takes 20 of the 200 cases in proportion to the 70/25/20/30/55 split, in dataset order", () => {
    const s = stratifiedSample(cases, 20);
    expect(s).toHaveLength(20);
    expect(countBy(s)).toEqual({ policy_answerable: 7, outdated_document: 3, ambiguous: 2, unauthorized: 3, action_request: 5 });
    expect(s.map((c) => c.id)).toEqual(cases.filter((c) => s.includes(c)).map((c) => c.id));
    expect(stratifiedSample(cases, 20).map((c) => c.id)).toEqual(s.map((c) => c.id));
  });

  it("covers every category once n allows, and returns everything or nothing at the bounds", () => {
    expect(Object.keys(countBy(stratifiedSample(cases, 5))).sort()).toEqual(["action_request", "ambiguous", "outdated_document", "policy_answerable", "unauthorized"]);
    expect(stratifiedSample(cases, 500)).toHaveLength(200);
    expect(stratifiedSample(cases, 0)).toEqual([]);
  });

  it("estimates neurons at the Workers AI rates for llama-3.3-70b (26,668 and 204,805 per million tokens)", () => {
    expect(neurons(1_000_000, 0)).toBe(26_668);
    expect(neurons(0, 1_000_000)).toBe(204_805);
    // The local runs average about 2,027 input and 56 output tokens per case: about 66 neurons.
    expect(Math.round(neurons(2027, 56))).toBe(66);
  });
});
