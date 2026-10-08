import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HealthSchema } from "../../src/shared/api-types.ts";
import { EXPECTED_COUNTS } from "../../src/shared/synth/counts.ts";
import type { Manifest } from "../../src/shared/synth/dataset.ts";
import manifestJson from "../../data/generated/asof-2026-10-01/manifest.json";
import { api } from "../helpers/http.ts";

const manifest = manifestJson as unknown as Manifest;

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

describe("seeded D1 and R2 (batch path)", () => {
  it("holds the exact counts", async () => {
    expect(await count("policy_documents")).toBe(EXPECTED_COUNTS.policyDocuments);
    expect(await count("policy_versions")).toBe(EXPECTED_COUNTS.policyVersions);
    expect(await count("policy_chunks")).toBe(manifest.counts.chunks);
    expect(await count("employees")).toBe(EXPECTED_COUNTS.employees);
    expect(await count("onboarding_plans")).toBe(EXPECTED_COUNTS.onboardingPlans);
    expect(await count("onboarding_tasks")).toBe(EXPECTED_COUNTS.onboardingTasks);
    expect(await count("orientation_sessions")).toBe(EXPECTED_COUNTS.orientationSessions);
    expect(await count("orientation_bookings")).toBe(EXPECTED_COUNTS.seededBookings);
    expect(await count("tickets")).toBe(EXPECTED_COUNTS.seededTickets);
    expect(await count("dataset_meta")).toBe(1);
  });

  it("stores every chunk text byte for byte as in the manifest", async () => {
    const { results } = await env.DB.prepare("SELECT chunk_id, text FROM policy_chunks ORDER BY id").all<{
      chunk_id: string;
      text: string;
    }>();
    const expected = manifest.documents.flatMap((d) => d.versions.flatMap((v) => v.chunks));
    expect(results).toHaveLength(expected.length);
    results.forEach((row, i) => {
      expect(row.chunk_id).toBe(expected[i]?.chunkId);
      expect(row.text).toBe(expected[i]?.text);
    });
    expect(results.some((r) => r.text.includes("\n"))).toBe(true);
  });

  it("holds 155 R2 objects with the five metadata fields", async () => {
    let cursor: string | undefined;
    const objects: R2Object[] = [];
    do {
      const page = await env.POLICY_BUCKET.list({ prefix: "policies/", include: ["customMetadata"], cursor });
      objects.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    expect(objects).toHaveLength(EXPECTED_COUNTS.r2Objects);
    for (const o of objects) {
      expect(Object.keys(o.customMetadata ?? {}).sort()).toEqual(
        ["audience_rank", "doc_id", "effective_from_ts", "effective_to_ts", "version"],
      );
    }
    const v = manifest.documents[0]?.versions[0];
    const body = await env.POLICY_BUCKET.get(v?.r2Key ?? "");
    expect(await body?.text()).toContain(`doc_id: ${manifest.documents[0]?.docId}`);
  });

  it("reports the seeded dataset hash on /api/health", async () => {
    const res = await api("/api/health", { as: "tenured_employee" });
    expect(HealthSchema.parse(await res.json()).datasetSha256).toBe(manifest.datasetSha256);
  });
});
