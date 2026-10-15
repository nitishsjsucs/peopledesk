// npm run cpu:profile -- [--passes 3] [--cold 5] [--json <file>] [--cpuprofile <file>]
//
// Estimates the CPU time (not wall-clock time) of each Worker route and of a full chat turn, excluding
// awaited I/O, to check them against the Workers Free plan's 10 ms CPU limit per invocation (which
// also applies to each Durable Object invocation). Workers cannot measure their own CPU time locally
// (Date.now() only advances on I/O in workerd), so this runs the real Worker code in Node:
//
// - the production configuration from wrangler.jsonc env.production (access mode, Workers AI, AI
//   Search), with the dataset generated for today and the 200 eval cases generated from it;
// - the Hono app's own fetch for every Worker route, with a real RS256 Access JWT verified against a
//   remote JWKS (served by a stubbed global fetch on the first request, then cached as in production);
// - for a chat turn, the Durable Object side mirrors ConversationAgent.sendMessage: getConfig,
//   buildServices, runTurn (router, in-process MCP client and server, retrieval, permission gate,
//   chunk alignment, composer, citation validation) and the transcript JSON, plus a structured clone
//   for each RPC hop;
// - zod runs jitless, as in workerd, where code generation from strings is not allowed.
//
// Excluded as awaited I/O, by timing them and subtracting: D1 (node:sqlite stand-in), R2, AI Search
// (a fake that returns chunks of the policy files, about 1,000 characters each), and the model (the
// deterministic stub decides; the Workers AI provider's own request building and output parsing still
// run and count). What remains is synchronous JavaScript in the Worker or the Durable Object.
//
// Two measurements: warm (every eval case, --passes times, in one process: an isolate that has served
// requests before) and cold (--cold fresh processes per invocation kind, each measuring only its first
// invocation: an isolate's first request, with lazy initialization and unoptimized code).
//
// Caveats: Node is not workerd, and this Mac is not a Cloudflare server. Treat the numbers as an
// estimate with a safety factor; the production check is `npm run verify:production -- --cpu`.
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

// --- cloudflare:* modules for the agents package's imports (nothing here uses them at runtime).
const SHIM = [
  "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
  "export class RpcTarget {}",
  "export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
  "export class WorkflowEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
  "export class WorkflowEvent {}",
  "export class EmailMessage {}",
  "export const env = {};",
  "export const exports = {};",
  "export function waitUntil() {}",
].join("\n");
// Packages resolve as the Cloudflare Vite plugin bundles them for workerd: the "workerd", "worker",
// "module" and "browser" export conditions, never "node". This matters: under "workerd" the MCP SDK
// prepares its zod schemas at module load (preloadSchemas) and validates with @cfworker/json-schema
// instead of Ajv.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("cloudflare:")) return { url: `data:text/javascript,${encodeURIComponent(SHIM)}`, shortCircuit: true };
    const conditions = ["workerd", "worker", "module", "browser", ...(context.conditions ?? []).filter((c) => c !== "node" && c !== "node-addons")];
    return next(specifier, { ...context, conditions });
  },
});

const { values } = parseArgs({
  options: {
    passes: { type: "string", default: "3" },
    cold: { type: "string", default: "5" },
    "cold-child": { type: "string" },
    json: { type: "string" },
    cpuprofile: { type: "string" },
  },
});
const passes = Math.max(1, Number(values.passes));

const { z } = await import("zod");
z.config({ jitless: true });
// Startup: evaluating the Worker's module graph (index.ts imports the app and the Durable Object), which
// workerd does once per isolate under its own 1 s startup limit. Node also strips TypeScript and reads
// files here, so this overstates workerd's startup.
const startup0 = process.threadCpuUsage();
await import("../src/worker/index.ts");
const startupDelta = process.threadCpuUsage(startup0);
const startupMs = (startupDelta.user + startupDelta.system) / 1000;

