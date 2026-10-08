// npm run generate -- [--as-of YYYY-MM-DD] [--out <dir>]
// Writes data/generated/asof-<date>/{manifest.json, org.json, seed.sql, policies/**} and
// evals/dataset/asof-<date>/{cases.jsonl, meta.json} under <dir> (default: the repository root). The
// directories for that date are replaced, so no stale files remain.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_AS_OF } from "../src/shared/synth/counts.ts";
import { generateDataset, toJsonFile } from "../src/shared/synth/dataset.ts";
import { generateEvalCases, toJsonl } from "../src/shared/synth/eval-cases.ts";
import { renderSeedSql, seedStatements } from "../src/shared/synth/seed-sql.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: { "as-of": { type: "string", default: DEFAULT_AS_OF }, out: { type: "string", default: repoRoot } },
});
const asOf = values["as-of"] as string;
const outRoot = resolve(values.out as string);

const started = Date.now();
const { manifest, org, markdownFiles } = generateDataset(asOf);
const dataDir = join(outRoot, "data", "generated", `asof-${asOf}`);
const evalDir = join(outRoot, "evals", "dataset", `asof-${asOf}`);
rmSync(dataDir, { recursive: true, force: true });
rmSync(evalDir, { recursive: true, force: true });

const write = (path: string, content: string) => {
  if (content.includes("\r")) throw new Error(`refusing to write a carriage return to ${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

write(join(dataDir, "manifest.json"), toJsonFile(manifest));
write(join(dataDir, "org.json"), toJsonFile(org));
write(join(dataDir, "seed.sql"), renderSeedSql(seedStatements(manifest, org)));
for (const f of markdownFiles) write(join(dataDir, f.path), f.content);

const cases = generateEvalCases(manifest, org);
write(join(evalDir, "cases.jsonl"), toJsonl(cases));
// The cases belong to exactly this dataset; the runner refuses a server seeded with another one.
write(
  join(evalDir, "meta.json"),
  toJsonFile({
    asOf,
    validFrom: manifest.validFrom,
    validUntil: manifest.validUntil,
    datasetSha256: manifest.datasetSha256,
    cases: cases.length,
  }),
);

console.log(
  JSON.stringify({
    asOf,
    out: dataDir,
    datasetSha256: manifest.datasetSha256,
    validUntil: manifest.validUntil,
    counts: manifest.counts,
    markdownFiles: markdownFiles.length,
    evalCases: cases.length,
    ms: Date.now() - started,
  }),
);
