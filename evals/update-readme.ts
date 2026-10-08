// npm run eval:readme -- evals/results/<runId>/summary.json
// Writes the README Results block between <!-- results:start --> and <!-- results:end --> using only
// fields from the given summary.json. Refuses stub providers, aborted runs and partial runs.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ReadmeRefusal, renderReadmeResults, replaceResultsBlock, SummarySchema } from "./lib/report.ts";

const repo = resolve(import.meta.dirname, "..");
const file = process.argv[2];
if (!file) {
  console.error("usage: npm run eval:readme -- evals/results/<runId>/summary.json");
  process.exit(2);
}
const summary = SummarySchema.parse(JSON.parse(readFileSync(resolve(file), "utf8")));
let block: string;
try {
  block = renderReadmeResults(summary);
} catch (err) {
  if (err instanceof ReadmeRefusal) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
const readmePath = join(repo, "README.md");
writeFileSync(readmePath, replaceResultsBlock(readFileSync(readmePath, "utf8"), block));
console.log(`README Results block updated from ${file}`);