/** A fixed pure-JavaScript workload, so runs on throttled or different machines can be compared. */
function referenceMs(): number {
  const c0 = process.threadCpuUsage();
  let h = 2166136261;
  for (let i = 0; i < 5_000_000; i++) h = Math.imul(h ^ (i & 0xff), 16777619) >>> 0;
  if (h === 42) console.log("");
  const d = process.threadCpuUsage(c0);
  return (d.user + d.system) / 1000;
}
const reference = [referenceMs(), referenceMs(), referenceMs()].sort((a, b) => a - b)[1] as number;
const { exportJWK, generateKeyPair, SignJWT } = await import("jose");
const { generateDataset } = await import("../src/shared/synth/dataset.ts");
const { generateEvalCases } = await import("../src/shared/synth/eval-cases.ts");
const { seedStatements } = await import("../src/shared/synth/seed-sql.ts");
const { r2PolicyObjects } = await import("../src/shared/synth/r2-objects.ts");
const { buildApp } = await import("../src/worker/app.ts");
const { getConfig } = await import("../src/worker/env.ts");
const { FixedClock } = await import("../src/worker/clock.ts");
const { buildServices } = await import("../src/worker/container.ts");
const { runTurn } = await import("../src/worker/chat/orchestrator.ts");
const { approvalOriginFor } = await import("../src/worker/mcp/route.ts");
const { StubProvider } = await import("../src/worker/llm/stub.ts");
const { WorkersAiProvider } = await import("../src/worker/llm/workers-ai.ts");
const { D1Fts5Retriever } = await import("../src/worker/policies/retriever-d1-fts.ts");
const { resolvePrincipal } = await import("../src/worker/auth/principal.ts");
const { NodeD1, threadCpuMs } = await import("./lib/node-d1.ts");
const { productionEnv, repo } = await import("./lib/cloudflare.ts");
type LlmProviderT = import("../src/worker/llm/provider.ts").LlmProvider;
type LlmRequestT<T> = import("../src/worker/llm/provider.ts").LlmRequest<T>;
type TurnResultT = import("../src/shared/api-types.ts").TurnResult;
type EvalCaseT = import("../src/shared/synth/eval-cases.ts").EvalCase;

// --- I/O meter: everything awaited in production runs inside it, and its CPU time is subtracted.
// CPU time is this thread's (process.threadCpuUsage), not wall-clock time, so machine load from other
// processes does not inflate it; the profile is single-threaded, so nothing else runs in between.
// Calls nest (the AI Search stand-in queries the D1 stand-in): only the outermost one is metered, and
// D1 statements made inside a stand-in are not counted as the Worker's D1 statements.
const io = { cpuMs: 0, d1Statements: 0, d1Calls: 0, depth: 0 };
const ioCall = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  if (io.depth > 0) return fn();
  const c0 = threadCpuMs();
  io.depth++;
  try {
    return await fn();
  } finally {
    io.depth--;
    io.cpuMs += threadCpuMs() - c0;
  }
};

// --- Dataset for today's business date (access mode uses the real clock).
const asOf = new Date().toISOString().slice(0, 10);
const { manifest, org, markdownFiles } = generateDataset(asOf);
const cases = generateEvalCases(manifest, org);
const db = new NodeD1(io);
db.migrate(join(repo, "migrations"));
db.db.exec("BEGIN");
for (const s of seedStatements(manifest, org)) db.db.prepare(s.sql).run(...s.params);
db.db.exec("COMMIT");
const markdown = new Map(markdownFiles.map((f) => [f.path, f.content]));
const r2Meta = new Map(r2PolicyObjects(manifest).map((o) => [o.key, o.customMetadata]));

const bucket = {
  get: (key: string) =>
    ioCall(() => {
      const body = markdown.get(key);
      return body === undefined ? null : { key, customMetadata: r2Meta.get(key), text: async () => body };
    }),
};

