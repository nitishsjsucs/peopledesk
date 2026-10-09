import type { z } from "zod";
import type { SearchPoliciesInput, SearchPoliciesOutput } from "../../../shared/tool-schemas.ts";
import { alignPassages } from "../../policies/chunk-align.ts";
import { RetrievalError } from "../../policies/retriever.ts";
import { ToolError } from "../errors.ts";
import type { ToolContext, ToolOutcome } from "../server.ts";

/**
 * Retrieval counts for the trace. The number of passages dropped for clearance is deliberately absent:
 * sent to the caller, it would reveal that restricted documents on the topic exist. It is logged
 * server-side instead, where a non-zero value means the retriever's own filter is broken.
 */
export type RetrievalMeta = {
  retriever: "ai-search" | "d1-fts";
  query: string;
  returned: number;
  droppedNotEffective: number;
  passageIds: string[];
  aiSearchChunkIds?: string[];
  ms: number;
};
export const RETRIEVAL_META_KEY = "peopledesk/retrieval";

/** Retriever filtered by clearance and asOf; every passage re-checked by PermissionGate against D1. */
export async function searchPolicies(
  args: z.output<typeof SearchPoliciesInput>,
  ctx: ToolContext,
): Promise<ToolOutcome<z.output<typeof SearchPoliciesOutput>>> {
  const { principal, services: s } = ctx;
  const started = Date.now();
  const asOf = s.clock.asOf();
  let gateResult;
  try {
    const raw = await s.retriever.search({
      query: args.query,
      clearance: principal.clearance,
      asOf,
      topK: args.topK,
      category: args.category,
      signal: ctx.signal,
    });
    gateResult = await s.gate.filter(raw, principal.clearance, asOf, {
      withChunks: s.retriever.kind === "ai-search",
      ...(args.category ? { category: args.category } : {}),
    });
  } catch (err) {
    if (err instanceof RetrievalError) throw new ToolError("retrieval_unavailable", "Policy search is temporarily unavailable.");
    throw err;
  }
  if (gateResult.droppedForClearance > 0) {
    console.warn(
      JSON.stringify({
        msg: "retrieval_filter_leak",
        retriever: s.retriever.kind,
        droppedForClearance: gateResult.droppedForClearance,
        conversationId: ctx.conversationId ?? null,
      }),
    );
  }
  const passages = (
    s.retriever.kind === "ai-search" ? alignPassages(gateResult.passages, gateResult.chunksByVersion) : gateResult.passages
  ).slice(0, args.topK);
  const meta: RetrievalMeta = {
    retriever: s.retriever.kind,
    query: args.query,
    returned: passages.length,
    droppedNotEffective: gateResult.droppedNotEffective,
    passageIds: passages.map((p) => p.passageId),
    ...(s.retriever.kind === "ai-search"
      ? { aiSearchChunkIds: passages.map((p) => p.aiSearchChunkId).filter((x): x is string => !!x) }
      : {}),
    ms: Date.now() - started,
  };
  return {
    structured: {
      passages: passages.map((p) => ({
        passageId: p.passageId,
        docId: p.docId,
        version: p.version,
        title: p.title,
        section: p.section,
        text: p.text,
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo,
        sourceKey: p.sourceKey,
        score: p.score,
      })),
      asOf,
    },
    meta: { [RETRIEVAL_META_KEY]: meta },
  };
}
