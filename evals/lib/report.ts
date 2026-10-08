// summary.json (zod-validated), summary.md, the cost-source decision, abort rules, and the README
// Results block. update-readme refuses stub providers, aborted runs and partial runs.
import { z } from "zod";
import { EVAL_CATEGORIES } from "../../src/shared/synth/eval-cases.ts";
import type { EvalCategory } from "../../src/shared/synth/eval-cases.ts";
import { distribution, wilson } from "./stats.ts";

// ---------------------------------------------------------------------------------------------------
// Per-case results (results.jsonl)

export type CaseResult = {
  id: string;
  category: EvalCategory;
  persona: string;
  question: string;
  httpStatus: number | null;
  kind: string | null;
  passed: boolean;
  reasons: string[];
  leak: boolean;
  infrastructureError: boolean;
  errorCode?: string;
  toolSelected?: boolean;
  argsMatched?: boolean;
  /** Client-measured wall time for the message POST. */
  latencyMs: number;
  turnId?: string;
  conversationId?: string;
  answer?: string;
  citations: Array<{ docId: string; version: number; passageId: string; expected: boolean }>;
  pendingActionId?: string;
  pendingActionTarget?: string;
  pendingActionRejected?: boolean;
  trace?: {
    llmProvider: string;
    model: string;
    totalMs: number;
    routerMs: number;
    retrievalMs?: number;
    retrievalReturned?: number;
    toolMs?: number;
    composerMs?: number;
    inputTokens: number;
    outputTokens: number;
    llmCalls: number;
    invalidCitationsDropped: number;
    gatewayLogIdHints: string[];
  };
};

// ---------------------------------------------------------------------------------------------------
// Summary

const RateSchema = z.object({
  passed: z.number().int(),
  total: z.number().int(),
  rate: z.number(),
  ci95: z.tuple([z.number(), z.number()]),
  definition: z.string(),
});
const DistributionSchema = z.object({ p50: z.number(), p95: z.number(), max: z.number(), n: z.number().int() });
export const COST_SOURCES = ["ai-gateway", "gateway-tokens-x-list-price", "trace-tokens-x-list-price"] as const;

export const SummarySchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  command: z.string(),
  aborted: z.object({ reason: z.string() }).optional(),
  server: z.object({
    baseUrl: z.string(),
    authMode: z.string(),
    llmProvider: z.string(),
    model: z.string(),
    retriever: z.string(),
    asOf: z.string(),
    version: z.string(),
    gitSha: z.string(),
    datasetSha256: z.string(),
  }),
  cases: z.object({ total: z.number().int(), run: z.number().int(), concurrency: z.number().int() }),
  groundedAnswerAccuracy: RateSchema,
  overallPassRate: RateSchema,
  byCategory: z.record(z.string(), z.object({ passed: z.number().int(), total: z.number().int(), rate: z.number() })),
  citation: z.object({
    citedPassages: z.number().int(),
    validCitations: z.number().int(),
    precision: z.number(),
    invalidCitationsDroppedByValidator: z.number().int(),
  }),
  safety: z.object({
    unauthorizedLeaks: z.number().int(),
    writesWithoutApproval: z.number().int(),
    pendingActionsForForbiddenTargets: z.number().int(),
  }),
  infrastructure: z.object({
    errorTurns: z.record(z.string(), z.number().int()),
    httpErrors: z.number().int(),
    providerTimeouts: z.number().int(),
    errorRate: z.number(),
  }),
  retrievalHealth: z.object({ zeroPassageAnswerableCases: z.number().int(), retrievalUnavailable: z.number().int() }),
  actions: z.object({ total: z.number().int(), toolSelectionAccuracy: z.number(), argumentAccuracy: z.number() }),
  latencyMs: z.object({
    turn: DistributionSchema,
    router: DistributionSchema,
    retrieval: DistributionSchema,
    tool: DistributionSchema,
    composer: DistributionSchema,
  }),
  tokens: z.object({
    inputTotal: z.number().int(),
    outputTotal: z.number().int(),
    inputMeanPerCase: z.number(),
    outputMeanPerCase: z.number(),
  }),
  cost: z.object({
    source: z.enum(COST_SOURCES),
    usd: z.number(),
    model: z.string(),
    llmCalls: z.number().int(),
    logsFetched: z.number().int(),
    logsWithCost: z.number().int(),
    note: z.string(),
  }),
  failures: z.array(z.object({ id: z.string(), category: z.string(), reasons: z.array(z.string()) })),
});
export type Summary = z.infer<typeof SummarySchema>;

export const GROUNDED_DEFINITION =
  "Share of the 95 policy_answerable and outdated_document cases answered with kind answer, containing every expected " +
  "value, citing the current version of the right document, citing no superseded or scheduled version, with at least " +
  "one cited passage that contains every expected value, and not a number dump.";
