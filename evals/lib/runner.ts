// Platform-agnostic eval runner: it takes a fetch function, so the same code runs under Node (npm run
// eval) and inside the Workers test pool (the in-pool smoke test, with SELF.fetch). Every POST carries
// Origin and Content-Type, because requireSameOrigin guards conversations, messages and reject.
// The runner never approves anything: it rejects every pending action a case created, so per-user
// rate limits do not leak across cases, and any increase in tickets or booked seats over the run is a
// write without approval. A 429 rate_limited from CHAT_RATE_LIMITS is the server's own limit, not an
// infrastructure error: the runner waits for Retry-After and sends the same request again, so on the
// Workers Free plan a production run pauses at the account-wide daily budget and resumes after 00:00
// UTC. Latency counts only the attempt that was answered.
import { HealthSchema, TurnResultSchema } from "../../src/shared/api-types.ts";
import type { Health, TurnResult } from "../../src/shared/api-types.ts";
import type { PersonaKey } from "../../src/shared/domain.ts";
import type { EvalCase } from "../../src/shared/synth/eval-cases.ts";
import type { CaseResult, Summary, TurnLogs } from "./report.ts";
import { abortReason, buildSummary, decideCost } from "./report.ts";
import { scoreCase } from "./scorer.ts";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type PersonaInfo = { key: PersonaKey; employeeId: string; email: string };

/** How the runner authenticates as each persona. */
export type RunnerAuth =
  | { kind: "dev" }
  | { kind: "headers"; headersFor: (persona: PersonaKey) => Record<string, string>; personas: PersonaInfo[] };

export type DatasetMeta = { asOf: string; validFrom: string; validUntil: string; datasetSha256: string };

export type RunOptions = {
  fetch: FetchFn;
  baseUrl: string;
  runId: string;
  command: string;
  gitSha: string;
  cases: EvalCase[];
  /** Size of the full dataset (a --limit run is partial, and update-readme refuses partial runs). */
  datasetSize?: number;
  dataset: DatasetMeta;
  auth: RunnerAuth;
  concurrency?: number;
  /** Cost model: list price for the reference model. */
  listPrice: (input: number, output: number) => number;
  listPriceModel: string;
  /** Production only: fetch AI Gateway logs for the run's turns after it finishes. */
  gatewayLogs?: (turns: Array<{ conversationId: string; turnId: string; persona: PersonaKey; llmCalls: number }>) => Promise<TurnLogs[] | null>;
  onProgress?: (done: number, total: number, last: CaseResult) => void;
  /**
   * Checked before each case starts: a reason stops the run there (a budget cap), and the cases already
   * run are graded as a partial run. Not an abort: nothing failed.
   */
  stopBefore?: (results: readonly CaseResult[]) => string | null;
  /** Called before each wait for a 429's Retry-After. */
  onRateLimited?: (info: { persona: PersonaKey; path: string; waitSeconds: number; scope: string | null }) => void;
  /** Longest total wait for one request before its 429 counts as an error (default 26 hours). */
  maxRateLimitWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

/** Retry-After in seconds from the header, else from the error details, else 60. */
export async function retryAfterOf(res: Response): Promise<{ seconds: number; scope: string | null }> {
  let details: { retryAfterSeconds?: unknown; scope?: unknown } | undefined;
  try {
    details = ((await res.json()) as { error?: { details?: typeof details } }).error?.details;
  } catch {
    details = undefined;
  }
  const header = Number(res.headers.get("retry-after"));
  const fromDetails = Number(details?.retryAfterSeconds);
  const seconds = Number.isFinite(header) && header > 0 ? header : Number.isFinite(fromDetails) && fromDetails > 0 ? fromDetails : 60;
  return { seconds: Math.min(seconds, 7 * 86_400), scope: typeof details?.scope === "string" ? details.scope : null };
}

export class RunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunnerError";
  }
}

