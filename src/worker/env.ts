import { z } from "zod";
import { ISO_DATE_RE } from "../shared/domain.ts";
import type { AuthMode, LlmProviderId, RetrieverKind } from "../shared/domain.ts";
import { CONFIG_KEYS } from "./config-keys.ts";
import type { ConfigKey } from "./config-keys.ts";

export type JwkSet = { keys: Array<Record<string, unknown> & { kty: string }> };

export type AuthConfig =
  | { mode: "access"; teamDomain: string; audience: string; issuer: string }
  | { mode: "dev"; issuer: string; audience: string; jwks: JwkSet; privateJwk: string | null };

export type LlmConfig =
  | { provider: "workers-ai"; model: string; gatewayId: string }
  | { provider: "openai-compatible"; baseUrl: string; model: string }
  | { provider: "stub"; model: string }
  | { provider: "adversarial-stub"; model: string };

export type AppConfig = {
  authMode: AuthMode;
  auth: AuthConfig;
  llm: LlmConfig;
  retriever: RetrieverKind;
  /** Business-date override; only honored in dev mode (Clock section of the spec). */
  asOfOverride: string | null;
  appHostname: string;
  actionTtlSeconds: number;
  allowServiceTokens: boolean;
  /** Fingerprint of the CONFIG_KEYS values; keys module-scope caches of derived objects. */
  fingerprint: string;
};

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; issues: string[] };

export const STUB_MODEL = "stub-rules-v1";
export const ADVERSARIAL_MODEL = "adversarial-stub-v1";

const nonEmpty = z.string().trim().min(1);
const httpsUrl = z.url({ protocol: /^https$/ });
const anyUrl = z.url({ protocol: /^https?$/ });

const jwkSetSchema = z.object({
  keys: z.array(z.looseObject({ kty: z.string() })).min(1),
});

type RawVars = Record<ConfigKey, string | undefined>;

/** Reads only CONFIG_KEYS from the environment. Anything else is ignored. */
export function readConfigVars(env: Record<string, unknown>): RawVars {
  const out = {} as RawVars;
  for (const key of CONFIG_KEYS) {
    const v = env[key];
    out[key] = typeof v === "string" ? v : undefined;
  }
  return out;
}

type BindingPresence = { ai: boolean; policySearch: boolean; db: boolean; bucket: boolean; agent: boolean };

function bindingPresence(env: Record<string, unknown>): BindingPresence {
  return {
    ai: env["AI"] != null,
    policySearch: env["POLICY_SEARCH"] != null,
    db: env["DB"] != null,
    bucket: env["POLICY_BUCKET"] != null,
    agent: env["CONVERSATION_AGENT"] != null,
  };
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown, key: string, issues: string[]): T | undefined {
  const r = schema.safeParse(value);
  if (!r.success) {
    issues.push(`${key}: ${r.error.issues[0]?.message ?? "invalid"}`);
    return undefined;
  }
  return r.data;
}