export const OVERALL_DEFINITION =
  "Passed cases over all 200 cases. It includes 55 action cases and 30 unauthorized cases whose pass depends largely on " +
  "deterministic server checks, so it is not a grounding metric.";

// ---------------------------------------------------------------------------------------------------
// Cost source decision (SPEC section 11)

export type GatewayLogSample = { cost?: number; tokensIn?: number; tokensOut?: number };

export type CostInputs = {
  llmCalls: number;
  /** Logs fetched from AI Gateway (REST or binding), one per call found; null for local runs. */
  logs: GatewayLogSample[] | null;
  traceTokens: { input: number; output: number };
  model: string;
  listPrice: (input: number, output: number) => number;
};

export function decideCost(i: CostInputs): Summary["cost"] {
  const logs = i.logs ?? [];
  const logsFetched = logs.length;
  const logsWithCost = logs.filter((l) => typeof l.cost === "number").length;
  const allFetched = i.logs !== null && i.llmCalls > 0 && logsFetched >= i.llmCalls;
  if (allFetched && logsWithCost === logsFetched) {
    return {
      source: "ai-gateway",
      usd: logs.reduce((s, l) => s + (l.cost ?? 0), 0),
      model: i.model,
      llmCalls: i.llmCalls,
      logsFetched,
      logsWithCost,
      note: "AI Gateway's cost estimate (based on token counts), summed over every call of the run. Not a billed cost.",
    };
  }
  if (allFetched) {
    const input = logs.reduce((s, l) => s + (l.tokensIn ?? 0), 0);
    const output = logs.reduce((s, l) => s + (l.tokensOut ?? 0), 0);
    return {
      source: "gateway-tokens-x-list-price",
      usd: i.listPrice(input, output),
      model: i.model,
      llmCalls: i.llmCalls,
      logsFetched,
      logsWithCost,
      note: "Token counts from AI Gateway logs times the Workers AI list price (some logs had no cost). An estimate.",
    };
  }
  return {
    source: "trace-tokens-x-list-price",
    usd: i.listPrice(i.traceTokens.input, i.traceTokens.output),
    model: i.model,
    llmCalls: i.llmCalls,
    logsFetched,
    logsWithCost,
    note:
      "Estimate: this run's token volume (as reported by the model server) at the Workers AI list price of " +
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast. Not a cost incurred.",
  };
}

// ---------------------------------------------------------------------------------------------------
// Abort rules

export const ABORT_MIN_CASES = 40;
export const ABORT_MAX_ERROR_RATE = 0.05;
export const ABORT_MAX_ZERO_PASSAGE_ANSWERABLE = 5;

export function abortReason(results: readonly CaseResult[]): string | null {
  const errors = results.filter((r) => r.infrastructureError).length;
  if (results.length >= ABORT_MIN_CASES && errors / results.length > ABORT_MAX_ERROR_RATE) {
    return `error rate ${(errors / results.length * 100).toFixed(1)}% exceeds ${ABORT_MAX_ERROR_RATE * 100}% after ${results.length} cases`;
  }
  const zero = zeroPassageAnswerable(results);
  if (zero > ABORT_MAX_ZERO_PASSAGE_ANSWERABLE) {
    return `${zero} answerable or outdated cases retrieved zero passages (more than ${ABORT_MAX_ZERO_PASSAGE_ANSWERABLE}): the index or a filter is broken`;
  }
  return null;
}

function zeroPassageAnswerable(results: readonly CaseResult[]): number {
  return results.filter(
    (r) =>
      (r.category === "policy_answerable" || r.category === "outdated_document") &&
      !r.infrastructureError &&
      r.trace !== undefined &&
      r.trace.retrievalReturned === 0,
  ).length;
}

// ---------------------------------------------------------------------------------------------------
// Building the summary

export type SummaryInputs = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  command: string;
  server: Summary["server"];
  totalCases: number;
  concurrency: number;
  results: CaseResult[];
  writesWithoutApproval: number;
  cost: Summary["cost"];
  aborted?: string | null;
};

const rate = (passed: number, total: number, definition: string) => {
  const w = wilson(passed, total);
  return { passed, total, rate: w.rate, ci95: [w.low, w.high] as [number, number], definition };
};

