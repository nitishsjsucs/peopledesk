// Maps an AI Search chunk (which carries text and an item key, but no section) to the D1 chunk of the
// same version with the highest Jaccard overlap of [a-z0-9]+ tokens (ties: lowest ordinal). Citations
// then carry the D1 section and passage id; the composer still sees the AI Search chunk text.
import type { D1Chunk } from "./permission-gate.ts";
import { versionKey } from "./permission-gate.ts";
import type { RetrievedPassage } from "./retriever.ts";

export const MIN_ALIGNMENT_OVERLAP = 0.2;
export const EXCERPT_SECTION = "(excerpt)";

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function alignChunk(text: string, candidates: readonly D1Chunk[]): { chunk: D1Chunk | null; overlap: number } {
  let best: D1Chunk | null = null;
  let bestOverlap = -1;
  for (const c of [...candidates].sort((x, y) => x.ordinal - y.ordinal)) {
    const o = jaccard(text, c.text);
    if (o > bestOverlap) {
      best = c;
      bestOverlap = o;
    }
  }
  if (!best || bestOverlap < MIN_ALIGNMENT_OVERLAP) return { chunk: null, overlap: Math.max(0, bestOverlap) };
  return { chunk: best, overlap: bestOverlap };
}

/** Fills section and passageId from D1; below the threshold keeps "(excerpt)" and an ~ais id. Dedupes. */
export function alignPassages(
  passages: readonly RetrievedPassage[],
  chunksByVersion: ReadonlyMap<string, readonly D1Chunk[]>,
): RetrievedPassage[] {
  const out: RetrievedPassage[] = [];
  const seen = new Set<string>();
  for (const p of passages) {
    const { chunk } = alignChunk(p.text, chunksByVersion.get(versionKey(p.docId, p.version)) ?? []);
    const aligned: RetrievedPassage = chunk
      ? { ...p, passageId: chunk.chunkId, section: chunk.section }
      : { ...p, passageId: `${p.docId}@${p.version}~ais:${p.aiSearchChunkId ?? "unknown"}`, section: EXCERPT_SECTION };
    if (seen.has(aligned.passageId)) continue;
    seen.add(aligned.passageId);
    out.push(aligned);
  }
  return out;
}
