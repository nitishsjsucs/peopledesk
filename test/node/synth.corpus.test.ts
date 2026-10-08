import { describe, expect, it } from "vitest";
import { POLICY_CATEGORIES } from "../../src/shared/domain.ts";
import { AMBIGUITY_GROUPS } from "../../src/shared/synth/ambiguity-groups.ts";
import { ARCHETYPE_KEYS } from "../../src/shared/synth/archetypes.ts";
import { BLUEPRINTS } from "../../src/shared/synth/blueprints.ts";
import { EXPECTED_COUNTS } from "../../src/shared/synth/counts.ts";
import { chunkMarkdown } from "../../src/shared/synth/chunk.ts";
import { generateCorpus } from "../../src/shared/synth/corpus.ts";
import type { Corpus } from "../../src/shared/synth/corpus.ts";
import { SECTION_NAMES, renderVersionMarkdown } from "../../src/shared/synth/render-markdown.ts";
import { extractNumbers } from "../../evals/lib/normalize.ts";

const AS_OFS = ["2026-10-01", "2027-03-15", "2028-01-31"];
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|hundred|thousand|half|dozen)\b/;

function tally<T>(items: T[], key: (t: T) => string | number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items) out[String(key(t))] = (out[String(key(t))] ?? 0) + 1;
  return out;
}

describe("policy blueprints", () => {
  it("has 100 rows, 10 per category, 7/2/1 audiences per category", () => {
    expect(BLUEPRINTS).toHaveLength(EXPECTED_COUNTS.policyDocuments);
    for (const [ci, category] of POLICY_CATEGORIES.entries()) {
      const rows = BLUEPRINTS.slice(ci * 10, ci * 10 + 10);
      expect(rows.every((r) => r.category === category)).toBe(true);
      expect(rows.map((r) => r.audience)).toEqual([...Array(7).fill("all"), "managers", "managers", "hr"]);
    }
    expect(new Set(BLUEPRINTS.map((b) => b.title)).size).toBe(100);
  });

  it("uses lowercase subjects without digits or number words, 2 or 3 per blueprint", () => {
    const subjects = BLUEPRINTS.flatMap((b) => b.facts.map(([, s]) => s));
    for (const b of BLUEPRINTS) expect(b.facts.length === 2 || b.facts.length === 3, b.title).toBe(true);
    for (const s of subjects) {
      expect(s, s).toBe(s.toLowerCase());
      expect(s, s).not.toMatch(/\d/);
      expect(s, s).not.toMatch(NUMBER_WORDS);
    }
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(new Set(BLUEPRINTS.flatMap((b) => b.facts.map(([a]) => a)))).toEqual(new Set(ARCHETYPE_KEYS));
  });

  it("defines 6 ambiguity groups over `all` blueprints that share the group's archetype", () => {
    expect(AMBIGUITY_GROUPS).toHaveLength(EXPECTED_COUNTS.ambiguityGroups);
    for (const g of AMBIGUITY_GROUPS) {
      expect(g.titles.length).toBeGreaterThanOrEqual(2);
      expect(g.titles.length).toBeLessThanOrEqual(3);
      for (const title of g.titles) {
        const bp = BLUEPRINTS.find((b) => b.title === title);
        expect(bp?.audience, title).toBe("all");
        expect(bp?.facts.some(([a]) => a === g.archetype), title).toBe(true);
      }
    }
  });

  it("keeps accrual, waiting-period and pre-approval facts among `all` docs to their ambiguity groups", () => {
    for (const archetype of ["accrual_rate", "days_waiting", "money_threshold"] as const) {
      const group = AMBIGUITY_GROUPS.find((g) => g.archetype === archetype);
      const withArchetype = BLUEPRINTS.filter((b) => b.audience === "all" && b.facts.some(([a]) => a === archetype)).map(
        (b) => b.title,
      );
      expect(withArchetype.sort()).toEqual([...(group?.titles ?? [])].sort());
    }
  });
});

describe("restricted blueprints", () => {
  it("use only archetypes whose restricted bands can be disjoint from rank 1 numbers", () => {
    for (const b of BLUEPRINTS.filter((x) => x.audience !== "all")) {
      for (const [a] of b.facts) expect(["count_per_year", "notice_weeks"], b.title).not.toContain(a);
    }
  });
});

