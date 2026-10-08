// AI Search has no local emulation, so the adapter is tested against a fake AiSearchInstance that
// records the request and returns chunks shaped like AiSearchSearchResponse.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { toUnixSeconds } from "../../src/shared/synth/dates.ts";
import { alignChunk, alignPassages, EXCERPT_SECTION, jaccard } from "../../src/worker/policies/chunk-align.ts";
import { PermissionGate } from "../../src/worker/policies/permission-gate.ts";
import { AiSearchRetriever, parsePolicyKey } from "../../src/worker/policies/retriever-ai-search.ts";
import type { AiSearchLike } from "../../src/worker/policies/retriever-ai-search.ts";
import { RetrievalError } from "../../src/worker/policies/retriever.ts";
import { manifest } from "../helpers/fixtures.ts";

type Chunk = AiSearchSearchResponse["chunks"][number];

class FakeAiSearch implements AiSearchLike {
  requests: AiSearchSearchRequest[] = [];
  private readonly chunks: Chunk[] | Error;
  constructor(chunks: Chunk[] | Error) {
    this.chunks = chunks;
  }
  async search(params: AiSearchSearchRequest): Promise<AiSearchSearchResponse> {
    this.requests.push(params);
    if (this.chunks instanceof Error) throw this.chunks;
    return { search_query: String(params.query), chunks: this.chunks };
  }
}

const doc = manifest.documents.find((d) => d.rank === 1 && d.versions.length === 1)!;
const v = doc.versions[0]!;
const policyChunk = v.chunks.find((c) => c.section === "Policy")!;
const aisChunk = (id: string, key: string, text: string, score = 0.9): Chunk => ({
  id,
  type: "text",
  score,
  text,
  item: { key, metadata: {} },
});

describe("AiSearchRetriever request", () => {
  it("sends hybrid retrieval with reranking, the exact metadata filters and a strict failure mode", async () => {
    const fake = new FakeAiSearch([]);
    await new AiSearchRetriever(fake).search({ query: "How fast does PTO accrue?", clearance: 2, asOf: "2026-10-01", topK: 6 });
    const asOfTs = toUnixSeconds("2026-10-01");
    expect(fake.requests).toEqual([
      {
        query: "How fast does PTO accrue?",
        ai_search_options: {
          retrieval: {
            retrieval_type: "hybrid",
            max_num_results: 18,
            match_threshold: 0.3,
            return_on_failure: false,
            filters: {
              audience_rank: { $lte: 2 },
              effective_from_ts: { $lte: asOfTs },
              effective_to_ts: { $gt: asOfTs },
            },
          },
          query_rewrite: { enabled: false },
          reranking: { enabled: true },
          cache: { enabled: false },
        },
      },
    ]);
  });

  it("caps max_num_results at 50", async () => {
    const fake = new FakeAiSearch([]);
    await new AiSearchRetriever(fake).search({ query: "q", clearance: 1, asOf: "2026-10-01", topK: 30 });
    expect(fake.requests[0]?.ai_search_options?.retrieval?.max_num_results).toBe(50);
  });
});

describe("AiSearchRetriever mapping", () => {
  it("maps item keys to doc and version and drops malformed keys", async () => {
    const r = new AiSearchRetriever(
      new FakeAiSearch([
        aisChunk("c1", v.r2Key, policyChunk.text),
        aisChunk("c2", "policies/r1-all/POL-1/v01.md", "bad id"),
        aisChunk("c3", "other/thing.md", "not a policy"),
        aisChunk("c4", "policies/r9-all/POL-001/v01.md", "bad rank"),
      ]),
    );
    const passages = await r.search({ query: "q", clearance: 1, asOf: "2026-10-01", topK: 6 });
    expect(passages).toHaveLength(1);
    expect(passages[0]).toMatchObject({ docId: doc.docId, version: v.version, aiSearchChunkId: "c1", text: policyChunk.text });
    expect(r.lastMalformedKeys).toBe(3);
    expect(parsePolicyKey("policies/r3-hr/POL-010/v02.md")).toEqual({ docId: "POL-010", version: 2, rank: 3 });
  });

  it("throws a RetrievalError (never an empty list) when AI Search fails", async () => {
    const r = new AiSearchRetriever(new FakeAiSearch(new Error("filter field not indexed")));
    await expect(r.search({ query: "q", clearance: 1, asOf: "2026-10-01", topK: 6 })).rejects.toBeInstanceOf(RetrievalError);
  });
});

