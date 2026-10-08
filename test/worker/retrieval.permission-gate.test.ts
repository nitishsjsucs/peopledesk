// A fake retriever that ignores every filter: the gate alone must drop restricted, superseded and
// scheduled passages, and report what it dropped.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PermissionGate } from "../../src/worker/policies/permission-gate.ts";
import type { RetrievedPassage } from "../../src/worker/policies/retriever.ts";
import { manifest } from "../helpers/fixtures.ts";

const AS_OF = "2026-10-01";

function passageFor(docId: string, version: number, overrides: Partial<RetrievedPassage> = {}): RetrievedPassage {
  const d = manifest.documents.find((x) => x.docId === docId);
  const v = d?.versions.find((x) => x.version === version);
  if (!d || !v) throw new Error(`${docId}@${version}`);
  const chunk = v.chunks[2];
  return {
    passageId: chunk?.chunkId ?? "",
    docId,
    version,
    title: d.title,
    section: chunk?.section ?? "Policy",
    text: chunk?.text ?? "",
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    sourceKey: v.r2Key,
    score: 1,
    ...overrides,
  };
}

const byStatus = (status: string, rank?: number) =>
  manifest.documents.flatMap((d) =>
    d.versions.filter((v) => v.status === status && (rank === undefined || d.rank === rank)).map((v) => passageFor(d.docId, v.version)),
  );

describe("PermissionGate", () => {
  it("drops restricted, superseded and scheduled passages and counts them", async () => {
    const restricted = [...byStatus("current", 2).slice(0, 3), ...byStatus("current", 3).slice(0, 2)];
    const superseded = byStatus("superseded", 1).slice(0, 4);
    const scheduled = byStatus("scheduled", 1).slice(0, 3);
    const allowed = byStatus("current", 1).slice(0, 2);
    const gate = await new PermissionGate(env.DB).filter([...restricted, ...superseded, ...scheduled, ...allowed], 1, AS_OF);
    expect(gate.passages.map((p) => p.passageId)).toEqual(allowed.map((p) => p.passageId));
    expect(gate.droppedForClearance).toBe(5);
    expect(gate.droppedNotEffective).toBe(7);
  });

  it("lets each clearance through up to its own rank", async () => {
    const mix = [...byStatus("current", 1).slice(0, 1), ...byStatus("current", 2).slice(0, 1), ...byStatus("current", 3).slice(0, 1)];
    for (const clearance of [1, 2, 3] as const) {
      const gate = await new PermissionGate(env.DB).filter(mix, clearance, AS_OF);
      expect(gate.passages).toHaveLength(clearance);
      expect(gate.droppedForClearance).toBe(3 - clearance);
    }
  });

  it("uses D1 truth, not the passage's claims, for dates and source keys", async () => {
    const real = byStatus("current", 1)[0] as RetrievedPassage;
    const lying = { ...real, effectiveFrom: "1999-01-01", effectiveTo: null, sourceKey: "policies/evil.md" };
    const supersededButClaimsCurrent = { ...(byStatus("superseded", 1)[0] as RetrievedPassage), effectiveTo: null };
    const gate = await new PermissionGate(env.DB).filter([lying, supersededButClaimsCurrent], 1, AS_OF);
    expect(gate.passages).toHaveLength(1);
    expect(gate.passages[0]?.effectiveFrom).toBe(real.effectiveFrom);
    expect(gate.passages[0]?.sourceKey).toBe(real.sourceKey);
    expect(gate.droppedNotEffective).toBe(1);
  });

  it("drops passages for documents or versions that do not exist", async () => {
    const fake = { ...(byStatus("current", 1)[0] as RetrievedPassage), docId: "POL-999", passageId: "POL-999@1#3" };
    const gate = await new PermissionGate(env.DB).filter([fake], 3, AS_OF);
    expect(gate.passages).toHaveLength(0);
    expect(gate.droppedNotEffective).toBe(1);
  });

  it("returns the D1 chunks of surviving versions when asked", async () => {
    const p = byStatus("current", 1)[0] as RetrievedPassage;
    const gate = await new PermissionGate(env.DB).filter([p], 1, AS_OF, { withChunks: true });
    expect(gate.chunksByVersion.get(`${p.docId}@${p.version}`)?.map((c) => c.section)).toEqual([
      "Purpose",
      "Scope",
      "Policy",
      "Procedure",
      "Exceptions",
      "Contacts",
    ]);
  });
});
