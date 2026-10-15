// npm run verify:ai-search -- --as-of YYYY-MM-DD
// Production check of the AI Search instance (needs `npx wrangler login`): triggers a sync job, waits for
// indexing, then verifies that the metadata filters PolicyRetriever relies on actually work:
//   - per clearance 1, 2 and 3, a known answerable query (a fact in a document of exactly that rank)
//     returns at least one chunk from that document;
//   - a rank 3 fact queried with clearance 1 returns no rank 2 or rank 3 chunk;
//   - superseded and scheduled versions are excluded at the dataset's business date;
//   - item.metadata contains audience_rank (did R2 customMetadata reach the index?);
//   - with return_on_failure false, an invalid filter throws instead of returning an empty list.
// It prints which retrieval mode is usable: custom metadata, or the folder-range fallback.
// During an eval window (npm run deploy:eval-window) it also calls search_policies on the deployed
// Worker's /mcp as the employee and HR admin personas' service tokens, so the whole production path
// (Access, the Worker's JWT check, AiSearchRetriever, the permission gate) answers from the index.
// Each search spends one of AI Search's 1,000 included queries a month; a run makes about 20.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import { ARCHETYPES, fillTemplate } from "../src/shared/synth/archetypes.ts";
import type { Manifest } from "../src/shared/synth/dataset.ts";
import { buildAiSearchRequest, parsePolicyKey } from "../src/worker/policies/ai-search-request.ts";
import { remoteProxyConfig, repo } from "./lib/cloudflare.ts";
import { PROD, readServiceTokens } from "./lib/production.ts";

type Search = {
  search(req: unknown): Promise<{ chunks: Array<{ id: string; item: { key: string; metadata?: Record<string, unknown> } }> }>;
  stats(): Promise<{ queued?: number; running?: number; completed?: number; error?: number }>;
  jobs: { create(params?: { description?: string }): Promise<unknown> };
};

const { values } = parseArgs({ options: { "as-of": { type: "string" } } });
const asOf = values["as-of"];
if (!asOf) {
  console.error("usage: npm run verify:ai-search -- --as-of YYYY-MM-DD");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(join(repo, `data/generated/asof-${asOf}/manifest.json`), "utf8")) as Manifest;
const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
};

const { env, dispose } = await getPlatformProxy<{ POLICY_SEARCH: Search }>({ configPath: remoteProxyConfig(), persist: false });
try {
  await env.POLICY_SEARCH.jobs.create({ description: "peopledesk verify" });
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const s = await env.POLICY_SEARCH.stats();
    console.log(`indexing: queued ${s.queued ?? 0}, running ${s.running ?? 0}, completed ${s.completed ?? 0}, error ${s.error ?? 0}`);
    if ((s.error ?? 0) > 0) throw new Error(`indexing reported ${s.error} errors`);
    if ((s.queued ?? 0) === 0 && (s.running ?? 0) === 0 && (s.completed ?? 0) >= manifest.counts.versions) break;
    if (Date.now() > deadline) throw new Error("indexing did not finish within 15 minutes");
    await new Promise((r) => setTimeout(r, 10_000));
  }

  const search = (query: string, clearance: 1 | 2 | 3) =>
    env.POLICY_SEARCH.search(buildAiSearchRequest({ query, clearance, asOf: manifest.asOf, topK: 6 }));
  const factQuery = (rank: number) => {
    const d = manifest.documents.find((x) => x.rank === rank)!;
    const v = d.versions.find((x) => x.status === "current")!;
    const f = v.facts[0]!;
    return { d, q: fillTemplate(ARCHETYPES[f.archetype].questions[0], { subject: f.subject }) };
  };
  let sawMetadata = false;
  for (const rank of [1, 2, 3] as const) {
    const { d, q } = factQuery(rank);
    const res = await search(q, rank);
    sawMetadata ||= res.chunks.some((c) => c.item.metadata && "audience_rank" in c.item.metadata);
    check(`clearance ${rank} finds its own document`, res.chunks.some((c) => parsePolicyKey(c.item.key)?.docId === d.docId), `${d.docId}, ${res.chunks.length} chunks`);
  }
  const { q: hrQuery } = factQuery(3);
  const low = await search(hrQuery, 1);
  check("clearance 1 never sees rank 2 or 3", low.chunks.every((c) => (parsePolicyKey(c.item.key)?.rank ?? 9) === 1), `${low.chunks.length} chunks`);
  const statusOf = new Map(manifest.documents.flatMap((d) => d.versions.map((v) => [`${d.docId}@${v.version}`, v.status] as const)));
  let notCurrent = 0;
  for (const d of manifest.documents.filter((x) => x.rank === 1 && x.versions.length > 1).slice(0, 10)) {
    const res = await search(`${d.title} ${d.versions[0]!.facts[0]!.subject}`, 3);
    for (const c of res.chunks) {
      const k = parsePolicyKey(c.item.key);
      if (k && statusOf.get(`${k.docId}@${k.version}`) !== "current") notCurrent++;
    }
  }
  check("superseded and scheduled versions are excluded", notCurrent === 0, `${notCurrent} non-current chunks returned`);
  check("R2 customMetadata reached the index (audience_rank present)", sawMetadata, sawMetadata ? "custom metadata mode usable" : "use the folder-range fallback");
  let threw = false;
  try {
    const good = buildAiSearchRequest({ query: hrQuery, clearance: 1, asOf: manifest.asOf, topK: 6 });
    const bad = {
      ...good,
      ai_search_options: { ...good.ai_search_options, retrieval: { ...good.ai_search_options.retrieval, filters: { audience_rank: { $bogus: 1 } } } },
    };
    await env.POLICY_SEARCH.search(bad);
  } catch {
    threw = true;
  }
  check("return_on_failure false makes an invalid filter throw", threw, threw ? "threw" : "returned results instead of throwing");
} finally {
  await dispose();
}

