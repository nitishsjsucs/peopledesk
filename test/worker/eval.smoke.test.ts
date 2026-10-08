// A fixed 20-case subset (4 per category) through evals/lib/runner.ts with SELF.fetch and the stub
// provider. Accuracy is not asserted and not reported: the stub is a test double. What is asserted is
// the harness itself: every POST carries Origin and Content-Type, summary.json validates, and the three
// safety counters are 0.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { SummarySchema } from "../../evals/lib/report.ts";
import { runEval } from "../../evals/lib/runner.ts";
import { EVAL_CATEGORIES } from "../../src/shared/synth/eval-cases.ts";
import type { EvalCase } from "../../src/shared/synth/eval-cases.ts";
import { listPriceUsd, REFERENCE_MODEL } from "../../src/worker/llm/pricing.ts";
import casesRaw from "../../evals/dataset/asof-2026-10-01/cases.jsonl?raw";
import meta from "../../evals/dataset/asof-2026-10-01/meta.json";

const all = casesRaw.trim().split("\n").map((l) => JSON.parse(l) as EvalCase);
const subset = EVAL_CATEGORIES.flatMap((c) => all.filter((x) => x.category === c).slice(0, 4));

describe("eval runner smoke (in pool)", () => {
  it("runs 20 cases end to end with Origin on every POST and zero safety violations", async () => {
    const posts: Array<{ path: string; origin: string | null; contentType: string | null }> = [];
    const { summary, results } = await runEval({
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (req.method === "POST") {
          posts.push({ path: new URL(req.url).pathname, origin: req.headers.get("Origin"), contentType: req.headers.get("Content-Type") });
        }
        return SELF.fetch(req);
      },
      baseUrl: "http://localhost",
      runId: "smoke",
      command: "vitest eval.smoke",
      gitSha: "test",
      cases: subset,
      dataset: meta,
      auth: { kind: "dev" },
      concurrency: 2,
      listPrice: (i, o) => listPriceUsd(i, o, REFERENCE_MODEL),
      listPriceModel: REFERENCE_MODEL,
    });
    expect(subset).toHaveLength(20);
    expect(results).toHaveLength(20);
    expect(() => SummarySchema.parse(summary)).not.toThrow();
    expect(summary.aborted).toBeUndefined();
    expect(summary.server).toMatchObject({ llmProvider: "stub", authMode: "dev", retriever: "d1-fts", asOf: "2026-10-01" });
    expect(summary.safety).toEqual({ unauthorizedLeaks: 0, writesWithoutApproval: 0, pendingActionsForForbiddenTargets: 0 });
    expect(summary.cost.source).toBe("trace-tokens-x-list-price");
    expect(summary.infrastructure.httpErrors).toBe(0);
    // Every POST carried Origin and a JSON Content-Type (conversations, messages, reject, dev token).
    expect(posts.length).toBeGreaterThan(40);
    for (const p of posts) {
      expect(p.origin, p.path).toBe("http://localhost");
      expect(p.contentType, p.path).toBe("application/json");
    }
    expect(posts.some((p) => /\/messages$/.test(p.path))).toBe(true);
    // Every pending action a case proposed was rejected afterwards.
    for (const r of results.filter((x) => x.pendingActionId)) expect(r.pendingActionRejected, r.id).toBe(true);
  }, 120_000);
});
