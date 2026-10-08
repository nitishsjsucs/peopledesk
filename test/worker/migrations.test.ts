import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("D1 migrations", () => {
  it("creates every table, including the FTS5 external-content table", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'policy_chunks_fts_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT IN ('sqlite_sequence','d1_migrations') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual([
      "audit_log",
      "conversations",
      "dataset_meta",
      "employees",
      "identity_links",
      "onboarding_plans",
      "onboarding_tasks",
      "orientation_bookings",
      "orientation_sessions",
      "pending_actions",
      "policy_chunks",
      "policy_chunks_fts",
      "policy_documents",
      "policy_versions",
      "tickets",
    ]);
  });

  it("keeps the FTS index in sync through the insert, update and delete triggers", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO policy_documents VALUES ('POL-901','Probe','time_off','all',1,'People Ops')",
      ),
      env.DB.prepare(
        "INSERT INTO policy_versions VALUES ('POL-901',1,'policies/r1-all/POL-901/v01.md','2026-01-01',NULL,'Initial','x')",
      ),
      env.DB.prepare(
        "INSERT INTO policy_chunks (id, chunk_id, doc_id, version, ordinal, title, section, text) VALUES (100001,'POL-901@1#1','POL-901',1,1,'Probe','Policy','Employees accrue zeppelin days monthly.')",
      ),
    ]);
    const match = (q: string) =>
      env.DB.prepare("SELECT rowid FROM policy_chunks_fts WHERE policy_chunks_fts MATCH ?1").bind(q).all();
    expect((await match("zeppelin")).results).toHaveLength(1);
    expect((await match("zeppelins")).results).toHaveLength(1); // porter stemming
    await env.DB.prepare("UPDATE policy_chunks SET text = 'Now about dirigibles.' WHERE id = 100001").run();
    expect((await match("zeppelin")).results).toHaveLength(0);
    expect((await match("dirigibles")).results).toHaveLength(1);
    await env.DB.prepare("DELETE FROM policy_chunks WHERE id = 100001").run();
    expect((await match("dirigibles")).results).toHaveLength(0);
  });

  it("enforces id patterns, enums and foreign keys", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO employees (id,email,full_name,role,department,region,job_title,start_date) VALUES ('X1','a@b.test','A','employee','Eng','US','Eng','2026-01-01')",
      ).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      env.DB.prepare(
        "INSERT INTO employees (id,email,full_name,role,department,region,job_title,start_date) VALUES ('E9001','a@b.test','A','ceo','Eng','US','Eng','2026-01-01')",
      ).run(),
    ).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      env.DB.prepare(
        "INSERT INTO conversations VALUES ('c1','E9999','t','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
      ).run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});
