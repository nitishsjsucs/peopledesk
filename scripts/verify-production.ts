// npm run verify:production -- [--cpu] [--chat N] [--tail-seconds S] [--analytics] [--since-hours H]
//
// Checks the deployed Worker at https://<APP_HOSTNAME> through Cloudflare Access, with the persona
// service tokens npm run setup:production saved (~/.config/peopledesk/service-tokens.json):
//   - without credentials, Access stops the request (redirect to the team domain);
//   - with a service token the Worker answers: 200 with the business date and dataset hash during an
//     eval window (npm run deploy:eval-window), 403 forbidden otherwise (service tokens cannot sign in
//     to the app), never 500;
//   - --chat N (eval window only) sends N chat turns as the tenured employee persona. Each turn spends
//     about 66 Workers AI neurons and counts against CHAT_RATE_LIMITS; N is capped at 5.
//
// CPU time in production (the Workers Free plan allows 10 ms per invocation):
//   --cpu       runs `wrangler tail --format json` (OAuth login, no extra token permission) while the
//               checks above run, plus --tail-seconds more seconds (default 20) for traffic you create
//               yourself, for example chat turns in the browser. Every tail event carries the
//               invocation's cpuTime and wallTime in ms; Worker requests and Durable Object calls are
//               reported apart, with p50, p95, max and how many exceeded 10 ms or ended exceededCpu.
//   --analytics reads the GraphQL Analytics API for the last --since-hours (default 24): Worker
//               invocations' cpuTimeP50 and cpuTimeP99 (workersInvocationsAdaptive) and Durable Object
//               CPU time (durableObjectsPeriodicGroups). Needs CF_API_TOKEN with Account Analytics Read.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { repo } from "./lib/cloudflare.ts";
import { PROD, readServiceTokens } from "./lib/production.ts";

