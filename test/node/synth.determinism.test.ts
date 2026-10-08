import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/shared/sha256.ts";
import { EXPECTED_COUNTS } from "../../src/shared/synth/counts.ts";
import { generateDataset, toJsonFile } from "../../src/shared/synth/dataset.ts";
import { renderSeedSql, seedStatements } from "../../src/shared/synth/seed-sql.ts";

const repo = resolve(import.meta.dirname, "../..");
const committedDir = join(repo, "data/generated/asof-2026-10-01");
const read = (p: string) => readFileSync(join(committedDir, p), "utf8");
const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("generator determinism", () => {
  const a = generateDataset("2026-10-01");
  const b = generateDataset("2026-10-01");

  it("produces identical hashes on two in-memory generations", () => {
    expect(a.manifest.datasetSha256).toBe(b.manifest.datasetSha256);
    expect(sha256Hex(renderSeedSql(seedStatements(a.manifest, a.org)))).toBe(
      sha256Hex(renderSeedSql(seedStatements(b.manifest, b.org))),
    );
    expect(a.markdownFiles.map((f) => sha256Hex(f.content))).toEqual(b.markdownFiles.map((f) => sha256Hex(f.content)));
  });

  it("equals the committed asof-2026-10-01 files byte for byte", () => {
    expect(read("manifest.json")).toBe(toJsonFile(a.manifest));
    expect(read("org.json")).toBe(toJsonFile(a.org));
    expect(read("seed.sql")).toBe(renderSeedSql(seedStatements(a.manifest, a.org)));
    expect(a.markdownFiles).toHaveLength(EXPECTED_COUNTS.r2Objects);
    for (const f of a.markdownFiles) expect(read(f.path), f.path).toBe(f.content);
  });

  it("records the expected counts and validity window in the committed manifest", () => {
    const m = JSON.parse(read("manifest.json")) as ReturnType<typeof generateDataset>["manifest"];
    expect(m.counts).toMatchObject({
      documents: EXPECTED_COUNTS.policyDocuments,
      versions: EXPECTED_COUNTS.policyVersions,
      current: EXPECTED_COUNTS.currentVersions,
      superseded: EXPECTED_COUNTS.supersededVersions,
      scheduled: EXPECTED_COUNTS.scheduledVersions,
      chunks: EXPECTED_COUNTS.policyVersions * EXPECTED_COUNTS.sectionsPerVersion,
    });
    expect(m.validFrom).toBe("2026-10-01");
    expect(m.validUntil).toBe("2026-10-15");
  });

  it.each(["America/Los_Angeles", "Asia/Kolkata"])(
    "generates the same datasetSha256 in a child process under TZ=%s",
    (tz) => {
      const out = mkdtempSync(join(tmpdir(), "pd-gen-"));
      tmpDirs.push(out);
      const stdout = execFileSync(process.execPath, [join(repo, "scripts/generate.ts"), "--out", out], {
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      });
      const printed = JSON.parse(stdout.trim().split("\n").pop() as string) as { datasetSha256: string };
      expect(printed.datasetSha256).toBe(a.manifest.datasetSha256);
      expect(readFileSync(join(out, "data/generated/asof-2026-10-01/seed.sql"), "utf8")).toBe(read("seed.sql"));
    },
    60_000,
  );
});
