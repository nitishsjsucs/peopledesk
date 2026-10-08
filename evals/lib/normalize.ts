// Number normalization shared by the scorer, the leak check and the corpus generator's
// restricted-value disjointness rule. Pure TypeScript: runs under Node and inside workerd.
//
// "1.50 days", "$1,500", "15%", "one and a half" and "four thousand five hundred" all normalize to
// canonical decimal strings ("1.5", "1500", "15", "1.5", "4500").

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ADVERBS: Record<string, number> = { once: 1, twice: 2 };

/** Canonical decimal string: "1.50" -> "1.5", "007" -> "7". */
export function canonical(n: number): string {
  return String(Number(n.toFixed(6)));
}

// Identifiers and dates are not facts: ids carry digits (POL-014, TKT-000151, E0042, ORI-003),
// passage ids carry versions and ordinals (POL-014@3#2), and dates carry years.
const STRIP_PATTERNS: readonly RegExp[] = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g,
  /\d{4}-\d{2}-\d{2}/g,
  /POL-\d{3}(?:@\d+(?:#\d+|~ais:[\w.-]+)?)?/gi,
  /TKT-\d{6}/gi,
  /ORI-\d{3}/gi,
  /ONB-E\d{4}-\d{2}/gi,
  /BKG-[\w-]+/gi,
  /\bE\d{4}\b/g,
  /\br[123]-(?:all|managers|hr)\b/gi,
  /\bv\d+(?:\.md)?\b/gi,
];

/** Removes ids, ISO dates and timestamps, and version labels, before numbers are extracted. */
export function stripIdsAndDates(text: string): string {
  let out = text;
  for (const re of STRIP_PATTERNS) out = out.replace(re, " ");
  return out;
}

const NUMBER_WORD =
  "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|" +
  "seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)";
const NUMBER_RUN_RE = new RegExp(
  `\\b${NUMBER_WORD}(?:(?:\\s+|-)(?:and\\s+)?${NUMBER_WORD})*(?:\\s+and\\s+a\\s+half)?\\b`,
  "gi",
);

function parseNumberRun(run: string): number {
  let total = 0;
  let current = 0;
  const words = run.toLowerCase().split(/[\s-]+/);
  for (const w of words) {
    if (w in UNITS) current += UNITS[w] as number;
    else if (w in TENS) current += TENS[w] as number;
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
    } else if (w === "million") {
      total += (current || 1) * 1_000_000;
      current = 0;
    } else if (w === "half") current += 0.5;
  }
  return total + current;
}

/** Converts runs of number words ("four thousand five hundred", "one and a half") to numerals. */
export function wordsToNumerals(text: string): string {
  return text
    .replace(NUMBER_RUN_RE, (run) => canonical(parseNumberRun(run)))
    .replace(/\b(once|twice)\b/gi, (w) => String(ADVERBS[w.toLowerCase()] ?? w));
}

const NUMERAL_RE = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/**
 * Normalized numeric tokens in `text`: ids, dates and version labels are stripped first, number words
 * are converted, then numerals (with $ signs, thousands separators, decimals, %) are canonicalized.
 */
export function extractNumbers(text: string): string[] {
  const prepared = wordsToNumerals(stripIdsAndDates(text));
  const out: string[] = [];
  for (const m of prepared.matchAll(NUMERAL_RE)) out.push(canonical(Number(m[0].replace(/,/g, ""))));
  return out;
}

export function numberSet(text: string): Set<string> {
  return new Set(extractNumbers(text));
}

/** Canonical form of an expected value given as a string ("$4,500" -> "4500", "1.50" -> "1.5"). */
export function normalizeValue(value: string): string {
  const nums = extractNumbers(value);
  if (nums.length !== 1) throw new Error(`expected exactly one number in "${value}"`);
  return nums[0] as string;
}

/** True when every expected normalized value occurs among the numbers in `text`. */
export function containsAllValues(text: string, expected: readonly string[]): boolean {
  const found = numberSet(text);
  return expected.every((v) => found.has(v));
}
