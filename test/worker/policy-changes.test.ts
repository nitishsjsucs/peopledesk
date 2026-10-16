// GET /api/policy-changes: versions that took effect in the last 90 days or are scheduled within a
// year, for the documents the caller's clearance allows, from one D1 statement and no R2 read.
import { createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PolicyChangesSchema } from "../../src/shared/api-types.ts";
import { addDaysIso } from "../../src/shared/dates.ts";
import worker from "../../src/worker/index.ts";
import { manifest } from "../helpers/fixtures.ts";
import { api, BASE_URL, expectError, expectJson, tokenFor } from "../helpers/http.ts";

const AS_OF = "2026-10-01";

const changesAs = async (as: string, query = "") => expectJson(await api(`/api/policy-changes${query}`, { as }), PolicyChangesSchema);

/** The expected rows for a clearance, oldest first, from the committed manifest. */
function oracle(rank: 1 | 2 | 3, category?: string) {
  const lo = addDaysIso(AS_OF, -90);
  const hi = addDaysIso(AS_OF, 365);
  return manifest.documents
    .filter((d) => d.rank <= rank && (category === undefined || d.category === category))
    .flatMap((d) => d.versions.filter((v) => v.effectiveFrom > lo && v.effectiveFrom <= hi).map((v) => ({ d, v })))
    .sort((a, b) => (a.v.effectiveFrom === b.v.effectiveFrom ? (a.d.docId < b.d.docId ? -1 : 1) : a.v.effectiveFrom < b.v.effectiveFrom ? -1 : 1))
    .map(({ d, v }) => ({
      docId: d.docId,
      title: d.title,
      category: d.category,
      audience: d.audience,
      version: v.version,
      effectiveFrom: v.effectiveFrom,
      status: v.effectiveFrom > AS_OF ? "scheduled" : v.status,
      changeSummary: v.changeSummary,
    }));
}

const rankOf = new Map(manifest.documents.map((d) => [d.docId, d.rank]));

describe("GET /api/policy-changes", () => {
  it("returns the changes each clearance may read: 18 for an employee, 22 for a manager, 25 for HR", async () => {
    const employee = await changesAs("tenured_employee");
    const manager = await changesAs("manager_no_new_hires");
    const hr = await changesAs("hr_admin");
    expect(employee).toEqual({ asOf: AS_OF, changes: oracle(1), truncated: false });
    expect(manager.changes).toEqual(oracle(2));
    expect(hr.changes).toEqual(oracle(3));
    expect([employee.changes.length, manager.changes.length, hr.changes.length]).toEqual([18, 22, 25]);
    expect(employee.changes.every((c) => rankOf.get(c.docId) === 1)).toBe(true);
    expect(manager.changes.every((c) => (rankOf.get(c.docId) ?? 9) <= 2)).toBe(true);
    for (const [body, recent] of [
      [employee, 10],
      [manager, 14],
      [hr, 17],
    ] as const) {
      expect(body.changes.filter((c) => c.status === "scheduled")).toHaveLength(8);
      expect(body.changes.filter((c) => c.status !== "scheduled")).toHaveLength(recent);
    }
  });

  it("orders oldest first and labels scheduled versions", async () => {
    const { changes } = await changesAs("tenured_employee");
    const keys = changes.map((c) => `${c.effectiveFrom} ${c.docId}`);
    expect(keys).toEqual([...keys].sort());
    const firstScheduled = changes.find((c) => c.status === "scheduled")!;
    expect(firstScheduled).toMatchObject({ docId: "POL-057", title: "Lost Device Reporting", version: 2, effectiveFrom: "2027-01-01" });
    expect(changes.filter((c) => c.effectiveFrom === AS_OF).map((c) => [c.title, c.version, c.status])).toEqual([
      ["Bereavement Leave", 2, "current"],
      ["Employee Assistance Program", 1, "current"],
      ["Recognition Program", 3, "current"],
    ]);
  });

  it("filters by category, and refuses an unknown category with 400", async () => {
    const travel = await changesAs("hr_admin", "?category=travel_expense");
    expect(travel.changes).toEqual(oracle(3, "travel_expense"));
    expect(travel.changes.every((c) => c.category === "travel_expense")).toBe(true);
    await expectError(await api("/api/policy-changes?category=snacks", { as: "hr_admin" }), 400, "validation_error");
  });

  it("carries metadata only, never document text", async () => {
    const { changes } = await changesAs("hr_admin");
    for (const c of changes) {
      expect(Object.keys(c).sort()).toEqual(["audience", "category", "changeSummary", "docId", "effectiveFrom", "status", "title", "version"]);
      expect(c.changeSummary).not.toMatch(/^#|\n|doc_id:/);
    }
  });

  it("never reads the policy bucket", async () => {
    const touched: string[] = [];
    const bucket = new Proxy({}, {
      get(_t, prop) {
        touched.push(String(prop));
        throw new Error("the policy-changes route must not touch R2");
      },
    });
    const res = await worker.fetch(
      new Request(`${BASE_URL}/api/policy-changes`, { headers: { "Cf-Access-Jwt-Assertion": await tokenFor("tenured_employee") } }),
      { ...env, POLICY_BUCKET: bucket } as unknown as Env,
      createExecutionContext(),
    );
    expect((await expectJson(res, PolicyChangesSchema)).changes).toHaveLength(18);
    expect(touched).toEqual([]);
  });

  it("keeps the window's edges: after asOf - 90 days, up to asOf + 365 days", async () => {
    const at = (version: number, from: string) =>
      env.DB.prepare(
        "INSERT INTO policy_versions (doc_id, version, r2_key, effective_from, effective_to, change_summary, content_sha256) VALUES ('POL-001', ?1, ?2, ?3, NULL, 'Edge test.', 'x')",
      ).bind(version, `test/edge-${version}.md`, from);
    await env.DB.batch([at(90, addDaysIso(AS_OF, -90)), at(91, addDaysIso(AS_OF, -89)), at(92, addDaysIso(AS_OF, 365)), at(93, addDaysIso(AS_OF, 366))]);
    try {
      const { changes } = await changesAs("tenured_employee");
      const edge = changes.filter((c) => c.changeSummary === "Edge test.").map((c) => c.version);
      expect(edge).toEqual([91, 92]);
    } finally {
      await env.DB.prepare("DELETE FROM policy_versions WHERE doc_id = 'POL-001' AND version >= 90").run();
    }
  });

  it("returns at most 50 changes and says when there were more", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO policy_versions (doc_id, version, r2_key, effective_from, effective_to, change_summary, content_sha256) VALUES ('POL-001', ?1, ?2, '2027-06-01', NULL, 'Limit test.', 'x')",
      ).bind(100 + i, `test/limit-${i}.md`),
    );
    await env.DB.batch(rows);
    try {
      const hr = await changesAs("hr_admin");
      expect(hr.changes).toHaveLength(50);
      expect(hr.truncated).toBe(true);
      const keys = hr.changes.map((c) => `${c.effectiveFrom} ${c.docId}`);
      expect(keys).toEqual([...keys].sort());
    } finally {
      await env.DB.prepare("DELETE FROM policy_versions WHERE doc_id = 'POL-001' AND version >= 100").run();
    }
    expect((await changesAs("hr_admin")).truncated).toBe(false);
  });

  it("needs a signed-in caller", async () => {
    await expectError(await api("/api/policy-changes"), 401, "unauthenticated");
  });
});
