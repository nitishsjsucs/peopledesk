// npm run seed:remote -- --as-of YYYY-MM-DD
// Production seeding (needs `npx wrangler login` and the D1 database id in wrangler.jsonc):
//   1. wrangler d1 migrations apply --remote --env production
//   2. wrangler d1 execute --remote --env production --file data/generated/asof-<date>/seed.sql
//      (deletes children first, upserts employees so identity_links survive). If the remote file
//      import rejects the statements that fire the FTS5 triggers, the same seedStatements() list is
//      sent in chunks of 50 through `wrangler d1 execute --remote --command`.
//   3. 155 R2 puts with customMetadata through getPlatformProxy with remote bindings.
// The R2 S3 API fallback (x-amz-meta-* headers) is P1 and not implemented.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import type { Manifest } from "../src/shared/synth/dataset.ts";
import type { Org } from "../src/shared/synth/org.ts";
import { r2PolicyObjects } from "../src/shared/synth/r2-objects.ts";
import { renderSeedSql, seedStatements } from "../src/shared/synth/seed-sql.ts";
import { remoteProxyConfig, repo, wrangler } from "./lib/cloudflare.ts";

const { values } = parseArgs({ options: { "as-of": { type: "string" } } });
const asOf = values["as-of"];
if (!asOf) {
  console.error("usage: npm run seed:remote -- --as-of YYYY-MM-DD (generate it first: npm run generate -- --as-of <date>)");
  process.exit(2);
}
const dataDir = join(repo, "data/generated", `asof-${asOf}`);
if (!existsSync(join(dataDir, "manifest.json"))) {
  console.error(`No dataset for ${asOf}. Run: npm run generate -- --as-of ${asOf}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8")) as Manifest;
const org = JSON.parse(readFileSync(join(dataDir, "org.json"), "utf8")) as Org;

wrangler(["d1", "migrations", "apply", "peopledesk", "--remote", "--env", "production"]);
try {
  wrangler(["d1", "execute", "peopledesk", "--remote", "--env", "production", "--file", join(dataDir, "seed.sql")]);
} catch (err) {
  console.warn(`Remote file import failed (${String(err).slice(0, 200)}); falling back to chunked --command batches.`);
  const statements = seedStatements(manifest, org);
  for (let i = 0; i < statements.length; i += 50) {
    const sql = renderSeedSql(statements.slice(i, i + 50)).replace(/\n/g, " ");
    wrangler(["d1", "execute", "peopledesk", "--remote", "--env", "production", "--command", sql]);
    console.log(`  statements ${i + 1}..${Math.min(i + 50, statements.length)} of ${statements.length}`);
  }
}

type Bucket = {
  put(key: string, body: string, opts: { customMetadata: Record<string, string>; httpMetadata: { contentType: string } }): Promise<unknown>;
};
const { env, dispose } = await getPlatformProxy<{ POLICY_BUCKET: Bucket }>({ configPath: remoteProxyConfig(), persist: false });
try {
  const objects = r2PolicyObjects(manifest);
  for (const obj of objects) {
    await env.POLICY_BUCKET.put(obj.key, readFileSync(join(dataDir, obj.key), "utf8"), {
      customMetadata: obj.customMetadata,
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
  }
  console.log(JSON.stringify({ seeded: asOf, r2Objects: objects.length, datasetSha256: manifest.datasetSha256 }));
} finally {
  await dispose();
}
