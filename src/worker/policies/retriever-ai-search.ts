// Production retriever: AI Search over the R2 bucket, hybrid retrieval with reranking, metadata filters
// for clearance and effective dates. AI Search has no local emulation; this is never used locally.
//
// return_on_failure: false is mandatory. With the default (true) a failing filter, for example custom
// metadata that never reached the index, returns an empty list, and every policy question would turn
// into the deliberate not-found refusal (the unauthorized-retrieval eval cases would pass for the wrong
// reason). With false, failures throw and the turn returns kind "error" (retrieval_unavailable).
import { buildAiSearchRequest, parsePolicyKey } from "./ai-search-request.ts";
import type { PolicyRetriever, RetrievalRequest, RetrievedPassage } from "./retriever.ts";
import { RetrievalError } from "./retriever.ts";

export type AiSearchLike = Pick<AiSearchInstance, "search">;

export { buildAiSearchRequest, parsePolicyKey };

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
      response = await this.instance.search(buildAiSearchRequest(req) as AiSearchSearchRequest);
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
