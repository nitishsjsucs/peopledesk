// User text -> a safe FTS5 MATCH expression. Lowercases, extracts [a-z0-9]+ tokens, drops stopwords,
// keeps at most 12 distinct tokens, and emits "tok1" OR "tok2" ... Every token is a quoted string,
// so FTS5 operators in user text (NEAR, AND, OR, NOT, *, -, :, ^, quotes, parentheses) cannot change
// the query. Returns null when nothing searchable remains.

// Module scope: built once per isolate.
const STOPWORDS: ReadonlySet<string> = new Set(
  (
    "a about above after again all also am an and any are as at be been before being below between both but by " +
    "can could did do does doing down during each few for from further had has have having he her here hers him his " +
    "how i if in into is it its itself just me more most my myself no nor not now of on once only or other our " +
    "ours out over own same she should so some such than that the their theirs them then there these they this those " +
    "through to too under until up very was we were what whats when where which while who whom why will with would " +
    "you your yours yourself s t don get got tell please know need want much many still near"
  ).split(" "),
);

export const MAX_QUERY_TOKENS = 12;

export function ftsTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    const tok = m[0];
    if (STOPWORDS.has(tok) || out.includes(tok)) continue;
    out.push(tok);
    if (out.length >= MAX_QUERY_TOKENS) break;
  }
  return out;
}

export function toFtsQuery(text: string): string | null {
  const tokens = ftsTokens(text);
  return tokens.length === 0 ? null : tokens.map((t) => `"${t}"`).join(" OR ");
}
