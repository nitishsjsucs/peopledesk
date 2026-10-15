// npm run eval -- --base-url URL --run-id ID [--concurrency 2] [--dataset evals/dataset/asof-<date>]
//                 [--auth dev|service-tokens] [--gateway-report] [--limit N] [--sample N] [--max-neurons N]
// Local: --auth dev logs each persona in through /dev/token (dev mode only).
// Production: --auth service-tokens reads PEOPLEDESK_SERVICE_TOKENS, a JSON object
// { "<persona>": { "clientId": "...", "clientSecret": "..." } } of Access service tokens linked to the
// personas, or else the file npm run setup:production writes (~/.config/peopledesk/service-tokens.json).
// --gateway-report reads AI Gateway logs (CF_API_TOKEN with AI Gateway Read for the REST reader; the
// account id comes from wrangler.jsonc; AI_GATEWAY_ID default "peopledesk").
// Workers Free plan budget (README, Workers Free plan): --sample N runs a deterministic stratified
// sample of N cases, and --max-neurons N stops before a case once the run's model tokens, at Workers AI
// neuron rates, plus one more case at the run's largest so far, would pass N. Both make a partial run,
// which eval:readme refuses to publish. Production default: --sample 20 --max-neurons 2000.
// A 429 from the server's CHAT_RATE_LIMITS is waited out (Retry-After), not counted as an error.
// Writes evals/results/<runId>/{results.jsonl, summary.json, summary.md}.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { PersonaKey } from "../src/shared/domain.ts";
import type { EvalCase } from "../src/shared/synth/eval-cases.ts";
import type { Org } from "../src/shared/synth/org.ts";
import { listPriceUsd, neurons, REFERENCE_MODEL } from "../src/worker/llm/pricing.ts";
import { PROD, readServiceTokens } from "../scripts/lib/production.ts";
import { bindingRouteReader, collectGatewayLogs, restReader } from "./lib/gateway.ts";
import { renderSummaryMarkdown, SummarySchema } from "./lib/report.ts";
import type { DatasetMeta, RunnerAuth } from "./lib/runner.ts";
import { runEval } from "./lib/runner.ts";
import { stratifiedSample } from "./lib/sample.ts";

const repo = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    "run-id": { type: "string" },
    concurrency: { type: "string", default: "2" },
    dataset: { type: "string" },
    auth: { type: "string", default: "dev" },
    "gateway-report": { type: "boolean", default: false },
    limit: { type: "string" },
    sample: { type: "string" },
    "max-neurons": { type: "string" },
  },
});
const baseUrl = values["base-url"];
const runId = values["run-id"];
if (!baseUrl || !runId || !/^[\w.-]{1,64}$/.test(runId)) {
  console.error("usage: npm run eval -- --base-url URL --run-id ID (letters, digits, . _ -)");
  process.exit(2);
}

