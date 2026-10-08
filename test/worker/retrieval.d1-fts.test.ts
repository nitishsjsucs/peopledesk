import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ARCHETYPES, fillTemplate } from "../../src/shared/synth/archetypes.ts";
import { D1Fts5Retriever } from "../../src/worker/policies/retriever-d1-fts.ts";
import { manifest } from "../helpers/fixtures.ts";

const AS_OF = "2026-10-01";
const retriever = () => new D1Fts5Retriever(env.DB);
const current = (docId: string) => {
  const d = manifest.documents.find((x) => x.docId === docId);
  const v = d?.versions.find((x) => x.status === "current");
  if (!d || !v) throw new Error(docId);
  return { d, v };
};

describe("D1 FTS5 retriever", () => {
  it("ranks the Policy chunk of the current version first for template questions", async () => {
    let hits = 0;
    let total = 0;
    const misses: string[] = [];
    for (const d of manifest.documents) {
      const v = d.versions.find((x) => x.status === "current");
      if (!v) continue;
      for (const f of v.facts) {
        for (const template of ARCHETYPES[f.archetype].questions) {
          const q = fillTemplate(template, { subject: f.subject, title: d.title });
          const [top] = await retriever().search({ query: q, clearance: d.rank, asOf: AS_OF, topK: 6 });
          total++;
          if (top?.passageId === `${d.docId}@${v.version}#3`) hits++;
          else misses.push(`${q} -> ${top?.passageId}`);
        }
      }
    }
    console.log(`top-1 policy-chunk hit rate: ${hits}/${total}`, misses.slice(0, 10));
    expect(hits / total).toBeGreaterThan(0.85);
  });

  it("applies the clearance filter in SQL", async () => {
    const restricted = manifest.documents.filter((d) => d.rank > 1);
    for (const d of restricted) {
      const { v } = current(d.docId);
      const f = v.facts[0];
      if (!f) continue;
      const q = fillTemplate(ARCHETYPES[f.archetype].questions[0], { subject: f.subject });
      const rows = await retriever().search({ query: q, clearance: 1, asOf: AS_OF, topK: 8 });
      for (const r of rows) expect(manifest.documents.find((x) => x.docId === r.docId)?.rank, r.passageId).toBe(1);
      const asOwner = await retriever().search({ query: q, clearance: d.rank, asOf: AS_OF, topK: 8 });
      expect(asOwner.some((r) => r.docId === d.docId)).toBe(true);
    }
  });

  it("applies the effective-date filter in SQL (no superseded or scheduled versions)", async () => {
    const statusOf = new Map(
      manifest.documents.flatMap((d) => d.versions.map((v) => [`${d.docId}@${v.version}`, v.status] as const)),
    );
    for (const d of manifest.documents.filter((x) => x.versions.length > 1)) {
      for (const v of d.versions) {
        const f = v.facts[0];
        if (!f) continue;
        const rows = await retriever().search({ query: `${f.subject} ${d.title}`, clearance: 3, asOf: AS_OF, topK: 8 });
        for (const r of rows) expect(statusOf.get(`${r.docId}@${r.version}`), r.passageId).toBe("current");
      }
    }
  });

  it("returns versions effective at another business date when asked", async () => {
    const d = manifest.documents.find((x) => x.versions.some((v) => v.status === "scheduled"));
    const scheduled = d?.versions.find((v) => v.status === "scheduled");
    if (!d || !scheduled) throw new Error("no scheduled version");
    const rows = await retriever().search({
      query: `${scheduled.facts[0]?.subject} ${d.title}`,
      clearance: 3,
      asOf: scheduled.effectiveFrom,
      topK: 8,
    });
    expect(rows.some((r) => r.docId === d.docId && r.version === scheduled.version)).toBe(true);
  });

  it("neutralizes FTS5 operators in user text", async () => {
    const base = "paid time off accrue";
    const plain = await retriever().search({ query: base, clearance: 1, asOf: AS_OF, topK: 6 });
    expect(plain.length).toBeGreaterThan(0);
    for (const hostile of [
      'paid NEAR(time off) accrue',
      '"paid time" off* accrue',
      "-paid time off accrue",
      "title:paid time off accrue",
      "(paid) AND (time OR off) accrue",
      "paid ^time off: accrue",
      'paid" OR "x" time off accrue',
    ]) {
      const rows = await retriever().search({ query: hostile, clearance: 1, asOf: AS_OF, topK: 6 });
      expect(rows.length, hostile).toBeGreaterThan(0);
    }
    expect(await retriever().search({ query: "*** --- :: ()", clearance: 1, asOf: AS_OF, topK: 6 })).toEqual([]);
    const same = await retriever().search({ query: "paid NEAR time OR off AND accrue", clearance: 1, asOf: AS_OF, topK: 6 });
    expect(same.map((r) => r.passageId)).toEqual(
      (await retriever().search({ query: "paid time off accrue", clearance: 1, asOf: AS_OF, topK: 6 })).map((r) => r.passageId),
    );
  });

  it("filters by category", async () => {
    const rows = await retriever().search({ query: "training hours", clearance: 3, asOf: AS_OF, topK: 8, category: "conduct" });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(manifest.documents.find((d) => d.docId === r.docId)?.category).toBe("conduct");
  });
});
