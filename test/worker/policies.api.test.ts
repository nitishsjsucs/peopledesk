import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PolicyDocumentSchema, PolicyListSchema, PolicyVersionSchema } from "../../src/shared/api-types.ts";
import { manifest, persona } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";

const byRank = (rank: number) => manifest.documents.filter((d) => d.rank === rank);

describe("policy API", () => {
  it("filters the document list by clearance and shows the version current at asOf", async () => {
    for (const [who, visible] of [
      ["tenured_employee", 70],
      ["manager_no_new_hires", 90],
      ["hr_admin", 100],
    ] as const) {
      const body = await expectJson(await api("/api/policies", { as: who }), PolicyListSchema);
      expect(body.documents, who).toHaveLength(visible);
    }
    const body = await expectJson(await api("/api/policies", { as: "tenured_employee" }), PolicyListSchema);
    for (const item of body.documents) {
      const d = manifest.documents.find((x) => x.docId === item.docId);
      expect(d?.rank).toBe(1);
      expect(item.currentVersion).toBe(d?.versions.find((v) => v.status === "current")?.version);
    }
  });

  it("filters by category and title search", async () => {
    const body = await expectJson(await api("/api/policies?category=benefits", { as: "tenured_employee" }), PolicyListSchema);
    expect(body.documents).toHaveLength(7);
    const q = await expectJson(await api("/api/policies?q=stipend", { as: "tenured_employee" }), PolicyListSchema);
    expect(q.documents.map((d) => d.title).sort()).toEqual(["Home Office Stipend", "Wellness Stipend"]);
    await expectError(await api("/api/policies?category=nope", { as: "tenured_employee" }), 400, "validation_error");
  });

  it("labels current, superseded and scheduled versions at asOf", async () => {
    const d = manifest.documents.find((x) => x.rank === 1 && x.versions.length === 3 && x.versions.some((v) => v.status === "scheduled"));
    if (!d) throw new Error("no 3-version scheduled doc");
    const body = await expectJson(await api(`/api/policies/${d.docId}`, { as: "tenured_employee" }), PolicyDocumentSchema);
    expect(body.versions.map((v) => v.status)).toEqual(["superseded", "current", "scheduled"]);
    expect(body.versions.map((v) => [v.effectiveFrom, v.effectiveTo])).toEqual(d.versions.map((v) => [v.effectiveFrom, v.effectiveTo]));
  });

  it("serves the version body from R2 and audits the view", async () => {
    const d = byRank(1)[0]!;
    const v = d.versions[0]!;
    const p = persona("new_hire_booked");
    const body = await expectJson(await api(`/api/policies/${d.docId}/versions/${v.version}`, { as: p.key }), PolicyVersionSchema);
    expect(body.r2Key).toBe(v.r2Key);
    expect(body.markdown).toContain(`doc_id: ${d.docId}`);
    expect(body.meta).toMatchObject({ docId: d.docId, version: v.version, status: v.status });
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor_id = ?1 AND event = 'policy_viewed' AND target = ?2")
      .bind(p.employeeId, `${d.docId}@${v.version}`)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });

  it("answers 404 for a document above clearance, exactly like a nonexistent one", async () => {
    const restricted = byRank(3)[0]!;
    const res1 = await api(`/api/policies/${restricted.docId}`, { as: "tenured_employee" });
    const res2 = await api("/api/policies/POL-999", { as: "tenured_employee" });
    const [b1, b2] = [await res1.json(), await res2.json()] as Array<{ error: { code: string; message: string } }>;
    expect([res1.status, res2.status]).toEqual([404, 404]);
    expect(b1?.error.message).toBe(b2?.error.message);
    await expectError(await api(`/api/policies/${restricted.docId}/versions/1`, { as: "manager_no_new_hires" }), 404, "not_found");
    await expectError(await api("/api/policies/not-an-id", { as: "tenured_employee" }), 404, "not_found");
    await expectJson(await api(`/api/policies/${restricted.docId}`, { as: "hr_admin" }), PolicyDocumentSchema);
  });
});
