// Production retriever: AI Search over the R2 bucket, hybrid retrieval with reranking, metadata filters
// for clearance and effective dates. AI Search has no local emulation; this is never used locally.
//
// return_on_failure: false is mandatory. With the default (true) a failing filter, for example custom
// metadata that never reached the index, returns an empty list, and every policy question would turn
// into the deliberate not-found refusal (the unauthorized-retrieval eval cases would pass for the wrong
// reason). With false, failures throw and the turn returns kind "error" (retrieval_unavailable).
import { toUnixSeconds } from "../../shared/synth/dates.ts";
import type { PolicyRetriever, RetrievalRequest, RetrievedPassage } from "./retriever.ts";
import { RetrievalError } from "./retriever.ts";

export type AiSearchLike = Pick<AiSearchInstance, "search">;

const KEY_RE = /^policies\/r([123])-(all|managers|hr)\/(POL-\d{3})\/v(\d{2,})\.md$/;

export function parsePolicyKey(key: string): { docId: string; version: number; rank: number } | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { docId: m[3] as string, version: Number(m[4]), rank: Number(m[1]) };
}

export function buildAiSearchRequest(req: RetrievalRequest): AiSearchSearchRequest {
  const asOfTs = toUnixSeconds(req.asOf);
  return {
    query: req.query,
    ai_search_options: {
      retrieval: {
        retrieval_type: "hybrid",
        max_num_results: Math.min(req.topK * 3, 50),
        match_threshold: 0.3,
        return_on_failure: false,
        filters: {
          audience_rank: { $lte: req.clearance },
          effective_from_ts: { $lte: asOfTs },
          effective_to_ts: { $gt: asOfTs },
        },
      },
      query_rewrite: { enabled: false },
      reranking: { enabled: true },
      cache: { enabled: false },
    },
  };
}

export class AiSearchRetriever implements PolicyRetriever {
  readonly kind = "ai-search" as const;
  private readonly instance: AiSearchLike;
  /** Chunks dropped because their item key did not parse (reported in tests and logs). */
  lastMalformedKeys = 0;

  constructor(instance: AiSearchLike) {
    this.instance = instance;
  }

  async search(req: RetrievalRequest): Promise<RetrievedPassage[]> {
    let response: AiSearchSearchResponse;
    try {
      response = await this.instance.search(buildAiSearchRequest(req));
    } catch (err) {
      throw new RetrievalError("AI Search request failed", { cause: err });
    }
    const out: RetrievedPassage[] = [];
    this.lastMalformedKeys = 0;
    for (const chunk of response.chunks ?? []) {
      const parsed = parsePolicyKey(chunk.item?.key ?? "");
      if (!parsed) {
        this.lastMalformedKeys++;
        continue;
      }
      out.push({
        passageId: `${parsed.docId}@${parsed.version}~ais:${chunk.id}`,
        docId: parsed.docId,
        version: parsed.version,
        title: "",
        section: "(excerpt)",
        text: chunk.text,
        // Placeholders: PermissionGate replaces dates and the source key with D1 truth.
        effectiveFrom: "",
        effectiveTo: null,
        sourceKey: chunk.item.key,
        score: chunk.score,
        aiSearchChunkId: chunk.id,
      });
    }
    if (this.lastMalformedKeys > 0) {
      console.warn(JSON.stringify({ msg: "ai_search_malformed_keys", count: this.lastMalformedKeys }));
    }
    return out;
  }
}
