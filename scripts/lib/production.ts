// The production deployment's names and account facts, and read-only inspection of every Cloudflare
// resource it needs. Shared by npm run setup:production (which creates what is missing), npm run
// doctor (read-only) and npm run verify:production.
//
// Credentials: wrangler uses its OAuth login (npx wrangler login) for D1, R2, AI Search, Workers and
// deploys; it never sees an API token, because every wrangler child process runs without
// CLOUDFLARE_API_TOKEN and CF_API_TOKEN. The Cloudflare REST API (Access, AI Gateway, analytics) uses
// the account API token in CF_API_TOKEN. No function here prints a token or a client secret.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PersonaKey } from "../../src/shared/domain.ts";
import { productionEnv, repo, stripJsonc } from "./cloudflare.ts";

const prod = productionEnv();
const topLevel = JSON.parse(stripJsonc(readFileSync(join(repo, "wrangler.jsonc"), "utf8"))) as { account_id?: string };

/** Every Cloudflare resource this app owns is named with the peopledesk prefix. */
export const PROD = {
  accountId: topLevel.account_id ?? "",
  workerName: "peopledesk",
  hostname: prod.vars["APP_HOSTNAME"] ?? "",
  teamDomain: (prod.vars["ACCESS_TEAM_DOMAIN"] ?? "").replace(/\/+$/, ""),
  d1Name: prod.d1_databases[0]?.database_name ?? "peopledesk",
  bucket: prod.r2_buckets[0]?.bucket_name ?? "peopledesk-policies",
  aiSearch: prod.ai_search?.[0]?.instance_name ?? "peopledesk-policies",
  gateway: prod.vars["AI_GATEWAY_ID"] ?? "peopledesk",
  accessApp: "peopledesk",
  allowPolicy: "peopledesk-allow",
  serviceAuthPolicy: "peopledesk-service-auth",
  /** The account's existing One-time PIN identity provider (Zero Trust Free plan). */
  idpId: "743683e8-42d4-44e9-9991-ba57a1bb0dec",
  ownerEmail: "nitishsancs@gmail.com",
} as const;

/** Each persona signs in through Access with one of the owner's addresses (Gmail plus-addresses). */
export const PERSONA_EMAILS: Readonly<Record<PersonaKey, string>> = {
  tenured_employee: "nitishsancs@gmail.com",
  new_hire_booked: "nitishsancs+newhire@gmail.com",
  new_hire_unbooked: "nitishsancs+newhire2@gmail.com",
  manager_with_new_hires: "nitishsancs+manager@gmail.com",
  manager_no_new_hires: "nitishsancs+manager2@gmail.com",
  hr_admin: "nitishsancs+hr@gmail.com",
};

/** One Access service token per persona, for verify:production and the production eval. */
export const serviceTokenName = (persona: PersonaKey) => `peopledesk-eval-${persona.replace(/_/g, "-")}`;

/** Service token client secrets live outside the repository (Access shows a secret only once). */
export const secretsDir = process.env["PEOPLEDESK_SECRETS_DIR"] ?? join(homedir(), ".config", "peopledesk");
export const serviceTokensFile = join(secretsDir, "service-tokens.json");
export type StoredToken = { tokenId: string; clientId: string; clientSecret: string };

export function readServiceTokens(): Partial<Record<PersonaKey, StoredToken>> {
  if (!existsSync(serviceTokensFile)) return {};
  return JSON.parse(readFileSync(serviceTokensFile, "utf8")) as Partial<Record<PersonaKey, StoredToken>>;
}

export function writeServiceTokens(tokens: Partial<Record<PersonaKey, StoredToken>>): void {
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  writeFileSync(serviceTokensFile, `${JSON.stringify(tokens, null, 2)}\n`, { mode: 0o600 });
  chmodSync(serviceTokensFile, 0o600);
}

// --- wrangler, always on its OAuth login.

function wranglerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "true", CLOUDFLARE_ACCOUNT_ID: PROD.accountId };
  delete env["CLOUDFLARE_API_TOKEN"];
  delete env["CF_API_TOKEN"];
  delete env["CLOUDFLARE_API_KEY"];
  return env;
}

/** Runs wrangler and returns { ok, out } with stdout and stderr captured (nothing is printed). */
export function wranglerTry(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync(join(repo, "node_modules/.bin/wrangler"), args, { cwd: repo, encoding: "utf8", env: wranglerEnv(), maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Runs wrangler with its output on this terminal; throws on failure. */
export function wranglerRun(args: string[]): void {
  execFileSync(join(repo, "node_modules/.bin/wrangler"), args, { cwd: repo, stdio: "inherit", env: wranglerEnv() });
}

/** Runs an npm script or node script of this repo on wrangler's OAuth login; throws on failure. */
export function runRepo(cmd: string, args: string[], extraEnv: Record<string, string> = {}): void {
  execFileSync(cmd, args, { cwd: repo, stdio: "inherit", env: { ...wranglerEnv(), ...extraEnv } });
}

/** The first JSON value (object or array) in wrangler's output, which may print banners around it. */
export function jsonIn<T>(out: string): T | null {
  const start = out.search(/[[{]/);
  if (start < 0) return null;
  for (let end = out.length; end > start; end--) {
    const ch = out[end - 1];
    if (ch !== "]" && ch !== "}") continue;
    try {
      return JSON.parse(out.slice(start, end)) as T;
    } catch {
      // keep shrinking
    }
  }
  return null;
}

// --- Cloudflare REST API with CF_API_TOKEN.

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function apiToken(): string | null {
  const t = process.env["CF_API_TOKEN"]?.trim();
  return t ? t : null;
}

/** Calls https://api.cloudflare.com/client/v4/accounts/<account>/<path>; errors carry Cloudflare's messages only. */
export async function cfApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = apiToken();
  if (!token) throw new ApiError(0, "CF_API_TOKEN is not set");
  const url = path.startsWith("/") ? `https://api.cloudflare.com/client/v4${path}` : `https://api.cloudflare.com/client/v4/accounts/${PROD.accountId}/${path}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: Array<{ code?: number; message?: string }> };
  if (!res.ok || body.success === false) {
    const msg = (body.errors ?? []).map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ") || res.statusText;
    throw new ApiError(res.status, `${init.method ?? "GET"} ${path}: HTTP ${res.status} ${msg}`);
  }
  return body.result as T;
}

/** GET that answers null on 404 (a missing resource). */
export async function cfGetOrNull<T>(path: string): Promise<T | null> {
  try {
    return await cfApi<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// --- Inspection (read-only).

export type AccessApp = { id: string; uid?: string; aud: string; name: string; domain: string; allowed_idps?: string[]; policies?: Array<{ id: string; name?: string; precedence?: number }> };
export type AccessPolicy = { id: string; name: string; decision: string; include: unknown[] };
export type ServiceToken = { id: string; name: string; client_id: string; expires_at?: string };

export type Finding = { area: string; ok: boolean; detail: string };

export type State = {
  findings: Finding[];
  whoamiOk: boolean;
  tokenOk: boolean;
  d1Id: string | null;
  bucketExists: boolean | null;
  aiSearchExists: boolean | null;
  gatewayExists: boolean | null;
  idpOk: boolean | null;
  serviceTokens: Partial<Record<PersonaKey, ServiceToken>>;
  storedTokens: Partial<Record<PersonaKey, StoredToken>>;
  policies: { allow: AccessPolicy | null; serviceAuth: AccessPolicy | null };
  app: AccessApp | null;
  workerDeployed: boolean | null;
  seededSha: string | null;
};

const configuredD1Id = () => productionEnv().d1_databases[0]?.database_id ?? "";
export const configuredAud = () => productionEnv().vars["ACCESS_AUD"] ?? "";

export async function inspect(): Promise<State> {
  const findings: Finding[] = [];
  const note = (area: string, ok: boolean, detail: string) => findings.push({ area, ok, detail });
  const s: State = {
    findings,
    whoamiOk: false,
    tokenOk: false,
    d1Id: null,
    bucketExists: null,
    aiSearchExists: null,
    gatewayExists: null,
    idpOk: null,
    serviceTokens: {},
    storedTokens: readServiceTokens(),
    policies: { allow: null, serviceAuth: null },
    app: null,
    workerDeployed: null,
    seededSha: null,
  };

  if (process.env["CLOUDFLARE_API_TOKEN"]) note("credentials", false, "CLOUDFLARE_API_TOKEN is set; these scripts remove it from wrangler's environment, but unset it (wrangler must use its OAuth login)");
  const who = wranglerTry(["whoami"]);
  s.whoamiOk = who.ok && who.out.includes(PROD.accountId);
  note("wrangler login", s.whoamiOk, s.whoamiOk ? `OAuth login can use account ${PROD.accountId}` : "run npx wrangler login (the login must include this account)");

  if (!apiToken()) {
    note("CF_API_TOKEN", false, "not set; needed for Access, AI Gateway and analytics API calls");
  } else {
    try {
      const v = await cfApi<{ status: string }>(`/accounts/${PROD.accountId}/tokens/verify`).catch(() => cfApi<{ status: string }>("/user/tokens/verify"));
      s.tokenOk = v.status === "active";
      note("CF_API_TOKEN", s.tokenOk, `token status ${v.status}`);
    } catch (err) {
      note("CF_API_TOKEN", false, String((err as Error).message));
    }
  }

  if (s.whoamiOk) {
    const list = wranglerTry(["d1", "list", "--json"]);
    const dbs = jsonIn<Array<{ uuid: string; name: string }>>(list.out) ?? [];
    s.d1Id = dbs.find((d) => d.name === PROD.d1Name)?.uuid ?? null;
    const cfgId = configuredD1Id();
    note("D1", !!s.d1Id && s.d1Id === cfgId, s.d1Id ? `${PROD.d1Name} is ${s.d1Id}; wrangler.jsonc has ${cfgId}` : `${PROD.d1Name} does not exist`);
    if (s.d1Id && s.d1Id === cfgId) {
      const q = wranglerTry(["d1", "execute", PROD.d1Name, "--remote", "--env", "production", "--json", "--command", "SELECT as_of, valid_until, sha256 FROM dataset_meta WHERE id = 1"]);
      const rows = jsonIn<Array<{ results: Array<{ as_of: string; valid_until: string; sha256: string }> }>>(q.out);
      const row = rows?.[0]?.results?.[0];
      s.seededSha = row?.sha256 ?? null;
      const today = new Date().toISOString().slice(0, 10);
      note("D1 seed", !!row && row.valid_until >= today, row ? `dataset as of ${row.as_of}, valid until ${row.valid_until}` : "not seeded (or migrations not applied)");
    }

    const r2 = wranglerTry(["r2", "bucket", "list"]);
    if (!r2.ok) {
      s.bucketExists = null;
      note("R2", false, `bucket list failed: ${r2.out.trim().split("\n").slice(-2).join(" ")} (R2 may need to be enabled once in the dashboard)`);
    } else {
      s.bucketExists = new RegExp(`name:\\s+${PROD.bucket}\\s*$`, "m").test(r2.out);
      note("R2", s.bucketExists, s.bucketExists ? `bucket ${PROD.bucket} exists` : `bucket ${PROD.bucket} does not exist`);
    }

    const ais = wranglerTry(["ai-search", "get", PROD.aiSearch, "--json"]);
    s.aiSearchExists = ais.ok;
    note("AI Search", ais.ok, ais.ok ? `instance ${PROD.aiSearch} exists` : `instance ${PROD.aiSearch} does not exist`);

    const dep = wranglerTry(["deployments", "list", "--name", PROD.workerName]);
    s.workerDeployed = dep.ok && /Created|Version/i.test(dep.out);
    note("Worker", s.workerDeployed, s.workerDeployed ? `${PROD.workerName} has deployments` : `${PROD.workerName} is not deployed`);
  }

  if (s.tokenOk) {
    try {
      s.gatewayExists = !!(await cfGetOrNull<{ id: string }>(`ai-gateway/gateways/${PROD.gateway}`));
      note("AI Gateway", s.gatewayExists, s.gatewayExists ? `gateway ${PROD.gateway} exists` : `gateway ${PROD.gateway} does not exist`);
    } catch (err) {
      note("AI Gateway", false, (err as Error).message);
    }
    try {
      const idp = await cfGetOrNull<{ id: string; type: string; name: string }>(`access/identity_providers/${PROD.idpId}`);
      s.idpOk = idp?.type === "onetimepin";
      note("Access IdP", s.idpOk, idp ? `${idp.name} (${idp.type})` : `identity provider ${PROD.idpId} not found`);
    } catch (err) {
      note("Access IdP", false, (err as Error).message);
    }
    try {
      const tokens = await cfApi<ServiceToken[]>("access/service_tokens?per_page=1000");
      for (const persona of Object.keys(PERSONA_EMAILS) as PersonaKey[]) {
        const t = tokens.find((x) => x.name === serviceTokenName(persona));
        if (t) s.serviceTokens[persona] = t;
      }
      const have = Object.keys(s.serviceTokens).length;
      const secrets = (Object.keys(PERSONA_EMAILS) as PersonaKey[]).filter((p) => s.storedTokens[p]?.clientId && s.storedTokens[p]?.clientId === s.serviceTokens[p]?.client_id).length;
      note("Access service tokens", have === 6 && secrets === 6, `${have} of 6 exist; ${secrets} of 6 secrets in ${serviceTokensFile}`);
      const policies = await cfApi<AccessPolicy[]>("access/policies?per_page=1000");
      s.policies.allow = policies.find((p) => p.name === PROD.allowPolicy) ?? null;
      s.policies.serviceAuth = policies.find((p) => p.name === PROD.serviceAuthPolicy) ?? null;
      note("Access policies", !!s.policies.allow && !!s.policies.serviceAuth, `${PROD.allowPolicy} ${s.policies.allow ? "exists" : "missing"}, ${PROD.serviceAuthPolicy} ${s.policies.serviceAuth ? "exists" : "missing"}`);
      const apps = await cfApi<AccessApp[]>("access/apps?per_page=1000");
      s.app = apps.find((a) => a.domain === PROD.hostname || a.name === PROD.accessApp) ?? null;
      const aud = configuredAud();
      note(
        "Access application",
        !!s.app && s.app.aud === aud,
        s.app ? `${s.app.name} on ${s.app.domain}, AUD ${s.app.aud === aud ? "matches wrangler.jsonc" : "differs from wrangler.jsonc ACCESS_AUD"}` : `no application for ${PROD.hostname}`,
      );
    } catch (err) {
      note("Access", false, (err as Error).message);
    }
  }
  return s;
}

export function printFindings(findings: Finding[]): void {
  for (const f of findings) console.log(`${f.ok ? "ok  " : "TODO"} ${f.area.padEnd(22)} ${f.detail}`);
}

/** Writes a value into env.production in wrangler.jsonc, keeping comments and layout. */
export function setProductionValue(key: "database_id" | "ACCESS_AUD", value: string): void {
  const path = join(repo, "wrangler.jsonc");
  const text = readFileSync(path, "utf8");
  const at = text.indexOf('"production"');
  if (at < 0) throw new Error("wrangler.jsonc has no env.production");
  const head = text.slice(0, at);
  const tail = text.slice(at);
  const re = new RegExp(`("${key}":\\s*)"[^"]*"`);
  if (!re.test(tail)) throw new Error(`wrangler.jsonc env.production has no ${key}`);
  writeFileSync(path, head + tail.replace(re, `$1${JSON.stringify(value)}`));
}