// AI Search stand-in: the D1 FTS5 retriever picks the documents (inside the I/O meter), and the result
// is returned as AI Search would: up to max_num_results chunks of about 1,000 characters (line
// boundaries, 10% overlap) from those versions' markdown files.
const chunkCache = new Map<string, string[]>();
function fileChunks(key: string): string[] {
  let out = chunkCache.get(key);
  if (out) return out;
  out = [];
  const lines = (markdown.get(key) ?? "").split("\n");
  let cur: string[] = [];
  let len = 0;
  for (const line of lines) {
    cur.push(line);
    len += line.length + 1;
    if (len >= 1000) {
      out.push(cur.join("\n"));
      const keep = cur.slice(-Math.max(1, Math.round(cur.length / 10)));
      cur = [...keep];
      len = keep.join("\n").length;
    }
  }
  if (cur.length) out.push(cur.join("\n"));
  chunkCache.set(key, out);
  return out;
}
const fts = new D1Fts5Retriever(db as unknown as D1Database);
const aiSearch = {
  search: (req: { query: string; ai_search_options: { retrieval: { max_num_results: number; filters: { audience_rank: { $lte: number } } } } }) =>
    ioCall(async () => {
      const r = req.ai_search_options.retrieval;
      const hits = await fts.search({ query: req.query, clearance: r.filters.audience_rank.$lte as 1 | 2 | 3, asOf, topK: r.max_num_results });
      const keys = [...new Set(hits.map((h) => h.sourceKey))];
      const chunks = keys.flatMap((key) => fileChunks(key).map((text, i) => ({ id: `${key}#${i}`, type: "text", score: 0.8, text, item: { key, metadata: {} } })));
      return { search_query: req.query, chunks: chunks.slice(0, r.max_num_results) };
    }),
};

// Model stand-in: the stub decides inside the I/O meter; the real Workers AI provider builds the
// request and parses the answer with zod, which is Worker CPU.
const stub = new StubProvider();
class BenchProvider implements LlmProviderT {
  readonly id = "workers-ai" as const;
  readonly model: string;
  constructor(model: string) {
    this.model = model;
  }
  completeJson<T>(req: LlmRequestT<T>) {
    const ai = {
      aiGatewayLogId: "bench-log",
      run: async (_model: string, inputs: Record<string, unknown>, options: Record<string, unknown>) => {
        structuredClone(inputs); // the binding serializes the request
        structuredClone(options);
        const r = await ioCall(() => stub.completeJson(req));
        return { response: r.value, usage: { prompt_tokens: r.usage.inputTokens, completion_tokens: r.usage.outputTokens } };
      },
    };
    return new WorkersAiProvider({ ai, model: this.model, gatewayId: "peopledesk" }).completeJson(req);
  }
}

// --- Production configuration, with a well-formed AUD and limits that never trip during the profile
// (the same number of rules as production, so the limiter does the same work).
const prod = productionEnv();
const teamDomain = prod.vars["ACCESS_TEAM_DOMAIN"] ?? "https://team.cloudflareaccess.com";
const appHost = prod.vars["APP_HOSTNAME"]?.startsWith("<") ? "peopledesk.example.workers.dev" : (prod.vars["APP_HOSTNAME"] as string);
const aud = "a".repeat(64);
const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
const kid = "bench-key";
const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" }] });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === `${teamDomain.replace(/\/+$/, "")}/cdn-cgi/access/certs`) {
    return ioCall(() => new Response(jwks, { headers: { "content-type": "application/json" } }));
  }
  return realFetch(input, init);
}) as typeof fetch;

const turnResults = new Map<string, TurnResultT>();
const agentNamespace = {
  idFromName: (name: string) => ({ name, toString: () => name }),
  get: (id: { name: string }) => ({
    __unsafe_ensureInitialized: () => ioCall(async () => undefined),
    sendMessage: async (input: { text: string }) => {
      structuredClone(input); // RPC serialization of the argument
      const result = turnResults.get(`${id.name}|${input.text}`);
      if (!result) throw new Error("no precomputed turn for this request");
      const out = await ioCall(async () => structuredClone(result)); // DO work and transport: measured separately
      return { ok: true, result: out };
    },
    getTranscript: async () => ioCall(async () => []),
    recordActionOutcome: async () => ioCall(async () => undefined),
  }),
};

