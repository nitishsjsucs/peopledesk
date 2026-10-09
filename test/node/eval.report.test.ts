import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abortReason,
  buildSummary,
  decideCost,
  GROUNDED_DEFINITION,
  OVERALL_DEFINITION,
  README_END,
  README_START,
  ReadmeRefusal,
  renderReadmeResults,
  replaceResultsBlock,
  SummarySchema,
} from "../../evals/lib/report.ts";
import type { CaseResult, GatewayLogSample, Summary } from "../../evals/lib/report.ts";
import { percentile, wilson } from "../../evals/lib/stats.ts";
import { collectGatewayLogs } from "../../evals/lib/gateway.ts";
import { runEval } from "../../evals/lib/runner.ts";
import type { DatasetMeta } from "../../evals/lib/runner.ts";
import { PERSONA_KEYS } from "../../src/shared/domain.ts";
import type { EvalCase } from "../../src/shared/synth/eval-cases.ts";

const repo = resolve(import.meta.dirname, "../..");

describe("stats", () => {
  it("computes Wilson 95% intervals", () => {
    // Reference values computed independently from the Wilson formula (Python, z = 1.959964).
    const w = wilson(81, 95);
    expect(w.rate).toBeCloseTo(0.8526, 4);
    expect(w.low).toBeCloseTo(0.76771, 4);
    expect(w.high).toBeCloseTo(0.91014, 4);
    expect(wilson(0, 0)).toEqual({ rate: 0, low: 0, high: 0 });
    const all = wilson(10, 10);
    expect(all.high).toBe(1);
    expect(all.low).toBeCloseTo(0.7225, 3);
  });

  it("computes linear-interpolated percentiles", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([15, 20, 35, 40, 50], 95)).toBe(48);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBe(0);
  });
});

const listPrice = (i: number, o: number) => (i * 0.293 + o * 2.253) / 1e6;

