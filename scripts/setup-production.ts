// npm run setup:production -- [--dry-run] [--as-of YYYY-MM-DD] [--reseed] [--rotate-missing-secrets]
//
// Sets up the whole production deployment on Cloudflare, idempotently: every step first looks for
// what it would create and skips it when it exists, so a rerun after a failure continues where the
// last run stopped. --dry-run inspects (read-only, like npm run doctor) and prints the plan.
//
//   1. dataset for the business date (default today, UTC): npm run generate -- --as-of <date>
//   2. D1 database peopledesk (wrangler), its id written into wrangler.jsonc env.production
//   3. R2 bucket peopledesk-policies (wrangler)
//   4. migrations, seed and the 155 policy objects with custom metadata (npm run seed:remote), when D1
//      holds another dataset, the bucket is new, or --reseed (reseeding clears conversations)
//   5. AI Gateway peopledesk with logging on (REST API)
//   6. AI Search instance peopledesk-policies over the bucket: policies/**, hybrid search, reranking and
//      the five custom metadata fields (wrangler ai-search create)
//   7. deploy with ACCESS_AUD empty: the Worker answers 500 on every route (fail closed)
//   8. Access: one service token per persona (secrets saved outside the repo), the reusable policies
//      peopledesk-allow (the owner's addresses) and peopledesk-service-auth (the service tokens), and the
//      self-hosted application for APP_HOSTNAME with the One-time PIN identity provider only (REST API)
//   9. the application's AUD written into wrangler.jsonc and deployed again
//  10. identity links: each persona's address and service token mapped to its employee in D1
//
// Credentials: wrangler's OAuth login (npx wrangler login) for D1, R2, AI Search and deploys, and an
// account API token in CF_API_TOKEN for Access and AI Gateway. Never export CLOUDFLARE_API_TOKEN: wrangler
// would use it instead of the OAuth login (every wrangler call here runs without it). Nothing printed
// here is a secret; service token client secrets go to ~/.config/peopledesk/service-tokens.json (0600).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { PersonaKey } from "../src/shared/domain.ts";
import type { Manifest } from "../src/shared/synth/dataset.ts";
import type { Org } from "../src/shared/synth/org.ts";
import { sqlLiteral } from "../src/shared/synth/seed-sql.ts";
import { productionEnv, repo } from "./lib/cloudflare.ts";
import {
  type AccessApp,
  type AccessPolicy,
  cfApi,
  configuredAud,
  inspect,
  jsonIn,
  PERSONA_EMAILS,
  printFindings,
  PROD,
  readServiceTokens,
  runRepo,
  serviceTokenName,
  serviceTokensFile,
  setProductionValue,
  type StoredToken,
  wranglerRun,
  wranglerTry,
  writeServiceTokens,
} from "./lib/production.ts";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    "as-of": { type: "string" },
    reseed: { type: "boolean", default: false },
    "rotate-missing-secrets": { type: "boolean", default: false },
  },
});
const dry = values["dry-run"];
const asOf = values["as-of"] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error("--as-of must be YYYY-MM-DD");
  process.exit(2);
}
const personas = Object.keys(PERSONA_EMAILS) as PersonaKey[];

const step = (n: number, text: string) => console.log(`\n[${n}] ${text}`);
const would = (text: string) => console.log(`    ${dry ? "would" : "now"}: ${text}`);
const skip = (text: string) => console.log(`    ok: ${text}`);

console.log(`PeopleDesk production setup${dry ? " (dry run: no changes)" : ""}, account ${PROD.accountId}, host https://${PROD.hostname}, business date ${asOf}`);
const state = await inspect();
printFindings(state.findings);
if (!state.whoamiOk || (!state.tokenOk && !dry)) {
  console.error("\nStopping: needs npx wrangler login for this account and CF_API_TOKEN (see README, Production setup).");
  process.exit(dry ? 0 : 1);
}
/** Without CF_API_TOKEN a dry run can still plan the wrangler steps, but not the API ones. */
const apiBlind = (what: string) => {
  if (state.tokenOk) return false;
  console.log(`    unknown: ${what} needs CF_API_TOKEN to inspect`);
  return true;
};