export function buildSummary(i: SummaryInputs): Summary {
  const r = i.results;
  const grounded = r.filter((x) => x.category === "policy_answerable" || x.category === "outdated_document");
  const byCategory: Summary["byCategory"] = {};
  for (const c of EVAL_CATEGORIES) {
    const rows = r.filter((x) => x.category === c);
    const passed = rows.filter((x) => x.passed).length;
    byCategory[c] = { passed, total: rows.length, rate: rows.length ? passed / rows.length : 0 };
  }
  const answerCitations = grounded.flatMap((x) => (x.kind === "answer" ? x.citations : []));
  const errorTurns: Record<string, number> = {};
  for (const x of r.filter((y) => y.infrastructureError && y.errorCode)) errorTurns[x.errorCode as string] = (errorTurns[x.errorCode as string] ?? 0) + 1;
  const actions = r.filter((x) => x.category === "action_request");
  const traces = r.map((x) => x.trace).filter((t): t is NonNullable<CaseResult["trace"]> => t !== undefined);
  const inputTotal = traces.reduce((s, t) => s + t.inputTokens, 0);
  const outputTotal = traces.reduce((s, t) => s + t.outputTokens, 0);
  return {
    runId: i.runId,
    startedAt: i.startedAt,
    finishedAt: i.finishedAt,
    command: i.command,
    ...(i.aborted ? { aborted: { reason: i.aborted } } : {}),
    server: i.server,
    cases: { total: i.totalCases, run: r.length, concurrency: i.concurrency },
    groundedAnswerAccuracy: rate(grounded.filter((x) => x.passed).length, grounded.length, GROUNDED_DEFINITION),
    overallPassRate: rate(r.filter((x) => x.passed).length, r.length, OVERALL_DEFINITION),
    byCategory,
    citation: {
      citedPassages: answerCitations.length,
      validCitations: answerCitations.filter((c) => c.expected).length,
      precision: answerCitations.length ? answerCitations.filter((c) => c.expected).length / answerCitations.length : 0,
      invalidCitationsDroppedByValidator: traces.reduce((s, t) => s + t.invalidCitationsDropped, 0),
    },
    safety: {
      unauthorizedLeaks: r.filter((x) => x.leak).length,
      writesWithoutApproval: i.writesWithoutApproval,
      pendingActionsForForbiddenTargets: r.filter((x) => x.reasons.includes("pending_action_for_forbidden_target")).length,
    },
    infrastructure: {
      errorTurns,
      httpErrors: r.filter((x) => x.httpStatus !== null && x.httpStatus >= 400).length + r.filter((x) => x.httpStatus === null).length,
      providerTimeouts: r.filter((x) => x.errorCode === "turn_timeout").length,
      errorRate: r.length ? r.filter((x) => x.infrastructureError).length / r.length : 0,
    },
    retrievalHealth: {
      zeroPassageAnswerableCases: zeroPassageAnswerable(r),
      retrievalUnavailable: r.filter((x) => x.errorCode === "retrieval_unavailable").length,
    },
    actions: {
      total: actions.length,
      toolSelectionAccuracy: actions.length ? actions.filter((x) => x.toolSelected).length / actions.length : 0,
      argumentAccuracy: actions.length ? actions.filter((x) => x.argsMatched).length / actions.length : 0,
    },
    latencyMs: {
      turn: distribution(r.filter((x) => !x.infrastructureError).map((x) => x.latencyMs)),
      router: distribution(traces.map((t) => t.routerMs)),
      retrieval: distribution(traces.flatMap((t) => (t.retrievalMs === undefined ? [] : [t.retrievalMs]))),
      tool: distribution(traces.flatMap((t) => (t.toolMs === undefined ? [] : [t.toolMs]))),
      composer: distribution(traces.flatMap((t) => (t.composerMs === undefined ? [] : [t.composerMs]))),
    },
    tokens: {
      inputTotal,
      outputTotal,
      inputMeanPerCase: r.length ? Math.round((inputTotal / r.length) * 10) / 10 : 0,
      outputMeanPerCase: r.length ? Math.round((outputTotal / r.length) * 10) / 10 : 0,
    },
    cost: i.cost,
    failures: r.filter((x) => !x.passed).map((x) => ({ id: x.id, category: x.category, reasons: x.reasons })),
  };
}

// ---------------------------------------------------------------------------------------------------
// Rendering

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x < 0.01 ? x.toFixed(5) : x.toFixed(4)}`;
const dist = (d: z.infer<typeof DistributionSchema>) => (d.n ? `p50 ${d.p50} ms, p95 ${d.p95} ms, max ${d.max} ms` : "not measured");

export function renderSummaryMarkdown(s: Summary): string {
  const lines = [
    `# Eval run ${s.runId}`,
    "",
    `- Server: ${s.server.baseUrl} (auth ${s.server.authMode}, provider ${s.server.llmProvider}, model ${s.server.model}, retriever ${s.server.retriever})`,
    `- Business date ${s.server.asOf}, dataset ${s.server.datasetSha256.slice(0, 12)}, git ${s.server.gitSha.slice(0, 12)}`,
    `- Started ${s.startedAt}, finished ${s.finishedAt}, ${s.cases.run} of ${s.cases.total} cases, concurrency ${s.cases.concurrency}`,
    `- Command: \`${s.command}\``,
    ...(s.aborted ? [`- ABORTED: ${s.aborted.reason}`] : []),
    "",
    ...metricsTable(s),
    "",
    "## Failures",
    "",
    ...(s.failures.length ? s.failures.map((f) => `- ${f.id} (${f.category}): ${f.reasons.join(", ")}`) : ["None."]),
    "",
  ];
  return lines.join("\n");
}

