// npm run eval -- --base-url URL --run-id ID [--concurrency 2] [--dataset evals/dataset/asof-<date>]
//                 [--auth dev|service-tokens] [--gateway-report] [--limit N]
// Local: --auth dev logs each persona in through /dev/token (dev mode only).
// Production: --auth service-tokens reads PEOPLEDESK_SERVICE_TOKENS, a JSON object
// { "<persona>": { "clientId": "...", "clientSecret": "..." } } of Access service tokens linked to the
// personas, and --gateway-report reads AI Gateway logs (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN with
// AI Gateway Read, AI_GATEWAY_ID default "peopledesk").
// Writes evals/results/<runId>/{results.jsonl, summary.json, summary.md}.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { PersonaKey } from "../src/shared/domain.ts";
import type { EvalCase } from "../src/shared/synth/eval-cases.ts";
import type { Org } from "../src/shared/synth/org.ts";
import { listPriceUsd, REFERENCE_MODEL } from "../src/worker/llm/pricing.ts";
import { bindingRouteReader, collectGatewayLogs, restReader } from "./lib/gateway.ts";
import { renderSummaryMarkdown, SummarySchema } from "./lib/report.ts";
import type { DatasetMeta, RunnerAuth } from "./lib/runner.ts";
import { runEval } from "./lib/runner.ts";

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

let auth: RunnerAuth = { kind: "dev" };
if (values.auth === "service-tokens") {
  const tokens = JSON.parse(process.env["PEOPLEDESK_SERVICE_TOKENS"] ?? "{}") as Record<string, { clientId: string; clientSecret: string }>;
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
const { summary, results } = await runEval({
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
  ...(values["gateway-report"]
    ? {
        gatewayLogs: (turns) => {
          const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
          const apiToken = process.env["CLOUDFLARE_API_TOKEN"];
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
    out: outDir,
  }),
);
if (summary.aborted) process.exit(1);