// 1. Dataset.
step(1, `dataset for ${asOf}`);
const dataDir = join(repo, "data/generated", `asof-${asOf}`);
if (existsSync(join(dataDir, "manifest.json"))) skip(`data/generated/asof-${asOf} exists`);
else {
  would(`npm run generate -- --as-of ${asOf}`);
  if (!dry) runRepo("node", ["scripts/generate.ts", "--as-of", asOf]);
}

// 2. D1.
step(2, `D1 database ${PROD.d1Name}`);
let d1Id = state.d1Id;
if (d1Id) skip(`exists (${d1Id})`);
else {
  would(`wrangler d1 create ${PROD.d1Name}`);
  if (!dry) {
    wranglerRun(["d1", "create", PROD.d1Name]);
    const list = jsonIn<Array<{ uuid: string; name: string }>>(wranglerTry(["d1", "list", "--json"]).out) ?? [];
    d1Id = list.find((d) => d.name === PROD.d1Name)?.uuid ?? null;
    if (!d1Id) throw new Error("created the D1 database but cannot find its id in wrangler d1 list");
  }
}
if (d1Id) {
  if (productionEnv().d1_databases[0]?.database_id === d1Id) skip("wrangler.jsonc has its id");
  else {
    would(`write database_id ${d1Id} into wrangler.jsonc env.production`);
    if (!dry) setProductionValue("database_id", d1Id);
  }
}

// 3. R2.
step(3, `R2 bucket ${PROD.bucket}`);
let bucketCreated = false;
if (state.bucketExists) skip("exists");
else {
  would(`wrangler r2 bucket create ${PROD.bucket}`);
  if (!dry) {
    wranglerRun(["r2", "bucket", "create", PROD.bucket]);
    bucketCreated = true;
  }
}

// 4. Seed.
step(4, "migrations, seed and policy objects");
const manifestPath = join(dataDir, "manifest.json");
const datasetSha = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest).datasetSha256 : null;
if (!values.reseed && !bucketCreated && state.seededSha && state.seededSha === datasetSha) skip(`D1 already holds the ${asOf} dataset (${datasetSha?.slice(0, 12)})`);
else {
  would(`npm run seed:remote -- --as-of ${asOf} (clears conversations and pending actions; identity links survive)`);
  if (!dry) runRepo("node", ["scripts/seed-remote.ts", "--as-of", asOf]);
}

// 5. AI Gateway.
step(5, `AI Gateway ${PROD.gateway}`);
if (apiBlind("the gateway")) {
  // dry run without a token
} else if (state.gatewayExists) skip("exists");
else {
  would(`create gateway ${PROD.gateway} with logging on, no cache, no gateway rate limit`);
  if (!dry) {
    await cfApi("ai-gateway/gateways", {
      method: "POST",
      body: {
        id: PROD.gateway,
        collect_logs: true,
        cache_ttl: 0,
        cache_invalidate_on_update: false,
        rate_limiting_interval: 0,
        rate_limiting_limit: 0,
        rate_limiting_technique: "fixed",
      },
    });
  }
}

// 6. AI Search.
step(6, `AI Search instance ${PROD.aiSearch}`);
if (state.aiSearchExists) skip("exists");
else {
  const args = [
    "ai-search",
    "create",
    PROD.aiSearch,
    "--type",
    "r2",
    "--source",
    PROD.bucket,
    "--include-items",
    "policies/**",
    "--hybrid-search",
    "--reranking",
    "--custom-metadata",
    "doc_id:text",
    "--custom-metadata",
    "version:number",
    "--custom-metadata",
    "audience_rank:number",
    "--custom-metadata",
    "effective_from_ts:number",
    "--custom-metadata",
    "effective_to_ts:number",
  ];
  would(`wrangler ${args.join(" ")}`);
  if (!dry) {
    try {
      wranglerRun(args);
    } catch {
      console.error(
        "\nwrangler ai-search create failed. Fallback (README, Production setup): in the dashboard, AI Search > Create instance, " +
          `R2 source ${PROD.bucket}, name ${PROD.aiSearch}, include policies/**, hybrid search and reranking on, custom metadata ` +
          "doc_id text, version number, audience_rank number, effective_from_ts number, effective_to_ts number. Then rerun this script.",
      );
      process.exit(1);
    }
  }
}

