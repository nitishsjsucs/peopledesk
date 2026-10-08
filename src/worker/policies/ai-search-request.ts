// The AI Search request and item-key parsing, free of Workers runtime types so the production
// verification script (Node) builds exactly the request the Worker sends.
import { toUnixSeconds } from "../../shared/synth/dates.ts";
import type { Clearance, PolicyCategory } from "../../shared/domain.ts";

export type AiSearchRequestInput = { query: string; clearance: Clearance; asOf: string; topK: number; category?: PolicyCategory };

const KEY_RE = /^policies\/r([123])-(all|managers|hr)\/(POL-\d{3})\/v(\d{2,})\.md$/;

export function parsePolicyKey(key: string): { docId: string; version: number; rank: number } | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  return { docId: m[3] as string, version: Number(m[4]), rank: Number(m[1]) };
}

/**
 * Hybrid retrieval with reranking, metadata filters for clearance and effective dates, and
 * return_on_failure: false (failures throw instead of returning an empty list). Query rewrite and the
 * AI Search cache are off so eval results do not depend on earlier queries.
 */
export function buildAiSearchRequest(req: AiSearchRequestInput) {
  const asOfTs = toUnixSeconds(req.asOf);
  return {
    query: req.query,
    ai_search_options: {
      retrieval: {
        retrieval_type: "hybrid" as const,
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