describe("chunk alignment", () => {
  it("fills section and the D1 passage id from the best-overlapping chunk of the same version", async () => {
    const passages = await new AiSearchRetriever(
      new FakeAiSearch([
        // AI Search chunks need not match D1 section boundaries: a slice of the Policy text.
        aisChunk("c1", v.r2Key, `## Policy\n${policyChunk.text}`),
        aisChunk("c2", v.r2Key, "completely unrelated words about zebras and moonlight"),
      ]),
    ).search({ query: "q", clearance: 1, asOf: "2026-10-01", topK: 6 });
    const gate = await new PermissionGate(env.DB).filter(passages, 1, "2026-10-01", { withChunks: true });
    const aligned = alignPassages(gate.passages, gate.chunksByVersion);
    expect(aligned[0]).toMatchObject({ passageId: policyChunk.chunkId, section: "Policy", effectiveFrom: v.effectiveFrom });
    expect(aligned[1]).toMatchObject({ passageId: `${doc.docId}@${v.version}~ais:c2`, section: EXCERPT_SECTION });
  });

  it("breaks ties by the lowest ordinal and dedupes passages that align to the same chunk", () => {
    const chunks = [
      { chunkId: "X@1#2", docId: "X", version: 1, ordinal: 2, section: "B", text: "alpha beta" },
      { chunkId: "X@1#1", docId: "X", version: 1, ordinal: 1, section: "A", text: "alpha beta" },
    ];
    expect(alignChunk("alpha beta", chunks).chunk?.chunkId).toBe("X@1#1");
    expect(jaccard("a b c", "a b d")).toBeCloseTo(0.5);
    const base = { docId: "X", version: 1, title: "t", effectiveFrom: "2026-01-01", effectiveTo: null, sourceKey: "k", score: 1 };
    const out = alignPassages(
      [
        { ...base, passageId: "p1", section: "", text: "alpha beta", aiSearchChunkId: "a" },
        { ...base, passageId: "p2", section: "", text: "alpha beta gamma", aiSearchChunkId: "b" },
      ],
      new Map([["X@1", chunks]]),
    );
    expect(out.map((p) => p.passageId)).toEqual(["X@1#1"]);
  });

  it("lets the permission gate drop what AI Search over-returns", async () => {
    const restricted = manifest.documents.find((d) => d.rank === 3)!.versions[0]!;
    const passages = await new AiSearchRetriever(
      new FakeAiSearch([aisChunk("r", restricted.r2Key, restricted.chunks[2]!.text), aisChunk("ok", v.r2Key, policyChunk.text)]),
    ).search({ query: "q", clearance: 1, asOf: "2026-10-01", topK: 6 });
    const gate = await new PermissionGate(env.DB).filter(passages, 1, "2026-10-01", { withChunks: true });
    expect(gate.passages.map((p) => p.docId)).toEqual([doc.docId]);
    expect(gate.droppedForClearance).toBe(1);
  });
});

describe("a failing AI Search inside a chat turn", () => {
  it("returns kind error with retrieval_unavailable, not a refusal", async () => {
    const { runTurn } = await import("../../src/worker/chat/orchestrator.ts");
    const { StubProvider } = await import("../../src/worker/llm/stub.ts");
    const { principalFor, testServices } = await import("../helpers/services.ts");
    const services = testServices();
    services.retriever = new AiSearchRetriever(new FakeAiSearch(new Error("filter field audience_rank is not indexed")));
    const r = await runTurn(
      {
        provider: new StubProvider(),
        services,
        principal: await principalFor("tenured_employee"),
        conversationId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        asOf: "2026-10-01",
        approvalOrigin: "http://localhost",
        history: { userMessages: [], assistantTurns: [] },
      },
      "How fast does paid time off accrue?",
    );
    expect(r.kind).toBe("error");
    expect(r.error?.code).toBe("retrieval_unavailable");
    expect(r.text).not.toBe("I couldn't find that in the policies available to you.");
  });
});