const { values } = parseArgs({
  options: {
    cpu: { type: "boolean", default: false },
    chat: { type: "string", default: "0" },
    "tail-seconds": { type: "string", default: "20" },
    analytics: { type: "boolean", default: false },
    "since-hours": { type: "string", default: "24" },
  },
});
const chatTurns = Math.min(5, Math.max(0, Number(values.chat) || 0));
const base = `https://${PROD.hostname}`;
const results: Array<{ check: string; ok: boolean; detail: string }> = [];
const record = (check: string, ok: boolean, detail: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${check}: ${detail}`);
};

// --- wrangler tail, started first so it sees the probes.
type TailEvent = {
  outcome?: string;
  cpuTime?: number;
  wallTime?: number;
  executionModel?: string;
  entrypoint?: string;
  event?: { request?: { url?: string; method?: string }; rpcMethod?: string } | null;
};
const events: TailEvent[] = [];
let tail: ReturnType<typeof spawn> | null = null;
if (values.cpu) {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "true", CLOUDFLARE_ACCOUNT_ID: PROD.accountId };
  delete env["CLOUDFLARE_API_TOKEN"];
  delete env["CF_API_TOKEN"];
  tail = spawn(join(repo, "node_modules/.bin/wrangler"), ["tail", PROD.workerName, "--format", "json"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
  let buf = "";
  tail.stdout?.setEncoding("utf8");
  tail.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    // wrangler prints one pretty-printed JSON object per event; split on top-level object boundaries.
    for (;;) {
      const start = buf.indexOf("{");
      if (start < 0) return;
      let depth = 0;
      let inStr = false;
      let end = -1;
      for (let i = start; i < buf.length; i++) {
        const ch = buf[i];
        if (inStr) {
          if (ch === "\\") i++;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) {
          end = i;
          break;
        }
      }
      if (end < 0) return;
      try {
        events.push(JSON.parse(buf.slice(start, end + 1)) as TailEvent);
      } catch {
        // not an event
      }
      buf = buf.slice(end + 1);
    }
  });
  console.log("Waiting 10 s for wrangler tail to connect...");
  await new Promise((r) => setTimeout(r, 10_000));
}

// --- Probes.
try {
  const res = await fetch(`${base}/api/health`, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  record("Access stops unauthenticated requests", (res.status === 302 || res.status === 303) && location.startsWith(PROD.teamDomain), `HTTP ${res.status}${location ? ` to ${new URL(location).host}` : ""}`);
} catch (err) {
  record("Access stops unauthenticated requests", false, String(err));
}

const token = readServiceTokens().tenured_employee;
let windowOpen = false;
if (!token) {
  record("service token reaches the Worker", false, "no saved service token secret (npm run setup:production)");
} else {
  const headers = { "CF-Access-Client-Id": token.clientId, "CF-Access-Client-Secret": token.clientSecret };
  const res = await fetch(`${base}/api/health`, { headers, redirect: "manual" });
  const body = (await res.json().catch(() => null)) as { error?: { code?: string }; asOf?: string; datasetSha256?: string | null; model?: string; retriever?: string } | null;
  windowOpen = res.status === 200;
  record(
    "service token reaches the Worker",
    res.status === 200 || (res.status === 403 && body?.error?.code === "forbidden"),
    res.status === 200
      ? `200 (eval window open): ${body?.model}, ${body?.retriever}, business date ${body?.asOf}, dataset ${body?.datasetSha256?.slice(0, 12) ?? "none"}`
      : `HTTP ${res.status} ${body?.error?.code ?? ""}${res.status === 403 ? " (service tokens are off outside an eval window, as configured)" : ""}`,
  );
  if (chatTurns > 0) {
    if (!windowOpen) record("chat turns", false, "--chat needs an eval window (npm run deploy:eval-window)");
    else {
      const post = (path: string, payload: unknown) =>
        fetch(`${base}${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json", origin: base }, body: JSON.stringify(payload) });
      const questions = ["How many days of paid time off do I accrue each month?", "Show my open support tickets.", "What is the meal per diem for business travel?", "Which orientation sessions are coming up?", "How much leave carries over to next year?"];
      for (let i = 0; i < chatTurns; i++) {
        const conv = await post("/api/conversations", {});
        const { id } = (await conv.json()) as { id: string };
        const t0 = Date.now();
        const turn = await post(`/api/conversations/${id}/messages`, { text: questions[i % questions.length] });
        const body = (await turn.json().catch(() => null)) as { kind?: string; error?: { code?: string } } | null;
        record(`chat turn ${i + 1}`, turn.status === 200 && body?.kind !== "error", `HTTP ${turn.status}, kind ${body?.kind ?? body?.error?.code ?? "?"}, ${Date.now() - t0} ms wall`);
      }
    }
  }
}

// --- CPU from the tail.
if (tail) {
  const extra = Math.max(0, Number(values["tail-seconds"]) || 0);
  if (extra > 0) {
    console.log(`Tailing ${extra} s more; requests you make now (for example chat turns in the browser) are measured too.`);
    await new Promise((r) => setTimeout(r, extra * 1000));
  } else await new Promise((r) => setTimeout(r, 5000));
  tail.kill("SIGINT");
  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] as number) : 0;
  };
  const groups = new Map<string, TailEvent[]>();
  for (const e of events) {
    if (typeof e.cpuTime !== "number") continue;
    const req = e.event?.request;
    const key =
      e.executionModel === "durableObject"
        ? `Durable Object ${e.event?.rpcMethod ?? e.entrypoint ?? ""}`.trim()
        : req?.url
          ? `${req.method ?? "GET"} ${new URL(req.url).pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/g, "/:id")}`
          : "other";
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }
  console.log(`\nCPU time per invocation from wrangler tail (${events.length} events), ms`);
  console.log("invocation".padEnd(50), "n".padStart(4), "p50".padStart(7), "p95".padStart(7), "max".padStart(7), ">10ms".padStart(6), "exceededCpu".padStart(12));
  let over = 0;
  for (const [key, list] of [...groups.entries()].sort()) {
    const cpu = list.map((e) => e.cpuTime as number);
    const n10 = cpu.filter((x) => x > 10).length;
    const exceeded = list.filter((e) => e.outcome === "exceededCpu").length;
    over += exceeded;
    console.log(key.padEnd(50), String(list.length).padStart(4), pct(cpu, 50).toFixed(1).padStart(7), pct(cpu, 95).toFixed(1).padStart(7), Math.max(...cpu).toFixed(1).padStart(7), String(n10).padStart(6), String(exceeded).padStart(12));
  }
  record("no invocation ended exceededCpu", over === 0, events.length ? `${over} of ${events.length}` : "no tail events seen (is wrangler logged in?)");
}