const datasetDir = resolve(values.dataset ?? join(repo, "evals/dataset/asof-2026-10-01"));
const meta = JSON.parse(readFileSync(join(datasetDir, "meta.json"), "utf8")) as DatasetMeta;
let cases = readFileSync(join(datasetDir, "cases.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as EvalCase);
const datasetSize = cases.length;
if (values.limit) cases = cases.slice(0, Number(values.limit));
if (values.sample) cases = stratifiedSample(cases, Number(values.sample));
const maxNeurons = values["max-neurons"] ? Number(values["max-neurons"]) : null;
if (maxNeurons !== null && !(maxNeurons > 0)) {
  console.error("--max-neurons must be a positive number");
  process.exit(2);
}

let auth: RunnerAuth = { kind: "dev" };
if (values.auth === "service-tokens") {
  const tokens = (process.env["PEOPLEDESK_SERVICE_TOKENS"] ? JSON.parse(process.env["PEOPLEDESK_SERVICE_TOKENS"]) : readServiceTokens()) as Record<
    string,
    { clientId: string; clientSecret: string }
  >;
  const org = JSON.parse(readFileSync(join(repo, `data/generated/asof-${meta.asOf}/org.json`), "utf8")) as Org;
  auth = {
    kind: "headers",
    personas: org.personas.filter((p) => tokens[p.key]).map((p) => ({ key: p.key, employeeId: p.employeeId, email: p.email })),
    headersFor: (key: PersonaKey) => {
      const t = tokens[key];
      if (!t) throw new Error(`no service token for persona ${key}`);
      return { "CF-Access-Client-Id": t.clientId, "CF-Access-Client-Secret": t.clientSecret };
    },
  };
}

let gitSha = "unknown";
try {
  gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
} catch {
  // not a git checkout
}

const command = `npm run eval -- ${process.argv.slice(2).join(" ")}`;
const outDir = join(repo, "evals/results", runId);
if (existsSync(join(outDir, "summary.json"))) {
  console.error(`evals/results/${runId} already exists; choose a new --run-id`);
  process.exit(2);
}

const started = Date.now();
const neuronsOf = (r: { trace?: { inputTokens?: number; outputTokens?: number } }) => neurons(r.trace?.inputTokens ?? 0, r.trace?.outputTokens ?? 0, REFERENCE_MODEL);
const { summary, results, stopped } = await runEval({
  fetch: (input, init) => fetch(input, init),
  baseUrl,
  runId,
  command,
  gitSha,
  cases,
  datasetSize,
  dataset: meta,
  auth,
  concurrency: Number(values.concurrency),
  listPrice: (i, o) => listPriceUsd(i, o, REFERENCE_MODEL),
  listPriceModel: REFERENCE_MODEL,
  ...(maxNeurons !== null
    ? {
        stopBefore: (done) => {
          const spent = done.reduce((n, r) => n + neuronsOf(r), 0);
          const next = Math.max(100, ...done.map(neuronsOf));
          return spent + next > maxNeurons ? `budget: ${Math.round(spent)} neurons spent, the next case could pass --max-neurons ${maxNeurons}` : null;
        },
      }
    : {}),
  ...(values["gateway-report"]
    ? {
        gatewayLogs: (turns) => {
          const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"] ?? PROD.accountId;
          const apiToken = process.env["CF_API_TOKEN"];
          const gatewayId = process.env["AI_GATEWAY_ID"] ?? "peopledesk";
          return collectGatewayLogs(turns, {
            ...(accountId && apiToken ? { rest: restReader({ accountId, gatewayId, apiToken, fetch }) } : {}),
            ...(auth.kind === "headers"
              ? { binding: bindingRouteReader({ baseUrl, fetch, headersFor: (t) => (auth as Extract<RunnerAuth, { kind: "headers" }>).headersFor(t.persona as PersonaKey) }) }
              : {}),
          });
        },
      }
    : {}),
  onRateLimited: ({ persona, path, waitSeconds, scope }) => {
    const until = new Date(Date.now() + waitSeconds * 1000).toISOString();
    console.log(`rate limited (${scope ?? "unknown"} scope) on ${path.replace(/\/[0-9a-f-]{36}\//, "/:id/")} as ${persona}; waiting ${waitSeconds} s, until ${until}`);
  },
  onProgress: (done, total, last) => {
    const mark = last.passed ? "pass" : `FAIL ${last.reasons.join(",")}`;
    console.log(`[${done}/${total}] ${last.id} ${last.kind ?? "-"} ${last.latencyMs}ms ${mark}`);
  },
});

SummarySchema.parse(summary);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "results.jsonl"), `${results.map((r) => JSON.stringify(r)).join("\n")}\n`);
writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outDir, "summary.md"), renderSummaryMarkdown(summary));
console.log(
  JSON.stringify({
    runId,
    seconds: Math.round((Date.now() - started) / 1000),
    groundedAnswerAccuracy: summary.groundedAnswerAccuracy.rate,
    overallPassRate: summary.overallPassRate.rate,
    safety: summary.safety,
    aborted: summary.aborted ?? null,
    stopped,
    estimatedNeurons: Math.round(results.reduce((n, r) => n + neuronsOf(r), 0)),
    out: outDir,
  }),
);
if (summary.aborted) process.exit(1);