const env: Record<string, unknown> = {
  ...prod.vars,
  ACCESS_TEAM_DOMAIN: teamDomain,
  ACCESS_AUD: aud,
  APP_HOSTNAME: appHost,
  CHAT_RATE_LIMITS: "user:1000000/60,user:1000000/86400,all:1000000/86400",
  DB: db,
  POLICY_BUCKET: bucket,
  POLICY_SEARCH: aiSearch,
  AI: { run: () => Promise.reject(new Error("not used")), aiGatewayLogId: null },
  CONVERSATION_AGENT: agentNamespace,
};
const cfgResult = getConfig(env);
if (!cfgResult.ok) throw new Error(`profile config invalid: ${cfgResult.issues.join("; ")}`);
const cfg = cfgResult.config;
const app = buildApp();
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} };

const tokens = new Map<string, string>();
const signingKey = privateKey;
async function tokenFor(email: string): Promise<string> {
  let t = tokens.get(email);
  if (!t) {
    const iat = Math.floor(Date.now() / 1000);
    t = await new SignJWT({ email, type: "app", identity_nonce: crypto.randomUUID(), country: "US" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(teamDomain)
      .setAudience([aud])
      .setSubject(crypto.randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(signingKey);
    tokens.set(email, t);
  }
  return t;
}

// --- Measurement.
type Sample = { cpuMs: number; d1Statements: number; d1Calls: number };
const samples = new Map<string, Sample[]>();
const statuses = new Map<string, Set<number>>();
async function measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const io0 = io.cpuMs;
  const s0 = io.d1Statements;
  const c0 = io.d1Calls;
  const t0 = threadCpuMs();
  const out = await fn();
  const cpu = threadCpuMs() - t0;
  const list = samples.get(name) ?? [];
  list.push({ cpuMs: Math.max(0, cpu - (io.cpuMs - io0)), d1Statements: io.d1Statements - s0, d1Calls: io.d1Calls - c0 });
  samples.set(name, list);
  return out;
}

async function call(name: string, email: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const headers = new Headers({ "Cf-Access-Jwt-Assertion": await tokenFor(email) });
  if (method === "POST") {
    headers.set("Origin", `https://${appHost}`);
    headers.set("Content-Type", "application/json");
  }
  // MCP Streamable HTTP clients accept both JSON and an event stream. workerd always has a Host header;
  // Node's Request does not add one until it is sent, and the MCP handler checks it.
  if (path === "/mcp") {
    headers.set("Accept", "application/json, text/event-stream");
    headers.set("Host", appHost);
  }
  const req = new Request(`https://${appHost}${path}`, { method, headers, ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}) });
  const out = await measure(name, async () => {
    const res = await app.fetch(req, env as unknown as Env, ctx as unknown as ExecutionContext);
    return { status: res.status, text: await res.text() }; // the response body is produced by the Worker
  });
  const seen = statuses.get(name) ?? new Set<number>();
  seen.add(out.status);
  statuses.set(name, seen);
  // A 403 or 404 is a normal answer for some personas (team view, onboarding); a 5xx or 429 is a bug here.
  if (out.status >= 500 || out.status === 429) throw new Error(`${name} answered ${out.status}: ${out.text.slice(0, 200)}`);
  return out;
}

const personas = org.personas;
const emailOf = (key: string) => personas.find((p) => p.key === key)?.email as string;
const provider = new BenchProvider(cfg.llm.model);