// --- CPU from the GraphQL Analytics API.
if (values.analytics) {
  const hours = Math.max(1, Number(values["since-hours"]) || 24);
  const until = new Date();
  const since = new Date(until.getTime() - hours * 3_600_000);
  // Two queries, so the Worker numbers still print if the Durable Object dataset's schema changes.
  // The Durable Object filter follows the example in the Durable Objects metrics docs (date_gt).
  const workerQuery = `query ($account: String!, $script: String!, $since: Time!, $until: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 100, filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }) {
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
        dimensions { status }
      }
    } } }`;
  const doQuery = `query ($account: String!, $day: Date!) {
    viewer { accounts(filter: { accountTag: $account }) {
      durableObjectsPeriodicGroups(limit: 100, filter: { date_gt: $day }) {
        sum { cpuTime activeTime }
        dimensions { namespaceId }
      }
    } } }`;
  const gql = async (query: string, variables: Record<string, string>) => {
    const token = process.env["CF_API_TOKEN"];
    if (!token) throw new Error("CF_API_TOKEN is not set");
    // The GraphQL endpoint answers { data, errors }, not the REST { result } envelope.
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = (await res.json()) as { data?: { viewer: { accounts: Array<Record<string, unknown>> } } | null; errors?: Array<{ message: string }> | null };
    if (json.errors?.length || !json.data) throw new Error(json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`);
    return json.data.viewer.accounts[0] ?? {};
  };
  try {
    const acct = await gql(workerQuery, { account: PROD.accountId, script: PROD.workerName, since: since.toISOString(), until: until.toISOString() });
    const inv = (acct["workersInvocationsAdaptive"] ?? []) as Array<{ sum: { requests: number; errors: number }; quantiles: { cpuTimeP50: number; cpuTimeP99: number }; dimensions: { status: string } }>;
    console.log(`\nWorker ${PROD.workerName}, last ${hours} h (GraphQL workersInvocationsAdaptive; cpuTime in microseconds)`);
    for (const r of inv) console.log(`  status ${r.dimensions.status}: ${r.sum.requests} requests, ${r.sum.errors} errors, cpuTime p50 ${(r.quantiles.cpuTimeP50 / 1000).toFixed(2)} ms, p99 ${(r.quantiles.cpuTimeP99 / 1000).toFixed(2)} ms`);
    const doAcct = await gql(doQuery, { account: PROD.accountId, day: new Date(since.getTime() - 86_400_000).toISOString().slice(0, 10) }).catch((err: unknown) => {
      console.log(`  Durable Object CPU: ${String((err as Error).message)}`);
      return {} as Record<string, unknown>;
    });
    const dos = (doAcct["durableObjectsPeriodicGroups"] ?? []) as Array<{ sum: { cpuTime: number; activeTime: number }; dimensions: { namespaceId: string } }>;
    for (const r of dos) console.log(`  Durable Object namespace ${r.dimensions.namespaceId}: cpuTime ${(r.sum.cpuTime / 1000).toFixed(1)} ms in total, activeTime ${(r.sum.activeTime / 1000).toFixed(1)} ms (units as the API reports them, read as microseconds)`);
    const p99 = Math.max(0, ...inv.map((r) => r.quantiles.cpuTimeP99 / 1000));
    record("Worker cpuTime p99 under 10 ms", inv.length > 0 && p99 < 10, inv.length ? `p99 ${p99.toFixed(2)} ms` : "no invocations in the window");
  } catch (err) {
    record("GraphQL analytics", false, `${String((err as Error).message)} (CF_API_TOKEN needs Account Analytics Read)`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.map((r) => r.check) }));
process.exit(failed.length ? 1 : 0);
