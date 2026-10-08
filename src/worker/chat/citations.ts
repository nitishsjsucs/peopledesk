// CitationValidator: maps the composer's "Pk" labels to the passages returned in this turn, drops
// anything else (counted), and dedupes. An answer with zero valid citations is downgraded to the
// refusal by the orchestrator. Also the deterministic source line and fact-in-passage helpers.
import type { Citation } from "../../shared/api-types.ts";
import type { Passage } from "../../shared/tool-schemas.ts";
import { containsAllValues } from "../../../evals/lib/normalize.ts";

export const QUOTE_CHARS = 300;

export type LabeledPassage = Passage & { label: string };

export function labelPassages(passages: readonly Passage[]): LabeledPassage[] {
  return passages.map((p, i) => ({ ...p, label: `P${i + 1}` }));
}

export function toCitation(p: Passage): Citation {
  return {
    passageId: p.passageId,
    docId: p.docId,
    version: p.version,
    title: p.title,
    section: p.section,
    effectiveFrom: p.effectiveFrom,
    effectiveTo: p.effectiveTo,
    sourceKey: p.sourceKey,
    quote: p.text.slice(0, QUOTE_CHARS),
  };
}

export function validateCitations(
  labels: readonly string[],
  passages: readonly LabeledPassage[],
): { citations: Citation[]; invalidDropped: number } {
  const byLabel = new Map(passages.map((p) => [p.label, p]));
  const seen = new Set<string>();
  const citations: Citation[] = [];
  let invalidDropped = 0;
  for (const label of labels) {
    const p = byLabel.get(label);
    if (!p) {
      invalidDropped++;
      continue;
    }
    if (seen.has(p.passageId)) continue;
    seen.add(p.passageId);
    citations.push(toCitation(p));
  }
  return { citations, invalidDropped };
}

/** e.g. "Source: PTO Accrual (POL-001 v1, effective 2026-07-01)." */
export function sourceLine(citations: readonly Citation[]): string {
  const docs: Citation[] = [];
  for (const c of citations) if (!docs.some((d) => d.docId === c.docId && d.version === c.version)) docs.push(c);
  const parts = docs.map((c) => `${c.title} (${c.docId} v${c.version}, effective ${c.effectiveFrom})`);
  return `${parts.length > 1 ? "Sources" : "Source"}: ${parts.join("; ")}.`;
}

/** True when a cited passage's text contains every expected normalized value (the grounding check). */
export function passageContainsAll(text: string, normalizedValues: readonly string[]): boolean {
  return containsAllValues(text, normalizedValues);
}