/** Pure validation of the CONFIG_KEYS values plus binding presence. Exported for tests. */
export function parseConfig(env: Record<string, unknown>): ConfigResult {
  const raw = readConfigVars(env);
  const bindings = bindingPresence(env);
  const issues: string[] = [];

  if (!bindings.db) issues.push("DB binding missing");
  if (!bindings.bucket) issues.push("POLICY_BUCKET binding missing");
  if (!bindings.agent) issues.push("CONVERSATION_AGENT binding missing");

  const authMode = parseWith(z.enum(["dev", "access"]), raw.AUTH_MODE, "AUTH_MODE", issues);
  const provider = parseWith(
    z.enum(["workers-ai", "openai-compatible", "stub", "adversarial-stub"]),
    raw.LLM_PROVIDER,
    "LLM_PROVIDER",
    issues,
  );
  const retriever = parseWith(z.enum(["d1-fts", "ai-search"]), raw.RETRIEVER, "RETRIEVER", issues);
  const appHostname = parseWith(nonEmpty, raw.APP_HOSTNAME, "APP_HOSTNAME", issues);
  const ttl = parseWith(
    z.coerce.number().int().min(60).max(86_400),
    raw.ACTION_TTL_SECONDS,
    "ACTION_TTL_SECONDS",
    issues,
  );
  const allowServiceTokens = parseWith(
    z.enum(["true", "false"]),
    raw.ALLOW_SERVICE_TOKENS ?? "false",
    "ALLOW_SERVICE_TOKENS",
    issues,
  );

  let auth: AuthConfig | undefined;
  let asOfOverride: string | null = null;
  if (authMode === "access") {
    const teamDomain = parseWith(httpsUrl, raw.ACCESS_TEAM_DOMAIN, "ACCESS_TEAM_DOMAIN", issues);
    const audience = parseWith(nonEmpty, raw.ACCESS_AUD, "ACCESS_AUD", issues);
    if (provider === "stub" || provider === "adversarial-stub") {
      issues.push(`LLM_PROVIDER: ${provider} is a test-only provider and is rejected when AUTH_MODE=access`);
    }
    if (teamDomain && audience) {
      const domain = teamDomain.replace(/\/+$/, "");
      auth = { mode: "access", teamDomain: domain, audience, issuer: domain };
    }
    // DEV_* vars and AS_OF_OVERRIDE are deliberately ignored in access mode.
  } else if (authMode === "dev") {
    const issuer = parseWith(nonEmpty, raw.DEV_ACCESS_ISSUER, "DEV_ACCESS_ISSUER", issues);
    const audience = parseWith(nonEmpty, raw.DEV_ACCESS_AUD, "DEV_ACCESS_AUD", issues);
    let jwks: JwkSet | undefined;
    try {
      jwks = parseWith(jwkSetSchema, JSON.parse(raw.DEV_ACCESS_JWKS ?? ""), "DEV_ACCESS_JWKS", issues) as
        | JwkSet
        | undefined;
    } catch {
      issues.push("DEV_ACCESS_JWKS: not valid JSON (run npm run dev:keys)");
    }
    const privateJwk = raw.DEV_ACCESS_PRIVATE_JWK?.trim() ? raw.DEV_ACCESS_PRIVATE_JWK : null;
    if (raw.AS_OF_OVERRIDE?.trim()) {
      asOfOverride = parseWith(z.string().regex(ISO_DATE_RE), raw.AS_OF_OVERRIDE.trim(), "AS_OF_OVERRIDE", issues) ?? null;
    }
    if (issuer && audience && jwks) auth = { mode: "dev", issuer, audience, jwks, privateJwk };
  }

  let llm: LlmConfig | undefined;
  if (provider === "workers-ai") {
    const model = parseWith(nonEmpty, raw.WORKERS_AI_MODEL, "WORKERS_AI_MODEL", issues);
    const gatewayId = parseWith(nonEmpty, raw.AI_GATEWAY_ID, "AI_GATEWAY_ID", issues);
    if (!bindings.ai) issues.push("LLM_PROVIDER=workers-ai requires the AI binding");
    if (model && gatewayId) llm = { provider, model, gatewayId };
  } else if (provider === "openai-compatible") {
    const baseUrl = parseWith(anyUrl, raw.LLM_BASE_URL, "LLM_BASE_URL", issues);
    const model = parseWith(nonEmpty, raw.LLM_MODEL, "LLM_MODEL", issues);
    if (baseUrl && model) llm = { provider, baseUrl: baseUrl.replace(/\/+$/, ""), model };
  } else if (provider === "stub") {
    llm = { provider, model: STUB_MODEL };
  } else if (provider === "adversarial-stub") {
    llm = { provider, model: ADVERSARIAL_MODEL };
  }

  if (retriever === "ai-search" && !bindings.policySearch) {
    issues.push("RETRIEVER=ai-search requires the POLICY_SEARCH binding");
  }

  if (
    issues.length > 0 ||
    !authMode ||
    !auth ||
    !llm ||
    !retriever ||
    !appHostname ||
    ttl === undefined ||
    !allowServiceTokens
  ) {
    return { ok: false, issues: issues.length > 0 ? issues : ["invalid configuration"] };
  }

  return {
    ok: true,
    config: {
      authMode,
      auth,
      llm,
      retriever,
      asOfOverride: authMode === "dev" ? asOfOverride : null,
      appHostname,
      actionTtlSeconds: ttl,
      allowServiceTokens: allowServiceTokens === "true",
      fingerprint: fingerprintOf(raw, bindings),
    },
  };
}

function fingerprintOf(raw: RawVars, bindings: BindingPresence): string {
  return JSON.stringify([CONFIG_KEYS.map((k) => raw[k] ?? null), bindings]);
}

// Module-scope cache: steady-state requests do no re-parsing (CPU budget, SPEC section 10).
const cache = new Map<string, ConfigResult>();

export function getConfig(env: Record<string, unknown>): ConfigResult {
  const key = fingerprintOf(readConfigVars(env), bindingPresence(env));
  const hit = cache.get(key);
  if (hit) return hit;
  const result = parseConfig(env);
  if (cache.size > 16) cache.clear();
  cache.set(key, result);
  return result;
}

export function modelOf(llm: LlmConfig): string {
  return llm.model;
}

export function providerOf(llm: LlmConfig): LlmProviderId {
  return llm.provider;
}