function metricsTable(s: Summary): string[] {
  const g = s.groundedAnswerAccuracy;
  const o = s.overallPassRate;
  return [
    "| Metric | Value |",
    "|---|---|",
    `| groundedAnswerAccuracy | ${pct(g.rate)} (${g.passed}/${g.total}), 95% CI ${pct(g.ci95[0])} to ${pct(g.ci95[1])} |`,
    `| overallPassRate | ${pct(o.rate)} (${o.passed}/${o.total}), 95% CI ${pct(o.ci95[0])} to ${pct(o.ci95[1])} |`,
    ...EVAL_CATEGORIES.map((c) => {
      const b = s.byCategory[c] ?? { passed: 0, total: 0, rate: 0 };
      return `| ${c} | ${pct(b.rate)} (${b.passed}/${b.total}) |`;
    }),
    `| Citation precision (answer turns) | ${pct(s.citation.precision)} (${s.citation.validCitations}/${s.citation.citedPassages}); ${s.citation.invalidCitationsDroppedByValidator} fabricated labels dropped by the validator |`,
    `| Action tool selection / arguments | ${pct(s.actions.toolSelectionAccuracy)} / ${pct(s.actions.argumentAccuracy)} of ${s.actions.total} |`,
    `| Safety: unauthorized leaks | ${s.safety.unauthorizedLeaks} |`,
    `| Safety: writes without approval | ${s.safety.writesWithoutApproval} |`,
    `| Safety: pending actions for forbidden targets | ${s.safety.pendingActionsForForbiddenTargets} |`,
    `| Infrastructure errors | ${Object.values(s.infrastructure.errorTurns).reduce((a, b) => a + b, 0)} error turns, ${s.infrastructure.httpErrors} HTTP errors (error rate ${pct(s.infrastructure.errorRate)}) |`,
    `| Zero-passage answerable cases | ${s.retrievalHealth.zeroPassageAnswerableCases} |`,
    `| Turn latency (client) | ${dist(s.latencyMs.turn)} |`,
    `| Router / retrieval / composer latency | ${dist(s.latencyMs.router)} / ${dist(s.latencyMs.retrieval)} / ${dist(s.latencyMs.composer)} |`,
    `| Tokens | ${s.tokens.inputTotal} in, ${s.tokens.outputTotal} out (${s.tokens.inputMeanPerCase} / ${s.tokens.outputMeanPerCase} per case) |`,
    `| Cost | ${usd(s.cost.usd)} for ${s.cost.llmCalls} model calls; source \`${s.cost.source}\`: ${s.cost.note} |`,
  ];
}

export class ReadmeRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadmeRefusal";
  }
}

/** The README Results block. Only numbers from the given summary.json; refuses runs that must not be quoted. */
export function renderReadmeResults(s: Summary): string {
  if (s.server.llmProvider === "stub" || s.server.llmProvider === "adversarial-stub") {
    throw new ReadmeRefusal(`refusing to publish a ${s.server.llmProvider} run: test providers are not results`);
  }
  if (s.aborted) throw new ReadmeRefusal(`refusing to publish an aborted run (${s.aborted.reason})`);
  if (s.cases.run !== s.cases.total) throw new ReadmeRefusal(`refusing to publish a partial run (${s.cases.run} of ${s.cases.total} cases)`);
  return [
    `Run \`${s.runId}\`, finished ${s.finishedAt.slice(0, 10)}, produced by \`${s.command}\`.`,
    `Server: provider \`${s.server.llmProvider}\`, model \`${s.server.model}\`, retriever \`${s.server.retriever}\`, auth ${s.server.authMode}, business date ${s.server.asOf}, git \`${s.server.gitSha.slice(0, 12)}\`.`,
    "",
    ...metricsTable(s),
    "",
    `- **groundedAnswerAccuracy**: ${GROUNDED_DEFINITION}`,
    `- **overallPassRate**: ${OVERALL_DEFINITION}`,
    "- The design target is 90% groundedAnswerAccuracy. The number above is what this run measured.",
    "",
    `Full report: \`evals/results/${s.runId}/summary.md\`; raw numbers: \`evals/results/${s.runId}/summary.json\`.`,
  ].join("\n");
}

export const README_START = "<!-- results:start -->";
export const README_END = "<!-- results:end -->";

export function replaceResultsBlock(readme: string, block: string): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end === -1 || end < start) throw new Error("README has no results markers");
  return `${readme.slice(0, start + README_START.length)}\n${block}\n${readme.slice(end)}`;
}
