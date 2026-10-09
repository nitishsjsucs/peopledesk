// CitationValidator: maps the composer's "Pk" labels to the passages returned in this turn, drops
// anything else (counted), and dedupes. An answer with zero valid citations is downgraded to the
// refusal by the orchestrator. Also the citation quote, the deterministic source line and the
// fact-in-passage helper.
import type { Citation } from "../../shared/api-types.ts";
import type { Passage } from "../../shared/tool-schemas.ts";
import { containsAllValues, extractNumbers, numberSet } from "../../../evals/lib/normalize.ts";
import { jaccard } from "../policies/chunk-align.ts";

export const QUOTE_CHARS = 300;

export type LabeledPassage = Passage & { label: string };

export function labelPassages(passages: readonly Passage[]): LabeledPassage[] {
  return passages.map((p, i) => ({ ...p, label: `P${i + 1}` }));
}

/** A markdown heading or a front matter fence: a quote taken from inside a long passage ends before it. */
const SECTION_BREAK = /^(?:#{1,6}\s|---\s*$)/;

/** Lines of `text` (each keeps its line break); a line longer than a quote is split after sentence ends. */
function segments(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/(?<=\n)/)) {
    if (line.length <= QUOTE_CHARS) out.push(line);
    else out.push(...line.split(/(?<=[.!?]\s)/));
  }
  return out;
}

/**
 * The citation quote, at most QUOTE_CHARS characters of the passage. A passage that fits is quoted
 * whole (every D1 chunk does: the longest is 255 characters). A longer one, such as an AI Search chunk
 * that holds most of a policy file, is quoted from the line that states a number the answer gives:
 * whole lines from there up to the next heading, choosing the start whose quote covers the most of the
 * answer's numbers, then the line closest to the answer's wording, then the earliest. Without such a
 * line, the first QUOTE_CHARS characters. The quote is always a substring of the passage text.
 */
export function quoteFor(text: string, answer = ""): string {
  if (text.length <= QUOTE_CHARS) return text;
  const wanted = new Set(extractNumbers(answer));
  const segs = segments(text);
  let best: { covered: number; similarity: number; quote: string } | null = null;
  for (let i = 0; wanted.size > 0 && i < segs.length; i++) {
    const start = segs[i] as string;
    if (!extractNumbers(start).some((n) => wanted.has(n))) continue;
    let quote = "";
    for (let j = i; j < segs.length && quote.length + (segs[j] as string).length <= QUOTE_CHARS; j++) {
      if (j > i && SECTION_BREAK.test(segs[j] as string)) break;
      quote += segs[j];
    }
    if (quote === "") quote = start.slice(0, QUOTE_CHARS);
    const found = numberSet(quote);
    const covered = [...wanted].filter((n) => found.has(n)).length;
    const similarity = jaccard(start, answer);
    if (!best || covered > best.covered || (covered === best.covered && similarity > best.similarity)) {
      best = { covered, similarity, quote };
    }
  }
  return best ? best.quote.trim() : text.slice(0, QUOTE_CHARS);
}

export function toCitation(p: Passage, answer = ""): Citation {
  return {
    passageId: p.passageId,
    docId: p.docId,
    version: p.version,
    title: p.title,
    section: p.section,
    effectiveFrom: p.effectiveFrom,
    effectiveTo: p.effectiveTo,
    sourceKey: p.sourceKey,
    quote: quoteFor(p.text, answer),
  };
}

/** `answer` is the composer's answer text; it only picks which part of a long passage is quoted. */
export function validateCitations(
  labels: readonly string[],
  passages: readonly LabeledPassage[],
  answer = "",
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
    citations.push(toCitation(p, answer));
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