// 7. First deploy, fail closed.
step(7, `deploy Worker ${PROD.workerName}`);
if (state.workerDeployed) skip("deployed (step 9 deploys again when the Access AUD changes; npm run deploy ships code changes)");
else {
  would(`npm run deploy${/^[0-9a-f]{64}$/i.test(configuredAud()) ? "" : " (ACCESS_AUD empty until step 9: every route answers 500)"}`);
  if (!dry) runRepo("npm", ["run", "deploy"]);
}

// 8. Access.
step(8, "Cloudflare Access");
if (apiBlind("Access (service tokens, policies, application)")) {
  console.log("\nDry run stopped before the Access steps; set CF_API_TOKEN to plan them.");
  process.exit(0);
}
const stored: Partial<Record<PersonaKey, StoredToken>> = { ...readServiceTokens() };
const tokenIds: Partial<Record<PersonaKey, string>> = {};
for (const p of personas) {
  const existing = state.serviceTokens[p];
  if (existing) {
    tokenIds[p] = existing.id;
    if (stored[p]?.clientId === existing.client_id && stored[p]?.clientSecret) {
      skip(`service token ${serviceTokenName(p)} exists, secret saved`);
      continue;
    }
    if (!values["rotate-missing-secrets"]) {
      console.log(`    TODO: service token ${serviceTokenName(p)} exists but its secret is not in ${serviceTokensFile}; rerun with --rotate-missing-secrets`);
      continue;
    }
    would(`rotate the secret of ${serviceTokenName(p)} and save it`);
    if (!dry) {
      const r = await cfApi<{ client_id: string; client_secret: string }>(`access/service_tokens/${existing.id}/rotate`, { method: "POST" });
      stored[p] = { tokenId: existing.id, clientId: r.client_id, clientSecret: r.client_secret };
      writeServiceTokens(stored);
    }
  } else {
    would(`create service token ${serviceTokenName(p)} (one year) and save its secret`);
    if (!dry) {
      const r = await cfApi<{ id: string; client_id: string; client_secret: string }>("access/service_tokens", {
        method: "POST",
        body: { name: serviceTokenName(p), duration: "8760h" },
      });
      tokenIds[p] = r.id;
      stored[p] = { tokenId: r.id, clientId: r.client_id, clientSecret: r.client_secret };
      writeServiceTokens(stored);
    }
  }
}

const emails = [...new Set([PROD.ownerEmail, ...Object.values(PERSONA_EMAILS)])];
const allowBody = {
  name: PROD.allowPolicy,
  decision: "allow",
  include: emails.map((email) => ({ email: { email } })),
  exclude: [],
  require: [],
  session_duration: "24h",
};
const ids = Object.values(tokenIds);
const serviceBody = {
  name: PROD.serviceAuthPolicy,
  decision: "non_identity",
  include: ids.map((token_id) => ({ service_token: { token_id } })),
  exclude: [],
  require: [],
};

async function upsertPolicy(existing: AccessPolicy | null, body: { name: string; include: unknown[] }): Promise<string | null> {
  if (existing && JSON.stringify(existing.include) === JSON.stringify(body.include)) {
    skip(`policy ${body.name} exists and is current`);
    return existing.id;
  }
  if (body.include.length === 0) {
    console.log(`    TODO: policy ${body.name} has nothing to include yet`);
    return existing?.id ?? null;
  }
  would(`${existing ? "update" : "create"} reusable policy ${body.name} (${body.include.length} include rules)`);
  if (dry) return existing?.id ?? null;
  const r = existing
    ? await cfApi<AccessPolicy>(`access/policies/${existing.id}`, { method: "PUT", body })
    : await cfApi<AccessPolicy>("access/policies", { method: "POST", body });
  return r.id;
}
const allowId = await upsertPolicy(state.policies.allow, allowBody);
const serviceId = await upsertPolicy(state.policies.serviceAuth, serviceBody);