describe.each(AS_OFS)("versioned corpus as of %s", (asOf) => {
  const corpus: Corpus = generateCorpus(asOf);
  const versions = corpus.docs.flatMap((d) => d.versions);

  it("has 100 documents with the 70/20/10 audience split", () => {
    expect(corpus.docs).toHaveLength(100);
    expect(tally(corpus.docs, (d) => d.audience)).toEqual(EXPECTED_COUNTS.audienceSplit);
    expect(tally(corpus.docs, (d) => d.category)).toEqual(Object.fromEntries(POLICY_CATEGORIES.map((c) => [c, 10])));
  });

  it("has the 55/35/10 version structure and 155 versions: 100 current, 47 superseded, 8 scheduled", () => {
    expect(tally(corpus.docs, (d) => d.versions.length)).toEqual({ 1: 55, 2: 35, 3: 10 });
    expect(versions).toHaveLength(EXPECTED_COUNTS.policyVersions);
    expect(tally(versions, (v) => v.status)).toEqual({ current: 100, superseded: 47, scheduled: 8 });
    for (const d of corpus.docs) expect(d.versions.filter((v) => v.status === "current"), d.docId).toHaveLength(1);
    const scheduledDocs = corpus.docs.filter((d) => d.versions.some((v) => v.status === "scheduled"));
    expect(tally(scheduledDocs, (d) => d.versions.length)).toEqual({ 2: 6, 3: 2 });
  });

  it("uses month offsets from M0 with contiguous, non-overlapping half-open ranges", () => {
    for (const d of corpus.docs) {
      d.versions.forEach((v, i) => {
        expect(v.effectiveFrom.endsWith("-01"), v.r2Key).toBe(true);
        if (v.effectiveTo !== null) expect(v.effectiveTo > v.effectiveFrom).toBe(true);
        const next = d.versions[i + 1];
        expect(v.effectiveTo).toBe(next ? next.effectiveFrom : null);
        if (v.status === "scheduled") expect(v.effectiveFrom > asOf).toBe(true);
        if (v.status === "current") expect(v.effectiveFrom <= corpus.m0).toBe(true);
      });
    }
  });

  it("has unique R2 keys with the rank-prefixed folder layout", () => {
    expect(new Set(versions.map((v) => v.r2Key)).size).toBe(155);
    for (const d of corpus.docs) {
      for (const v of d.versions) {
        expect(v.r2Key).toBe(`policies/r${d.rank}-${d.audience}/${d.docId}/v${String(v.version).padStart(2, "0")}.md`);
      }
    }
  });

  it("gives each version 2 or 3 facts and changes 1 or 2 facts per successor, within the same band", () => {
    for (const d of corpus.docs) {
      d.versions.forEach((v, i) => {
        expect(v.facts.length === 2 || v.facts.length === 3).toBe(true);
        expect(new Set(v.facts.map((f) => f.normalized)).size).toBe(v.facts.length);
        if (i === 0) return;
        const prev = d.versions[i - 1]!;
        const changed = v.facts.filter((f, k) => f.value !== prev.facts[k]?.value);
        expect(changed.length === 1 || changed.length === 2, v.r2Key).toBe(true);
        expect(changed.map((f) => f.factId).sort()).toEqual([...v.changedFactIds].sort());
        expect(v.changeSummary).toMatch(/changed from .+ to .+\./);
      });
    }
  });
});

describe("rendering, chunking and restricted-value disjointness", () => {
  const corpus = generateCorpus("2026-10-01");

  it("renders front matter, the effective line and six sections per version", () => {
    for (const d of corpus.docs) {
      for (const v of d.versions) {
        const md = renderVersionMarkdown(d, v);
        expect(md).not.toMatch(/\r/);
        expect(md.startsWith(`---\ndoc_id: ${d.docId}\nversion: ${v.version}\n`)).toBe(true);
        expect(md).toContain(`effective_to: ${v.effectiveTo ?? "null"}`);
        expect(md).toContain(`# ${d.title}\nEffective from ${v.effectiveFrom}.`);
        const chunks = chunkMarkdown(md, { docId: d.docId, version: v.version, title: d.title });
        expect(chunks.map((c) => c.section)).toEqual([...SECTION_NAMES]);
        expect(chunks.map((c) => c.chunkId)).toEqual(SECTION_NAMES.map((_, i) => `${d.docId}@${v.version}#${i + 1}`));
        const policy = chunks.find((c) => c.section === "Policy");
        for (const f of v.facts) expect(policy?.text).toContain(f.sentence);
        expect(chunks.some((c) => c.text.includes(`Form PD-${d.distractors.formNumber}`))).toBe(true);
      }
    }
  });

  it("puts 1 or 2 distractor numbers in every document", () => {
    for (const d of corpus.docs) {
      expect(d.distractors.formNumber).toBeGreaterThanOrEqual(400);
      expect(d.distractors.formNumber).toBeLessThanOrEqual(499);
    }
    expect(corpus.docs.some((d) => d.distractors.reviewMonths !== null)).toBe(true);
    expect(corpus.docs.some((d) => d.distractors.reviewMonths === null)).toBe(true);
  });

  it("keeps every restricted fact value out of every lower-rank document version", () => {
    for (const rank of [2, 3] as const) {
      const lower = new Set<string>();
      for (const d of corpus.docs.filter((x) => x.rank < rank)) {
        for (const v of d.versions) for (const n of extractNumbers(renderVersionMarkdown(d, v))) lower.add(n);
      }
      for (const d of corpus.docs.filter((x) => x.rank === rank)) {
        for (const v of d.versions) {
          for (const f of v.facts) expect(lower.has(f.normalized), `${f.factId}@${v.version}=${f.normalized}`).toBe(false);
        }
      }
    }
  });

  it("extracts each fact's normalized value from its rendered sentence", () => {
    for (const d of corpus.docs) {
      for (const f of d.versions.flatMap((v) => v.facts)) expect(extractNumbers(f.sentence)).toEqual([f.normalized]);
    }
  });
});

describe("corpus determinism across business dates", () => {
  it("keeps facts and structure identical when only AS_OF changes", () => {
    const a = generateCorpus("2026-10-01");
    const b = generateCorpus("2028-01-31");
    const shape = (c: Corpus) =>
      c.docs.map((d) => [d.docId, d.structure, d.versions.map((v) => [v.status, v.facts.map((f) => f.normalized)])]);
    expect(shape(b)).toEqual(shape(a));
  });
});
