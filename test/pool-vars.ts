// Pinned config for every Vitest workerd project. The pool also loads a developer's .dev.vars, and
// values in miniflare.bindings override it, so pinning every CONFIG_KEYS entry here means a local
// .dev.vars cannot change what the tests run against (SPEC section 5). Adding a config key without
// pinning it is a type error because of the `satisfies` clause.
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";
import type { ConfigKey } from "../src/worker/config-keys.ts";

export const BASE_TEST_VARS = {
  AUTH_MODE: "dev",
  ACCESS_TEAM_DOMAIN: "",
  ACCESS_AUD: "",
  DEV_ACCESS_ISSUER: "https://dev-access.peopledesk.test",
  DEV_ACCESS_AUD: "peopledesk-local",
  DEV_ACCESS_JWKS: "",
  DEV_ACCESS_PRIVATE_JWK: "",
  LLM_PROVIDER: "stub",
  // An unroutable port: the stub provider never calls it.
  LLM_BASE_URL: "http://127.0.0.1:9/v1",
  LLM_MODEL: "qwen3-1.7b-q4_0",
  WORKERS_AI_MODEL: "",
  AI_GATEWAY_ID: "",
  RETRIEVER: "d1-fts",
  AS_OF_OVERRIDE: "2026-10-01",
  APP_HOSTNAME: "localhost",
  ACTION_TTL_SECONDS: "900",
  ALLOW_SERVICE_TOKENS: "false",
} satisfies Record<ConfigKey, string>;

export type TestKeys = {
  kid: string;
  /** JSON string of { keys: [publicJwk] }. */
  jwks: string;
  /** JSON string of the private JWK (with kid and alg). */
  privateJwk: string;
};

/** A fresh RS256 key pair per test run. The kid is the JWK thumbprint, like Access keys. */
export async function testKeyPair(): Promise<TestKeys> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const pub = await exportJWK(publicKey);
  const priv = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(pub);
  return {
    kid,
    jwks: JSON.stringify({ keys: [{ ...pub, kid, alg: "RS256", use: "sig" }] }),
    privateJwk: JSON.stringify({ ...priv, kid, alg: "RS256" }),
  };
}