const appBody = {
  name: PROD.accessApp,
  domain: PROD.hostname,
  type: "self_hosted",
  allowed_idps: [PROD.idpId],
  auto_redirect_to_identity: true,
  session_duration: "24h",
  same_site_cookie_attribute: "lax",
  http_only_cookie_attribute: true,
  app_launcher_visible: false,
  policies: [
    ...(allowId ? [{ id: allowId, precedence: 1 }] : []),
    ...(serviceId ? [{ id: serviceId, precedence: 2 }] : []),
  ],
};
let app: AccessApp | null = state.app;
const appCurrent =
  !!app &&
  app.domain === PROD.hostname &&
  JSON.stringify(app.allowed_idps ?? []) === JSON.stringify([PROD.idpId]) &&
  JSON.stringify((app.policies ?? []).map((p) => p.id).sort()) === JSON.stringify(appBody.policies.map((p) => p.id).sort());
if (appCurrent) skip(`application ${app?.name} exists and is current`);
else {
  would(`${app ? "update" : "create"} self-hosted application ${PROD.accessApp} for ${PROD.hostname} (One-time PIN only; policies ${PROD.allowPolicy}, ${PROD.serviceAuthPolicy})`);
  if (!dry) {
    app = app
      ? await cfApi<AccessApp>(`access/apps/${app.id}`, { method: "PUT", body: appBody })
      : await cfApi<AccessApp>("access/apps", { method: "POST", body: appBody });
  }
}

// 9. AUD and redeploy.
step(9, "ACCESS_AUD and redeploy");
if (!app) would("write the application's AUD into wrangler.jsonc and npm run deploy");
else if (app.aud === configuredAud()) skip("wrangler.jsonc has the application's AUD");
else {
  would(`write ACCESS_AUD ${app.aud} into wrangler.jsonc env.production and npm run deploy`);
  if (!dry) {
    setProductionValue("ACCESS_AUD", app.aud);
    runRepo("npm", ["run", "deploy"]);
  }
}

// 10. Identity links.
step(10, "identity links in D1");
const org = existsSync(join(dataDir, "org.json")) ? (JSON.parse(readFileSync(join(dataDir, "org.json"), "utf8")) as Org) : null;
const links: Array<{ identity: string; kind: "email" | "service_token"; employeeId: string }> = [];
for (const p of personas) {
  const employeeId = org?.personas.find((x) => x.key === p)?.employeeId;
  if (!employeeId) continue;
  links.push({ identity: PERSONA_EMAILS[p].toLowerCase(), kind: "email", employeeId });
  const clientId = stored[p]?.clientId ?? state.serviceTokens[p]?.client_id;
  if (clientId) links.push({ identity: clientId, kind: "service_token", employeeId });
}
would(`upsert ${links.length} identity_links rows (${links.filter((l) => l.kind === "email").length} addresses, ${links.filter((l) => l.kind === "service_token").length} service tokens)`);
if (!dry && links.length > 0) {
  const now = new Date().toISOString();
  const sql = links
    .map(
      (l) =>
        `INSERT INTO identity_links (identity, kind, employee_id, created_at) VALUES (${sqlLiteral(l.identity)}, ${sqlLiteral(l.kind)}, ${sqlLiteral(l.employeeId)}, ${sqlLiteral(now)}) ` +
        "ON CONFLICT(identity) DO UPDATE SET kind = excluded.kind, employee_id = excluded.employee_id",
    )
    .join("; ");
  wranglerRun(["d1", "execute", PROD.d1Name, "--remote", "--env", "production", "--command", sql]);
}

console.log(
  `\n${dry ? "Dry run finished; nothing was changed." : "Setup finished."} Next (README, Production setup):\n` +
    `  npm run verify:ai-search -- --as-of ${asOf}\n` +
    "  npm run verify:gateway\n" +
    "  npm run verify:production -- --cpu\n" +
    "  npm run doctor",
);
