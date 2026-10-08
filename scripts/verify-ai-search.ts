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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import { ARCHETYPES, fillTemplate } from "../src/shared/synth/archetypes.ts";
import type { Manifest } from "../src/shared/synth/dataset.ts";
import { buildAiSearchRequest, parsePolicyKey } from "../src/worker/policies/ai-search-request.ts";
import { remoteProxyConfig, repo } from "./lib/cloudflare.ts";

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
const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ passed: checks.length - failed.length, failed: failed.map((c) => c.name) }));
process.exit(failed.length ? 1 : 0);
