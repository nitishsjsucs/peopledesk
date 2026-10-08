import { describe, expect, it } from "vitest";
import { ftsTokens, MAX_QUERY_TOKENS, toFtsQuery } from "../../src/worker/policies/fts-query.ts";

describe("FTS5 query sanitizer", () => {
  it("quotes every token and joins with OR", () => {
    expect(toFtsQuery("How fast does paid time off accrue?")).toBe('"fast" OR "paid" OR "time" OR "off" OR "accrue"');
  });

  it("strips FTS5 operators and syntax from user text", () => {
    expect(toFtsQuery('paid NEAR(time, 2) "off" -sick title:pto* (a OR b) ^x')).toBe(
      '"paid" OR "time" OR "2" OR "off" OR "sick" OR "title" OR "pto" OR "b" OR "x"',
    );
    expect(toFtsQuery("AND OR NOT")).toBeNull();
  });

  it("returns null when nothing searchable remains", () => {
    expect(toFtsQuery("")).toBeNull();
    expect(toFtsQuery("*** :: () -- \"\"")).toBeNull();
    expect(toFtsQuery("what is the")).toBeNull();
  });

  it("dedupes and caps the token count", () => {
    expect(ftsTokens("leave leave LEAVE")).toEqual(["leave"]);
    const many = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(ftsTokens(many)).toHaveLength(MAX_QUERY_TOKENS);
  });

  it("only ever emits quoted alphanumeric tokens", () => {
    for (const input of ['"; DROP TABLE x; --', "café naïve", "x\u0000y", "NEAR/3", "{col}: term"]) {
      const q = toFtsQuery(input);
      if (q !== null) expect(q).toMatch(/^"[a-z0-9]+"( OR "[a-z0-9]+")*$/);
    }
  });
});
