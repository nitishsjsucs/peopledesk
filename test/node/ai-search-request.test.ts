// The AI Search metadata filters, applied to the R2 objects the seeders upload. AI Search itself has
// no local emulation, so this evaluates buildAiSearchRequest's filter object over r2PolicyObjects:
// exactly the versions in force at asOf, within the caller's clearance, may match.
import { describe, expect, it } from "vitest";
import type { Manifest } from "../../src/shared/synth/dataset.ts";
import { r2PolicyObjects } from "../../src/shared/synth/r2-objects.ts";
import type { R2PolicyObject } from "../../src/shared/synth/r2-objects.ts";
import { buildAiSearchRequest } from "../../src/worker/policies/ai-search-request.ts";
import type { Clearance } from "../../src/shared/domain.ts";
import manifestJson from "../../data/generated/asof-2026-10-01/manifest.json";

const manifest = manifestJson as unknown as Manifest;
const objects = r2PolicyObjects(manifest);

type Ops = { $lte?: number; $lt?: number; $gt?: number; $gte?: number; $eq?: number };

function matches(o: R2PolicyObject, filters: Record<string, Ops>): boolean {
  return Object.entries(filters).every(([field, ops]) => {
    const raw = (o.customMetadata as Record<string, string>)[field];
    if (raw === undefined) return false;
    const x = Number(raw);
    return (
      (ops.$lte === undefined || x <= ops.$lte) &&
      (ops.$lt === undefined || x < ops.$lt) &&
      (ops.$gt === undefined || x > ops.$gt) &&
      (ops.$gte === undefined || x >= ops.$gte) &&
      (ops.$eq === undefined || x === ops.$eq)
    );
  });
}

function matching(clearance: Clearance, asOf = manifest.asOf): R2PolicyObject[] {
  const filters = buildAiSearchRequest({ query: "q", clearance, asOf, topK: 6 }).ai_search_options.retrieval.filters;
  return objects.filter((o) => matches(o, filters as Record<string, Ops>));
}

const currentKeys = (maxRank: number) =>
  manifest.documents
    .filter((d) => d.rank <= maxRank)
    .flatMap((d) => d.versions.filter((v) => v.status === "current").map((v) => v.r2Key))
    .sort();

describe("AI Search filters over the R2 policy objects", () => {
  it("match exactly the 100 current versions for clearance 3", () => {
    const keys = matching(3).map((o) => o.key).sort();
    expect(keys).toHaveLength(100);
    expect(keys).toEqual(currentKeys(3));
  });

  it("match exactly the 70 current rank-1 versions for clearance 1, and 90 for clearance 2", () => {
    expect(matching(1).map((o) => o.key).sort()).toEqual(currentKeys(1));
    expect(matching(1)).toHaveLength(70);
    expect(matching(2).map((o) => o.key).sort()).toEqual(currentKeys(2));
    expect(matching(2)).toHaveLength(90);
  });

  it("switch from the old to the new version on the effective date (half-open ranges)", () => {
    const doc = manifest.documents.find((d) => d.versions.length > 1 && d.rank === 1)!;
    const [v1, v2] = doc.versions;
    const keysOf = (asOf: string) => matching(1, asOf).filter((o) => o.customMetadata.doc_id === doc.docId).map((o) => o.key);
    const dayBefore = new Date(Date.parse(`${v2!.effectiveFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    expect(keysOf(dayBefore)).toEqual([v1!.r2Key]);
    expect(keysOf(v2!.effectiveFrom)).toEqual([v2!.r2Key]);
  });
});