export async function runEval(o: RunOptions): Promise<{ summary: Summary; results: CaseResult[]; stopped: string | null }> {
  const now = o.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const origin = new URL(o.baseUrl).origin;
  const url = (path: string) => `${origin}${path}`;

  // --- Authentication per persona.
  const headers: Partial<Record<PersonaKey, Record<string, string>>> = {};
  let personas: PersonaInfo[];
  if (o.auth.kind === "dev") {
    const res = await o.fetch(url("/dev/personas"));
    if (!res.ok) throw new RunnerError(`GET /dev/personas answered ${res.status}; is the server in dev mode?`);
    personas = ((await res.json()) as { personas: PersonaInfo[] }).personas;
    for (const p of personas) {
      const tokenRes = await o.fetch(url("/dev/token"), {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ email: p.email }),
      });
      if (!tokenRes.ok) throw new RunnerError(`POST /dev/token for ${p.key} answered ${tokenRes.status}`);
      headers[p.key] = { "Cf-Access-Jwt-Assertion": ((await tokenRes.json()) as { token: string }).token };
    }
  } else {
    personas = o.auth.personas;
    for (const p of personas) headers[p.key] = o.auth.headersFor(p.key);
  }
  const personaInfo = (key: PersonaKey): PersonaInfo => {
    const p = personas.find((x) => x.key === key);
    if (!p) throw new RunnerError(`persona ${key} is not available on the server`);
    return p;
  };
  const get = (key: PersonaKey, path: string) => o.fetch(url(path), { headers: headers[key] ?? {} });
  const post = (key: PersonaKey, path: string, body: unknown, extra: Record<string, string> = {}) =>
    o.fetch(url(path), {
      method: "POST",
      headers: { ...headers[key], Origin: origin, "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });

  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxWaitMs = o.maxRateLimitWaitMs ?? 26 * 3_600_000;
  /** POST, waiting out 429 rate_limited answers. Returns the answered attempt and its latency. */
  const postPatiently = async (key: PersonaKey, path: string, body: unknown, extra: Record<string, string> = {}) => {
    let waitedMs = 0;
    for (;;) {
      const t0 = Date.now();
      const res = await post(key, path, body, extra);
      const ms = Date.now() - t0;
      if (res.status !== 429) return { res, ms };
      const { seconds, scope } = await retryAfterOf(res);
      // One extra second so the retry lands inside the next window.
      const waitMs = seconds * 1000 + 1000;
      if (waitedMs + waitMs > maxWaitMs) return { res, ms };
      o.onRateLimited?.({ persona: key, path, waitSeconds: seconds, scope });
      await sleep(waitMs);
      waitedMs += waitMs;
    }
  };

  // --- Server identity and dataset check (abort before grading a mismatched server).
  const firstPersona = personas[0]?.key ?? "tenured_employee";
  const healthRes = await get(firstPersona, "/api/health");
  if (!healthRes.ok) throw new RunnerError(`GET /api/health answered ${healthRes.status}`);
  const health: Health = HealthSchema.parse(await healthRes.json());
  const server: Summary["server"] = {
    baseUrl: origin,
    authMode: health.authMode,
    llmProvider: health.llmProvider,
    model: health.model,
    retriever: health.retriever,
    asOf: health.asOf,
    version: health.version,
    gitSha: o.gitSha,
    datasetSha256: health.datasetSha256 ?? "none",
  };
  let datasetProblem: string | null = null;
  if (health.datasetSha256 !== o.dataset.datasetSha256) {
    datasetProblem = `server dataset ${health.datasetSha256} does not match the cases' dataset ${o.dataset.datasetSha256}`;
  } else if (!(health.asOf >= o.dataset.validFrom && health.asOf < o.dataset.validUntil)) {
    datasetProblem = `server business date ${health.asOf} is outside the dataset window [${o.dataset.validFrom}, ${o.dataset.validUntil})`;
  }

  // --- Write counters at run start.
  const counters = async () => {
    let tickets = 0;
    for (const p of personas) {
      const r = await get(p.key, "/api/tickets");
      tickets += ((await r.json()) as { tickets: unknown[] }).tickets.length;
    }
    const s = await get(firstPersona, "/api/orientation-sessions?from=2000-01-01&to=2100-01-01");
    const sessions = ((await s.json()) as { sessions: Array<{ capacity: number; seatsRemaining: number }> }).sessions;
    return { tickets, seats: sessions.reduce((n, x) => n + (x.capacity - x.seatsRemaining), 0) };
  };
  const before = datasetProblem ? { tickets: 0, seats: 0 } : await counters();

  // --- Cases, with a small concurrency pool.
  const results: CaseResult[] = [];
  let aborted: string | null = datasetProblem;
  const queue = datasetProblem ? [] : [...o.cases];
  const runOne = async (c: EvalCase): Promise<CaseResult> => {
    const p = personaInfo(c.persona);
    const base: CaseResult = {
      id: c.id,
      category: c.category,
      persona: c.persona,
      question: c.question,
      httpStatus: null,
      kind: null,
      passed: false,
      reasons: [],
      leak: false,
      infrastructureError: true,
      latencyMs: 0,
      citations: [],
    };
    let turn: TurnResult | null = null;
    try {
      const { res: conv } = await postPatiently(c.persona, "/api/conversations", {});
      if (!conv.ok) return { ...base, httpStatus: conv.status, reasons: ["infrastructure_error", `create_conversation_${conv.status}`] };
      const { id } = (await conv.json()) as { id: string };
      const { res, ms } = await postPatiently(c.persona, `/api/conversations/${id}/messages`, { text: c.question }, {
        "X-PeopleDesk-Eval": `${o.runId}:${c.id}`,
      });
      base.latencyMs = ms;
      base.httpStatus = res.status;
      base.conversationId = id;
      if (!res.ok) return { ...base, reasons: ["infrastructure_error", `http_${res.status}`] };
      turn = TurnResultSchema.parse(await res.json());
    } catch (err) {
      return { ...base, reasons: ["infrastructure_error", String((err as Error)?.message ?? err).slice(0, 120)] };
    }
    const score = scoreCase(c, turn, p.employeeId);
    const expectedRefs = c.expected.type === "answer" ? c.expected.mustCiteAnyOf : [];
    const t = turn.trace;
    const result: CaseResult = {
      ...base,
      kind: turn.kind,
      passed: score.passed,
      reasons: score.reasons,
      leak: score.leak,
      infrastructureError: score.infrastructureError,
      ...(turn.error ? { errorCode: turn.error.code } : {}),
      ...(score.toolSelected !== undefined ? { toolSelected: score.toolSelected } : {}),
      ...(score.argsMatched !== undefined ? { argsMatched: score.argsMatched } : {}),
      turnId: turn.turnId,
      answer: turn.text.slice(0, 600),
      citations: turn.citations.map((x) => ({
        docId: x.docId,
        version: x.version,
        passageId: x.passageId,
        expected: expectedRefs.some((r) => r.docId === x.docId && r.version === x.version),
      })),
      ...(score.pendingActionId ? { pendingActionId: score.pendingActionId, pendingActionTarget: score.pendingActionTarget } : {}),
      trace: {
        llmProvider: t.llmProvider,
        model: t.model,
        totalMs: t.totalMs,
        routerMs: t.router.ms,
        ...(t.retrieval ? { retrievalMs: t.retrieval.ms, retrievalReturned: t.retrieval.returned } : {}),
        ...(t.tool ? { toolMs: t.tool.ms } : {}),
        ...(t.composer ? { composerMs: t.composer.ms } : {}),
        inputTokens: t.router.inputTokens + (t.composer?.inputTokens ?? 0),
        outputTokens: t.router.outputTokens + (t.composer?.outputTokens ?? 0),
        llmCalls: (t.router.intent === "approval_guard" ? 0 : 1 + t.router.retries) + (t.composer ? 1 + t.composer.retries : 0),
        invalidCitationsDropped: t.composer?.invalidCitationsDropped ?? 0,
        gatewayLogIdHints: t.gatewayLogIdHints,
      },
    };
    // Never approve: reject whatever this case proposed.
    if (score.pendingActionId) {
      const rej = await post(c.persona, `/api/actions/${score.pendingActionId}/reject`, {});
      result.pendingActionRejected = rej.ok;
    }
    return result;
  };

  const concurrency = Math.max(1, o.concurrency ?? 2);
  let stopped: string | null = null;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0 && !aborted && !stopped) {
      stopped = o.stopBefore?.(results) ?? null;
      if (stopped) break;
      const c = queue.shift() as EvalCase;
      const r = await runOne(c);
      results.push(r);
      o.onProgress?.(results.length, o.cases.length, r);
      // Sticky: once a rule fires, a case still in flight on another worker is recorded but cannot
      // clear the decision (more successes would dilute the error rate below the threshold).
      aborted = aborted ?? abortReason(results);
    }
  });
  await Promise.all(workers);
  results.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // --- Write counters at run end: any increase is a write without approval.
  const after = datasetProblem ? before : await counters();
  const writesWithoutApproval = Math.max(0, after.tickets - before.tickets) + Math.max(0, after.seats - before.seats);

  // --- Cost (AI Gateway logs only in production with --gateway-report).
  const llmCalls = results.reduce((n, r) => n + (r.trace?.llmCalls ?? 0), 0);
  const turnLogs = o.gatewayLogs
    ? await o.gatewayLogs(
        results
          .filter((r) => r.turnId && r.conversationId)
          .map((r) => ({
            conversationId: r.conversationId as string,
            turnId: r.turnId as string,
            persona: r.persona as PersonaKey,
            llmCalls: r.trace?.llmCalls ?? 0,
          })),
      )
    : null;
  const cost = decideCost({
    llmCalls,
    turnLogs,
    traceTokens: {
      input: results.reduce((n, r) => n + (r.trace?.inputTokens ?? 0), 0),
      output: results.reduce((n, r) => n + (r.trace?.outputTokens ?? 0), 0),
    },
    model: o.listPriceModel,
    listPrice: o.listPrice,
  });

  const summary = buildSummary({
    runId: o.runId,
    startedAt,
    finishedAt: now().toISOString(),
    command: o.command,
    server,
    totalCases: o.datasetSize ?? o.cases.length,
    concurrency,
    results,
    writesWithoutApproval,
    cost,
    aborted,
  });
  return { summary, results, stopped };
}
