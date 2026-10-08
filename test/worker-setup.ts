// Shared setup for the three workerd projects. Storage is isolated per test file, so this runs once
// per file against a fresh D1 and R2: migrations, then seedStatements() through DB.batch in chunks of
// 100 (never exec(), which splits on newlines), then the 155 markdown files into POLICY_BUCKET.
import { applyD1Migrations, env } from "cloudflare:test";
import type { Manifest } from "../src/shared/synth/dataset.ts";
import type { Org } from "../src/shared/synth/org.ts";
import { r2PolicyObjects } from "../src/shared/synth/r2-objects.ts";
import { seedStatements } from "../src/shared/synth/seed-sql.ts";
import manifestJson from "../data/generated/asof-2026-10-01/manifest.json";
import orgJson from "../data/generated/asof-2026-10-01/org.json";

const manifest = manifestJson as unknown as Manifest;
const org = orgJson as unknown as Org;
const files = import.meta.glob("../data/generated/asof-2026-10-01/policies/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const statements = seedStatements(manifest, org);
for (let i = 0; i < statements.length; i += 100) {
  await env.DB.batch(statements.slice(i, i + 100).map((s) => env.DB.prepare(s.sql).bind(...s.params)));
}

for (const obj of r2PolicyObjects(manifest)) {
  const body = files[`../data/generated/asof-2026-10-01/${obj.key}`];
  if (body === undefined) throw new Error(`missing markdown for ${obj.key}`);
  await env.POLICY_BUCKET.put(obj.key, body, {
    customMetadata: obj.customMetadata,
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
}