// The deployed Worker's /mcp, when service tokens are allowed (eval window).
const tokens = readServiceTokens();
const base = `https://${PROD.hostname}`;
const headersOf = (t: { clientId: string; clientSecret: string }) => ({ "CF-Access-Client-Id": t.clientId, "CF-Access-Client-Secret": t.clientSecret });
const employee = tokens.tenured_employee;
const hr = tokens.hr_admin;
const open = employee ? (await fetch(`${base}/api/health`, { headers: headersOf(employee), redirect: "manual" }).catch(() => null))?.status === 200 : false;
if (!open || !employee || !hr) {
  console.log("SKIP deployed Worker /mcp checks: no eval window open (npm run deploy:eval-window) or no saved service tokens");
} else {
  const mcpSearch = async (t: { clientId: string; clientSecret: string }, query: string) => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...headersOf(t), "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_policies", arguments: { query, topK: 6 } } }),
    });
    const text = await res.text();
    const json = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop() ?? "{}"
      : text;
    const msg = JSON.parse(json) as { result?: { isError?: boolean; structuredContent?: { passages?: Array<{ docId: string }> } } };
    return { status: res.status, isError: msg.result?.isError ?? true, docIds: (msg.result?.structuredContent?.passages ?? []).map((p) => p.docId) };
  };
  const rank1 = manifest.documents.find((x) => x.rank === 1)!;
  const rank3 = manifest.documents.find((x) => x.rank === 3)!;
  const q = (d: (typeof manifest.documents)[number]) => {
    const f = d.versions.find((v) => v.status === "current")!.facts[0]!;
    return fillTemplate(ARCHETYPES[f.archetype].questions[0], { subject: f.subject });
  };
  const e1 = await mcpSearch(employee, q(rank1));
  check("Worker /mcp: an employee finds a rank 1 document", e1.status === 200 && !e1.isError && e1.docIds.includes(rank1.docId), `HTTP ${e1.status}, ${e1.docIds.length} passages`);
  const e3 = await mcpSearch(employee, q(rank3));
  const rank3Ids = new Set(manifest.documents.filter((x) => x.rank > 1).map((x) => x.docId));
  check("Worker /mcp: an employee never gets a rank 2 or 3 passage", e3.status === 200 && e3.docIds.every((id) => !rank3Ids.has(id)), `HTTP ${e3.status}, ${e3.docIds.length} passages`);
  const h3 = await mcpSearch(hr, q(rank3));
  check("Worker /mcp: HR finds a rank 3 document", h3.status === 200 && !h3.isError && h3.docIds.includes(rank3.docId), `HTTP ${h3.status}, ${h3.docIds.length} passages`);
}
const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ passed: checks.length - failed.length, failed: failed.map((c) => c.name) }));
process.exit(failed.length ? 1 : 0);