describe("cost source decision", () => {
  const base = { llmCalls: 2, traceTokens: { input: 1000, output: 100 }, model: "m", listPrice };
  const oneTurn = (logs: GatewayLogSample[]) => [{ turnId: "t1", llmCalls: 2, logs }];

  it("uses AI Gateway's estimate only when every call has a log with a numeric cost", () => {
    const d = decideCost({ ...base, turnLogs: oneTurn([{ cost: 0.001 }, { cost: 0.002 }]) });
    expect(d.source).toBe("ai-gateway");
    expect(d.usd).toBeCloseTo(0.003);
    expect(d.note).toMatch(/AI Gateway's cost estimate/);
    expect(d.note).toMatch(/Not a billed cost/);
  });

  it("falls back to gateway tokens times list price when a log lacks cost", () => {
    const d = decideCost({ ...base, turnLogs: oneTurn([{ cost: 0.001, tokensIn: 500, tokensOut: 50 }, { tokensIn: 500, tokensOut: 50 }]) });
    expect(d).toMatchObject({ source: "gateway-tokens-x-list-price", logsFetched: 2, logsWithCost: 1 });
    expect(d.usd).toBeCloseTo(listPrice(1000, 100));
  });

  it("falls back to trace tokens when logs are missing, and for local runs", () => {
    expect(decideCost({ ...base, turnLogs: oneTurn([{ cost: 0.001 }]) }).source).toBe("trace-tokens-x-list-price");
    const local = decideCost({ ...base, turnLogs: null });
    expect(local).toMatchObject({ source: "trace-tokens-x-list-price", logsFetched: 0 });
    expect(local.note).toMatch(/Not a cost incurred/);
  });

  it("requires every turn's own calls to have logs: extra logs in one turn cannot hide a missing one in another", () => {
    const d = decideCost({
      ...base,
      llmCalls: 4,
      turnLogs: [
        { turnId: "t1", llmCalls: 2, logs: [{ cost: 0.001 }, { cost: 0.001 }, { cost: 0.001 }] },
        { turnId: "t2", llmCalls: 2, logs: [{ cost: 0.001 }] },
      ],
    });
    expect(d.source).toBe("trace-tokens-x-list-price");
    expect(d.logsFetched).toBe(4);
  });
});

const row = (over: Partial<CaseResult>): CaseResult => ({
  id: "x",
  category: "policy_answerable",
  persona: "tenured_employee",
  question: "q",
  httpStatus: 200,
  kind: "answer",
  passed: true,
  reasons: [],
  leak: false,
  infrastructureError: false,
  latencyMs: 100,
  citations: [],
  ...over,
});

describe("abort rules", () => {
  it("aborts above 5% errors after at least 40 cases", () => {
    const ok = Array.from({ length: 37 }, (_, i) => row({ id: `a${i}` }));
    const bad = Array.from({ length: 3 }, (_, i) => row({ id: `b${i}`, infrastructureError: true }));
    expect(abortReason([...ok, ...bad])).toMatch(/error rate 7.5%/);
    expect(abortReason(bad)).toBeNull();
    expect(abortReason([...ok, ...ok, ...bad])).toBeNull();
  });

  it("aborts above 5 zero-passage answerable cases", () => {
    const zero = Array.from({ length: 6 }, (_, i) =>
      row({ id: `z${i}`, trace: { llmProvider: "p", model: "m", totalMs: 1, routerMs: 1, retrievalReturned: 0, inputTokens: 1, outputTokens: 1, llmCalls: 1, invalidCitationsDropped: 0, gatewayLogIdHints: [] } }),
    );
    expect(abortReason(zero)).toMatch(/retrieved zero passages/);
    expect(abortReason(zero.slice(0, 5))).toBeNull();
  });

  it("stops a concurrency 2 run when the rule fires, although the other worker's case completes afterwards", async () => {
    const meta = JSON.parse(readFileSync(join(repo, "evals/dataset/asof-2026-10-01/meta.json"), "utf8")) as DatasetMeta;
    const template = readFileSync(join(repo, "evals/dataset/asof-2026-10-01/cases.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as EvalCase)
      .find((c) => c.category === "action_request" && c.expected.type === "tool" && c.expected.tool === "list_orientation_sessions");
    expect(template).toBeDefined();
    const cases = Array.from({ length: 100 }, (_, i) => ({ ...(template as EvalCase), id: `x-${String(i + 1).padStart(3, "0")}` }));
    const personas = PERSONA_KEYS.map((key, i) => ({ key, employeeId: `E${String(9000 + i)}`, email: `${key}@example.test` }));

    // Every /messages request waits until the driver below answers it, so the completion order is exact.
    const inFlight: Array<(res: Response) => void> = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fakeFetch = async (input: string): Promise<Response> => {
      const path = new URL(input).pathname;
      if (path === "/dev/personas") return json({ personas });
      if (path === "/dev/token") return json({ token: "t", expiresAt: "2026-10-01T01:00:00Z" });
      if (path === "/api/health") {
        return json({ ok: true, authMode: "dev", llmProvider: "stub", model: "fake", retriever: "d1-fts", asOf: meta.asOf, version: "1", datasetSha256: meta.datasetSha256 });
      }
      if (path === "/api/tickets") return json({ tickets: [] });
      if (path === "/api/orientation-sessions") return json({ sessions: [] });
      if (path === "/api/conversations") return json({ id: crypto.randomUUID() }, 201);
      if (path.endsWith("/messages")) return new Promise<Response>((resolve) => inFlight.push(resolve));
      return json({}, 404);
    };
    const okTurn = () =>
      json({
        turnId: crypto.randomUUID(),
        conversationId: "c",
        kind: "tool_result",
        text: "Sessions listed.",
        citations: [],
        toolCall: { tool: "list_orientation_sessions", arguments: {}, status: "ok" },
        toolResult: { sessions: [] },
        trace: {
          asOf: meta.asOf,
          llmProvider: "stub",
          model: "fake",
          totalMs: 1,
          router: { intent: "tool_call", ms: 1, inputTokens: 1, outputTokens: 1, retries: 0 },
          gatewayLogIdHints: [],
        },
      });

    let done = 0;
    let finished = false;
    const run = runEval({
      fetch: fakeFetch,
      baseUrl: "http://localhost:8782",
      runId: "abort-test",
      command: "test",
      gitSha: "0000000",
      cases,
      dataset: meta,
      auth: { kind: "dev" },
      concurrency: 2,
      listPrice: () => 0,
      listPriceModel: "m",
      onProgress: (n) => {
        done = n;
      },
    }).finally(() => {
      finished = true;
    });
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 20_000 && !cond(); i++) await new Promise((r) => setImmediate(r));
      if (!cond()) throw new Error("the runner stalled");
    };

    // The 1st, 2nd and 59th completed cases fail: 3 errors in 59 cases is 5.08%, over the 5% limit,
    // while the other worker still has a case in flight. Counted at 60 cases, 3 errors is exactly 5%.
    let completed = 0;
    for (;;) {
      await until(() => finished || inFlight.length >= (completed < 59 ? 2 : 1));
      if (finished) break;
      const respond = inFlight.shift() as (res: Response) => void;
      const n = completed + 1;
      respond(n === 1 || n === 2 || n === 59 ? json({ error: { code: "internal", message: "x", requestId: "r" } }, 500) : okTurn());
      await until(() => done >= n);
      completed = n;
    }
    const { summary: s, results } = await run;
    expect(results.filter((r) => r.infrastructureError)).toHaveLength(3);
    expect(s.aborted?.reason).toMatch(/error rate 5.1% exceeds 5% after 59 cases/);
    expect(s.cases.run).toBe(60);
    expect(s.cases.total).toBe(100);
  });
});

function summary(over: Partial<Summary> = {}): Summary {
  const results: CaseResult[] = [
    row({ id: "ans-001", passed: true }),
    row({ id: "out-001", category: "outdated_document", passed: false, reasons: ["missing_value"] }),
    row({ id: "act-001", category: "action_request", kind: "tool_result", toolSelected: true, argsMatched: true }),
    row({ id: "una-001", category: "unauthorized", kind: "refuse" }),
  ];
  const s = buildSummary({
    runId: "local-qwen3-1.7b-2026-10-08",
    startedAt: "2026-10-08T10:00:00.000Z",
    finishedAt: "2026-10-08T10:30:00.000Z",
    command: "npm run eval -- --base-url http://localhost:8782 --run-id local-qwen3-1.7b-2026-10-08",
    server: {
      baseUrl: "http://localhost:8782",
      authMode: "dev",
      llmProvider: "openai-compatible",
      model: "qwen3-1.7b-q4_0",
      retriever: "d1-fts",
      asOf: "2026-10-01",
      version: "1.0.0",
      gitSha: "abc123def4567890",
      datasetSha256: "6dea5cee",
    },
    totalCases: 4,
    concurrency: 1,
    results,
    writesWithoutApproval: 0,
    cost: decideCost({ llmCalls: 0, turnLogs: null, traceTokens: { input: 0, output: 0 }, model: "m", listPrice }),
  });
  return { ...s, ...over };
}

describe("summary and README writer", () => {
  it("builds a schema-valid summary with both metrics and their definitions", () => {
    const s = summary();
    expect(() => SummarySchema.parse(s)).not.toThrow();
    expect(s.groundedAnswerAccuracy).toMatchObject({ passed: 1, total: 2, rate: 0.5, definition: GROUNDED_DEFINITION });
    expect(s.overallPassRate).toMatchObject({ passed: 3, total: 4, definition: OVERALL_DEFINITION });
    expect(s.failures).toEqual([{ id: "out-001", category: "outdated_document", reasons: ["missing_value"] }]);
  });

  it("writes numbers equal to summary.json and both definitions", () => {
    const s = summary();
    const block = renderReadmeResults(s);
    expect(block).toContain("| groundedAnswerAccuracy | 50.0% (1/2)");
    expect(block).toContain("| overallPassRate | 75.0% (3/4)");
    expect(block).toContain(GROUNDED_DEFINITION);
    expect(block).toContain(OVERALL_DEFINITION);
    expect(block).toContain("qwen3-1.7b-q4_0");
    expect(block).toContain(s.command);
    // finishedAt is an ISO timestamp in UTC, so the printed date is labeled as a UTC date.
    expect(block).toContain("finished 2026-10-08 (UTC)");
    expect(block).toContain("target is 90%");
    // Citation precision counts only answer turns of the grounded categories; the label says so.
    expect(block).toContain(
      "| Citation precision (answer turns in the 2 policy_answerable and outdated_document cases; a citation is precise when it names an expected document version) |",
    );
    expect(block).toContain("fabricated labels dropped by the validator (all turns) |");
    expect(block).not.toMatch(/\u2014/);
    const readme = `# x\n${README_START}\nNo eval run recorded yet.\n${README_END}\nend\n`;
    const updated = replaceResultsBlock(readme, block);
    expect(updated).toContain(block);
    expect(updated).not.toContain("No eval run recorded yet.");
    expect(updated.endsWith(`${README_END}\nend\n`)).toBe(true);
  });

  it("refuses stub providers, aborted runs and partial runs", () => {
    const base = summary();
    expect(() => renderReadmeResults({ ...base, server: { ...base.server, llmProvider: "stub" } })).toThrow(ReadmeRefusal);
    expect(() => renderReadmeResults({ ...base, server: { ...base.server, llmProvider: "adversarial-stub" } })).toThrow(ReadmeRefusal);
    expect(() => renderReadmeResults({ ...base, aborted: { reason: "error rate" } })).toThrow(ReadmeRefusal);
    expect(() => renderReadmeResults({ ...base, cases: { ...base.cases, run: 3 } })).toThrow(ReadmeRefusal);
  });
});

describe("gateway log collection", () => {
  it("prefers REST, falls back to the binding route, and gives up at the deadline", async () => {
    const turns = [
      { conversationId: "c1", turnId: "t1", persona: "p", llmCalls: 2 },
      { conversationId: "c2", turnId: "t2", persona: "p", llmCalls: 2 },
    ];
    const logs = await collectGatewayLogs(
      turns,
      {
        rest: async (turnId) => (turnId === "t1" ? [{ cost: 1 }, { cost: 2 }] : []),
        binding: async (t) => (t.turnId === "t2" ? [{ tokensIn: 5 }] : []),
      },
      { deadlineMs: 0, sleep: async () => undefined },
    );
    expect(logs).toEqual([
      { turnId: "t1", llmCalls: 2, logs: [{ cost: 1 }, { cost: 2 }] },
      { turnId: "t2", llmCalls: 2, logs: [{ tokensIn: 5 }] },
    ]);
    expect(await collectGatewayLogs(turns, {}, { deadlineMs: 0 })).toBeNull();
  });
});