/** The Durable Object side of one turn, as ConversationAgent.sendMessage does it. */
let profiled = false;
async function doTurn(c: EvalCaseT, employeeEmail: string, conversationId: string): Promise<TurnResultT> {
  if (values.cpuprofile && !profiled) {
    // A V8 CPU profile of the first chat turn in this process (open it in Chrome DevTools).
    profiled = true;
    const { Session } = await import("node:inspector/promises");
    const session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 50 });
    await session.post("Profiler.start");
    try {
      return await doTurn(c, employeeEmail, conversationId);
    } finally {
      const { profile } = await session.post("Profiler.stop");
      writeFileSync(values.cpuprofile, JSON.stringify(profile));
      session.disconnect();
    }
  }
  const principal = await ioCall(() =>
    resolvePrincipal(db as unknown as D1Database, { kind: "user", email: employeeEmail, sub: "s", claims: {} }, { allowServiceTokens: false }),
  );
  const input = { principal, text: c.question, asOf, requestOrigin: `https://${appHost}` };
  return measure(`DO sendMessage (${c.category})`, async () => {
    const arg = structuredClone(input); // RPC arrival
    const conf = getConfig(env);
    if (!conf.ok) throw new Error("misconfigured");
    const clock = new FixedClock(arg.asOf);
    const services = buildServices(env as unknown as Env, conf.config, clock);
    const result = await runTurn(
      {
        provider,
        services,
        principal: arg.principal,
        conversationId,
        turnId: crypto.randomUUID(),
        asOf: arg.asOf,
        approvalOrigin: approvalOriginFor(conf.config, arg.requestOrigin),
        history: { userMessages: [], assistantTurns: [] },
      },
      arg.text,
    );
    // persist(): the transcript rows (SQL is I/O) and their JSON.
    JSON.stringify(result);
    JSON.stringify(result.trace);
    structuredClone(result); // RPC return
    return result;
  });
}

// --- Cold mode: one invocation in a fresh process. The child sets up exactly as above (none of that runs
// request code), then measures only the first invocation of its kind.
const COLD_KINDS = ["worker: POST /api/conversations/:id/messages", "worker: GET /api/policies", "DO: sendMessage (policy question)", "DO: sendMessage (tool call)"] as const;
if (values["cold-child"] !== undefined) {
  const kind = COLD_KINDS[Number(values["cold-child"])] as (typeof COLD_KINDS)[number];
  const tenured = personas.find((p) => p.key === "tenured_employee") as (typeof personas)[number];
  const pick = (pred: (c: EvalCaseT) => boolean) => cases.find((c) => c.persona === "tenured_employee" && pred(c)) as EvalCaseT;
  const convId = crypto.randomUUID();
  await ioCall(() =>
    db.prepare("INSERT INTO conversations (id, employee_id, title, created_at, updated_at) VALUES (?1, ?2, 'c', ?3, ?3)").bind(convId, tenured.employeeId, new Date().toISOString()).run(),
  );
  if (kind === "worker: POST /api/conversations/:id/messages") {
    const c = pick((x) => x.category === "policy_answerable");
    // A stored answer stands in for the Durable Object's reply (its CPU is measured separately).
    turnResults.set(`${tenured.employeeId}:${convId}|${c.question}`, {
      turnId: crypto.randomUUID(),
      conversationId: convId,
      kind: "answer",
      text: "Employees accrue 1.5 days of paid time off per month.\n\nSource: PTO Accrual (POL-014 v3, effective 2026-01-01).",
      citations: [
        { passageId: "POL-014@3#2", docId: "POL-014", version: 3, title: "PTO Accrual", section: "Policy", effectiveFrom: "2026-01-01", effectiveTo: null, sourceKey: "policies/r1-all/POL-014/v03.md", quote: "Employees accrue 1.5 days of paid time off per month of service." },
      ],
      trace: { asOf, llmProvider: "workers-ai", model: cfg.llm.model, totalMs: 2100, router: { intent: "policy_question", ms: 1200, inputTokens: 1400, outputTokens: 40, retries: 0 }, gatewayLogIdHints: [] },
    } as unknown as TurnResultT);
    await call(kind, tenured.email, "POST", `/api/conversations/${convId}/messages`, { text: c.question });
  } else if (kind === "worker: GET /api/policies") {
    await call(kind, tenured.email, "GET", "/api/policies");
  } else {
    const c = pick((x) => (kind === "DO: sendMessage (policy question)" ? x.category === "policy_answerable" : x.category === "action_request" && x.expected.type === "tool"));
    await doTurn(c, tenured.email, convId);
  }
  const first = [...samples.values()][0]?.[0] as Sample;
  console.log(JSON.stringify({ kind, cpuMs: first.cpuMs, d1Statements: first.d1Statements }));
  process.exit(0);
}

