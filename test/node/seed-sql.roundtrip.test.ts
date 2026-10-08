// The seed.sql path: rendered from the same seedStatements() list the Worker tests batch, applied with
// the top-level wrangler (4.149.0) against a throwaway local D1, then read back byte for byte.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Manifest } from "../../src/shared/synth/dataset.ts";
import type { Org } from "../../src/shared/synth/org.ts";
import { renderSeedSql, seedStatements, sqlLiteral } from "../../src/shared/synth/seed-sql.ts";

const repo = resolve(import.meta.dirname, "../..");
const dataDir = join(repo, "data/generated/asof-2026-10-01");
const manifest = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8")) as Manifest;
const org = JSON.parse(readFileSync(join(dataDir, "org.json"), "utf8")) as Org;
const statements = seedStatements(manifest, org);
const seedFile = readFileSync(join(dataDir, "seed.sql"), "utf8");
const persist = mkdtempSync(join(tmpdir(), "pd-d1-"));
afterAll(() => rmSync(persist, { recursive: true, force: true }));

const wrangler = (...args: string[]) =>
  execFileSync(join(repo, "node_modules/.bin/wrangler"), args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });

describe("seed statements and seed.sql", () => {
  it("never puts a raw newline or carriage return in SQL text", () => {
    for (const s of statements) {
      expect(s.sql).not.toMatch(/[\r\n]/);
      expect(s.sql.split("?").length - 1).toBe(s.params.length);
    }
    expect(seedFile).not.toMatch(/\r/);
  });

  it("renders exactly one statement per line", () => {
    const lines = seedFile.trimEnd().split("\n");
    expect(lines).toHaveLength(statements.length);
    for (const line of lines) expect(line.endsWith(";")).toBe(true);
    expect(seedFile).toBe(renderSeedSql(statements));
  });

  it("writes newlines as char(10) and doubles quotes", () => {
    expect(sqlLiteral("a\nb's")).toBe("'a' || char(10) || 'b''s'");
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(3)).toBe("3");
    expect(() => sqlLiteral("x\r\ny")).toThrow();
  });

  it(
    "round-trips through wrangler d1 execute --local --file, twice, byte for byte, with FTS in sync",
    () => {
      wrangler("d1", "migrations", "apply", "peopledesk", "--local", "--persist-to", persist);
      const file = join(dataDir, "seed.sql");
      wrangler("d1", "execute", "peopledesk", "--local", "--persist-to", persist, "--file", file);
      // Re-runnable: deletes children first, upserts employees.
      wrangler("d1", "execute", "peopledesk", "--local", "--persist-to", persist, "--file", file);
      const out = wrangler(
        "d1",
        "execute",
        "peopledesk",
        "--local",
        "--persist-to",
        persist,
        "--json",
        "--command",
        "SELECT chunk_id, text FROM policy_chunks ORDER BY id; " +
          "SELECT COUNT(*) AS n FROM policy_chunks_fts WHERE policy_chunks_fts MATCH 'accrues'; " +
          "SELECT COUNT(*) AS n FROM employees; SELECT sha256 FROM dataset_meta",
      );
      const results = JSON.parse(out) as Array<{ results: Array<Record<string, unknown>> }>;
      const rows = results[0]?.results as Array<{ chunk_id: string; text: string }>;
      const expected = manifest.documents.flatMap((d) => d.versions.flatMap((v) => v.chunks));
      expect(rows).toHaveLength(expected.length);
      rows.forEach((row, i) => {
        expect(row.chunk_id).toBe(expected[i]?.chunkId);
        expect(row.text).toBe(expected[i]?.text);
      });
      expect(Number(results[1]?.results[0]?.n)).toBeGreaterThan(0);
      expect(results[2]?.results[0]?.n).toBe(120);
      expect(results[3]?.results[0]?.sha256).toBe(manifest.datasetSha256);
    },
    180_000,
  );
});
