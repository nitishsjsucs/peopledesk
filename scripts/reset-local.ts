// npm run db:reset:local -- [--as-of YYYY-MM-DD]
// Deletes this project's local D1, R2 and Durable Object state under .wrangler/state/v3, then reseeds.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
for (const dir of ["d1", "r2", "do"]) {
  rmSync(join(repo, ".wrangler", "state", "v3", dir), { recursive: true, force: true });
}
console.log("Removed .wrangler/state/v3/{d1,r2,do}");
execFileSync(process.execPath, [join(repo, "scripts", "seed-local.ts"), ...process.argv.slice(2)], {
  cwd: repo,
  stdio: "inherit",
});