const coldRows: Array<{ kind: string; n: number; minMs: number; p50Ms: number; maxMs: number }> = [];
const coldRuns = Math.max(0, Number(values.cold));
if (coldRuns > 0) {
  const { execFileSync } = await import("node:child_process");
  for (let k = 0; k < COLD_KINDS.length; k++) {
    const xs: number[] = [];
    for (let i = 0; i < coldRuns; i++) {
      const out = execFileSync(process.execPath, [import.meta.filename, "--cold-child", String(k)], { encoding: "utf8" });
      xs.push((JSON.parse(out.trim().split("\n").pop() as string) as { cpuMs: number }).cpuMs);
    }
    xs.sort((a, b) => a - b);
    coldRows.push({ kind: COLD_KINDS[k] as string, n: xs.length, minMs: Number((xs[0] as number).toFixed(2)), p50Ms: Number((xs[Math.floor((xs.length - 1) / 2)] as number).toFixed(2)), maxMs: Number((xs[xs.length - 1] as number).toFixed(2)) });
  }
}

let pendingFlip = 0;
const turnKinds = new Map<string, number>();
const firsts = new Map<string, number>();
for (let pass = 0; pass < passes; pass++) {
  for (const c of cases) {
    const email = emailOf(c.persona);
    const created = await call("POST /api/conversations", email, "POST", "/api/conversations", {});
    const convId = (JSON.parse(created.text) as { id: string }).id;
    const employeeId = personas.find((p) => p.key === c.persona)?.employeeId as string;
    const result = await doTurn(c, email, convId);
    turnKinds.set(`${c.category}:${result.kind}`, (turnKinds.get(`${c.category}:${result.kind}`) ?? 0) + 1);
    turnResults.set(`${employeeId}:${convId}|${c.question}`, result);
    await call("POST /api/conversations/:id/messages (Worker side)", email, "POST", `/api/conversations/${convId}/messages`, { text: c.question });
    if (result.pendingAction) {
      const approve = pendingFlip++ % 2 === 0;
      if (approve) await call("POST /api/actions/:id/approve", email, "POST", `/api/actions/${result.pendingAction.actionId}/approve`, {});
      else await call("POST /api/actions/:id/reject", email, "POST", `/api/actions/${result.pendingAction.actionId}/reject`, {});
    }
  }
  // Read routes and the external MCP path, once per persona per pass.
  for (const p of personas) {
    const doc = manifest.documents.find((d) => d.rank === 1) as (typeof manifest.documents)[number];
    const v = doc.versions.find((x) => x.status === "current") as (typeof doc.versions)[number];
    await call("GET /api/health", p.email, "GET", "/api/health");
    await call("GET /api/me", p.email, "GET", "/api/me");
    await call("GET /api/conversations", p.email, "GET", "/api/conversations");
    await call("GET /api/policies", p.email, "GET", "/api/policies");
    await call("GET /api/policies/:docId", p.email, "GET", `/api/policies/${doc.docId}`);
    await call("GET /api/policies/:docId/versions/:v", p.email, "GET", `/api/policies/${doc.docId}/versions/${v.version}`);
    await call("GET /api/tickets", p.email, "GET", "/api/tickets");
    await call("GET /api/onboarding", p.email, "GET", "/api/onboarding");
    await call("GET /api/team", p.email, "GET", "/api/team");
    await call("GET /api/orientation-sessions", p.email, "GET", "/api/orientation-sessions");
    await call("GET /api/actions", p.email, "GET", "/api/actions");
    const proposed = await call("POST /api/actions (form propose)", p.email, "POST", "/api/actions", {
      tool: "create_support_ticket",
      arguments: { category: "it", subject: "Laptop will not boot", description: "My laptop shows a black screen after the logo." },
    });
    const view = JSON.parse(proposed.text) as { actionId?: string };
    if (view.actionId) await call("POST /api/actions/:id/reject", p.email, "POST", `/api/actions/${view.actionId}/reject`, {});
    const mcp = (name: string, body: unknown) =>
      call(name, p.email, "POST", "/mcp", body).catch((e: unknown) => {
        throw new Error(`${name}: ${String(e)}`);
      });
    await mcp("POST /mcp initialize", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bench", version: "1" } } });
    await mcp("POST /mcp tools/list", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await mcp("POST /mcp tools/call search_policies", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search_policies", arguments: { query: "How many days of paid time off do I accrue?", topK: 6 } },
    });
  }
  if (pass === 0) for (const [name, list] of samples) firsts.set(name, (list[0] as Sample).cpuMs);
}

// --- Report.
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const i = (s.length - 1) * (p / 100);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (i - lo);
};
const rows = [...samples.entries()].map(([name, list]) => {
  const cpu = list.map((x) => x.cpuMs);
  return {
    name,
    n: list.length,
    firstMs: Number((firsts.get(name) ?? 0).toFixed(2)),
    p50Ms: Number(pct(cpu, 50).toFixed(2)),
    p95Ms: Number(pct(cpu, 95).toFixed(2)),
    maxMs: Number(Math.max(...cpu).toFixed(2)),
    d1StatementsMax: Math.max(...list.map((x) => x.d1Statements)),
    d1CallsMax: Math.max(...list.map((x) => x.d1Calls)),
    statuses: [...(statuses.get(name) ?? [])].sort(),
  };
});
rows.sort((a, b) => b.p95Ms - a.p95Ms);
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  asOf,
  passes,
  cases: cases.length,
  config: { llm: cfg.llm.model, retriever: cfg.retriever, authMode: cfg.authMode },
  startupMs: Number(startupMs.toFixed(1)),
  referenceWorkloadMs: Number(reference.toFixed(2)),
  note: "Main-thread CPU ms (process.threadCpuUsage) excluding awaited I/O (D1, R2, AI Search, model, RPC transport); first = first call in this process (cold JIT and caches).",
  turnKinds: Object.fromEntries([...turnKinds.entries()].sort()),
  rows,
  cold: coldRows,
};
console.log(`Reference workload (5M FNV-1a steps, for comparing machines and power states): ${reference.toFixed(2)} ms CPU`);
console.log(`Startup (module graph evaluation, includes Node's TypeScript stripping): ${startupMs.toFixed(1)} ms CPU`);
console.log(`CPU per invocation, ms (asOf ${asOf}, ${passes} passes over ${cases.length} cases, ${process.version} on ${process.platform} ${process.arch})`);
console.log("route".padEnd(58), "n".padStart(5), "first".padStart(7), "p50".padStart(7), "p95".padStart(7), "max".padStart(7), "D1 stmts".padStart(9));
for (const r of rows) {
  console.log(
    r.name.padEnd(58),
    String(r.n).padStart(5),
    r.firstMs.toFixed(2).padStart(7),
    r.p50Ms.toFixed(2).padStart(7),
    r.p95Ms.toFixed(2).padStart(7),
    r.maxMs.toFixed(2).padStart(7),
    String(r.d1StatementsMax).padStart(9),
    r.statuses.length ? `  HTTP ${r.statuses.join("/")}` : "",
  );
}
console.log("turn kinds (category:kind):", JSON.stringify(report.turnKinds));
if (coldRows.length) {
  console.log(`\nCold: the first invocation in a fresh process, ${coldRuns} processes each, ms`);
  console.log("invocation".padEnd(58), "n".padStart(5), "min".padStart(7), "p50".padStart(7), "max".padStart(7));
  for (const r of coldRows) {
    console.log(r.kind.padEnd(58), String(r.n).padStart(5), r.minMs.toFixed(2).padStart(7), r.p50Ms.toFixed(2).padStart(7), r.maxMs.toFixed(2).padStart(7));
  }
}
if (values.json) writeFileSync(values.json, `${JSON.stringify(report, null, 2)}\n`);
