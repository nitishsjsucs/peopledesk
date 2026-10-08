// npm run seed:local -- [--as-of YYYY-MM-DD]
// Seeds the local (Miniflare) D1 and R2 that `vite dev`, `vite preview` and getPlatformProxy share
// under .wrangler/state: D1 migrations, then seed.sql through `wrangler d1 execute --local --file`,
// then the 155 policy markdown files with custom metadata through getPlatformProxy.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import { DEFAULT_AS_OF } from "../src/shared/synth/counts.ts";
import type { Manifest } from "../src/shared/synth/dataset.ts";
import { r2PolicyObjects } from "../src/shared/synth/r2-objects.ts";

const repo = resolve(import.meta.dirname, "..");
const { values } = parseArgs({ options: { "as-of": { type: "string", default: DEFAULT_AS_OF } } });
const asOf = values["as-of"] as string;
const dataDir = join(repo, "data", "generated", `asof-${asOf}`);
if (!existsSync(join(dataDir, "manifest.json"))) {
  console.error(`No dataset for ${asOf}. Run: npm run generate -- --as-of ${asOf}`);
  process.exit(1);
}

const wrangler = (...args: string[]) =>
  execFileSync(join(repo, "node_modules/.bin/wrangler"), args, {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });

wrangler("d1", "migrations", "apply", "peopledesk", "--local");
wrangler("d1", "execute", "peopledesk", "--local", "--file", join(dataDir, "seed.sql"));

const manifest = JSON.parse(readFileSync(join(dataDir, "manifest.json"), "utf8")) as Manifest;
const { env, dispose } = await getPlatformProxy<{ POLICY_BUCKET: R2BucketLike }>({
  configPath: join(repo, "wrangler.jsonc"),
  persist: true,
});
try {
  // Remove objects from another dataset first, so the bucket holds exactly this dataset's versions.
  let cursor: string | undefined;
  do {
    const page = await env.POLICY_BUCKET.list({ prefix: "policies/", cursor });
    if (page.objects.length > 0) await env.POLICY_BUCKET.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const objects = r2PolicyObjects(manifest);
  for (const obj of objects) {
    await env.POLICY_BUCKET.put(obj.key, readFileSync(join(dataDir, obj.key), "utf8"), {
      customMetadata: obj.customMetadata,
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
  }
  console.log(JSON.stringify({ seeded: asOf, d1: "ok", r2Objects: objects.length, datasetSha256: manifest.datasetSha256 }));
} finally {
  await dispose();
}

// Minimal structural type for the R2 binding methods this script uses (Node has no Workers types).
type R2BucketLike = {
  list(opts: { prefix: string; cursor?: string }): Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(keys: string[]): Promise<void>;
  put(
    key: string,
    body: string,
    opts: { customMetadata: Record<string, string>; httpMetadata: { contentType: string } },
  ): Promise<unknown>;
};
