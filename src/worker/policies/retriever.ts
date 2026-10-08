import type { Clearance, PolicyCategory, RetrieverKind } from "../../shared/domain.ts";

export type RetrievedPassage = {
  /** D1 chunk id ("POL-014@3#2"); in ai-search mode the aligned D1 chunk, or "<docId>@<v>~ais:<id>". */
  passageId: string;
  docId: string;
  version: number;
  title: string;
  section: string;
  text: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** R2 key of the version. */
  sourceKey: string;
  /** Higher is better (bm25 is negated; AI Search scores pass through). */
  score: number;
  /** AI Search chunk id, kept for the trace. */
  aiSearchChunkId?: string;
};

export type RetrievalRequest = {
  query: string;
  clearance: Clearance;
  asOf: string;
  topK: number;
  category?: PolicyCategory;
  signal?: AbortSignal;
};

export interface PolicyRetriever {
  readonly kind: RetrieverKind;
  /** May over-return; PermissionGate is the guarantee. Throws on failure (never returns [] for an error). */
  search(req: RetrievalRequest): Promise<RetrievedPassage[]>;
}

/** Thrown by a retriever when the backing index fails; the orchestrator maps it to retrieval_unavailable. */
export class RetrievalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetrievalError";
  }
}
