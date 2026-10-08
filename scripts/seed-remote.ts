// npm run seed:remote -- --as-of YYYY-MM-DD
// Production seeding (needs `npx wrangler login` and the D1 database id in wrangler.jsonc):
//   1. wrangler d1 migrations apply --remote --env production
//   2. wrangler d1 execute --remote --env production --file data/generated/asof-<date>/seed.sql
//      (deletes children first, upserts employees so identity_links survive). If the remote file
//      import rejects the statements that fire the FTS5 triggers, the same seedStatements() list is
//      sent in chunks of 50 through `wrangler d1 execute --remote --command`.
//   3. 155 R2 puts with customMetadata through getPlatformProxy with remote bindings, or through R2's
//      S3-compatible API with x-amz-meta-* headers (`--r2 s3`, or automatically when the proxy fails and
//      CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are set). `wrangler r2 object put`
//      has no custom-metadata option, which is why neither path uses it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getPlatformProxy } from "wrangler";
import type { Manifest } from "../src/shared/synth/dataset.ts";
import type { Org } from "../src/shared/synth/org.ts";
import { r2PolicyObjects } from "../src/shared/synth/r2-objects.ts";
import { renderSeedSql, seedStatements } from "../src/shared/synth/seed-sql.ts";
import { productionEnv, remoteProxyConfig, repo, wrangler } from "./lib/cloudflare.ts";
import { amzDateOf, sha256Hex, signRequest } from "./lib/sigv4.ts";

const { values } = parseArgs({ options: { "as-of": { type: "string" }, r2: { type: "string", default: "proxy" } } });
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
const objects = r2PolicyObjects(manifest);
const bodyOf = (key: string) => readFileSync(join(dataDir, key), "utf8");

async function putAllViaProxy(): Promise<void> {
  const { env, dispose } = await getPlatformProxy<{ POLICY_BUCKET: Bucket }>({ configPath: remoteProxyConfig(), persist: false });
  try {
    for (const obj of objects) {
      await env.POLICY_BUCKET.put(obj.key, bodyOf(obj.key), {
        customMetadata: obj.customMetadata,
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      });
    }
  } finally {
    await dispose();
  }
}

async function putAllViaS3(): Promise<void> {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("The S3 path needs CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY (an R2 API token).");
  }
  const bucket = productionEnv().r2_buckets[0]?.bucket_name ?? "peopledesk-policies";
  for (const obj of objects) {
    const body = bodyOf(obj.key);
    const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${obj.key}`;
    const headers: Record<string, string> = { "content-type": "text/markdown; charset=utf-8" };
    for (const [k, v] of Object.entries(obj.customMetadata)) headers[`x-amz-meta-${k}`] = v;
    const signed = await signRequest({
      method: "PUT",
      url,
      headers,
      payloadHash: await sha256Hex(body),
      accessKeyId,
      secretAccessKey,
      region: "auto",
      amzDate: amzDateOf(new Date()),
    });
    const { host: _host, ...sendHeaders } = signed.headers;
    const res = await fetch(url, { method: "PUT", headers: sendHeaders, body });
    if (!res.ok) throw new Error(`S3 PUT ${obj.key} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

if (values.r2 === "s3") {
  await putAllViaS3();
} else {
  try {
    await putAllViaProxy();
  } catch (err) {
    if (!process.env["R2_ACCESS_KEY_ID"]) throw err;
    console.warn(`R2 puts through getPlatformProxy failed (${String(err).slice(0, 200)}); using the S3 API.`);
    await putAllViaS3();
  }
}
console.log(JSON.stringify({ seeded: asOf, r2Objects: objects.length, datasetSha256: manifest.datasetSha256 }));
