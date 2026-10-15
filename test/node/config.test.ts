import { describe, expect, it } from "vitest";
import { CONFIG_KEYS } from "../../src/worker/config-keys.ts";
import { verifierFor } from "../../src/worker/auth/identity.ts";
import { getConfig, parseConfig, readConfigVars } from "../../src/worker/env.ts";
import { humanWait, parseRateLimits } from "../../src/worker/services/rate-limit-rules.ts";
import { BASE_TEST_VARS } from "../pool-vars.ts";

const JWKS = JSON.stringify({ keys: [{ kty: "RSA", n: "x", e: "AQAB", kid: "k" }] });
const bindings = { DB: {}, POLICY_BUCKET: {}, CONVERSATION_AGENT: {} };
const dev = { ...BASE_TEST_VARS, DEV_ACCESS_JWKS: JWKS, ...bindings };
const access = {
  ...BASE_TEST_VARS,
  ...bindings,
  AUTH_MODE: "access",
  ACCESS_TEAM_DOMAIN: "https://team.test",
  ACCESS_AUD: "aud",
  LLM_PROVIDER: "openai-compatible",
};

describe("CONFIG_KEYS and pinned test vars", () => {
  it("pins exactly the CONFIG_KEYS", () => {
    expect(Object.keys(BASE_TEST_VARS).sort()).toEqual([...CONFIG_KEYS].sort());
  });

  it("reads only CONFIG_KEYS", () => {
    const vars = readConfigVars({ ...dev, SOMETHING_ELSE: "x", LLM_PROVIDER_OVERRIDE: "workers-ai" });
    expect(Object.keys(vars).sort()).toEqual([...CONFIG_KEYS].sort());
  });
});

describe("parseConfig", () => {
  it("accepts the pinned dev config", () => {
    const r = parseConfig(dev);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.authMode).toBe("dev");
    expect(r.config.llm).toEqual({ provider: "stub", model: "stub-rules-v1" });
    expect(r.config.asOfOverride).toBe("2026-10-01");
    expect(r.config.allowServiceTokens).toBe(false);
  });

  it("requires a parseable DEV_ACCESS_JWKS in dev mode", () => {
    expect(parseConfig({ ...dev, DEV_ACCESS_JWKS: "" }).ok).toBe(false);
    expect(parseConfig({ ...dev, DEV_ACCESS_JWKS: "{\"keys\":[]}" }).ok).toBe(false);
  });

  it("rejects unknown auth modes and providers", () => {
    expect(parseConfig({ ...dev, AUTH_MODE: "bogus" }).ok).toBe(false);
    expect(parseConfig({ ...dev, LLM_PROVIDER: "gpt" }).ok).toBe(false);
    expect(parseConfig({ ...dev, RETRIEVER: "vectorize" }).ok).toBe(false);
  });

  it("rejects the test-only providers in access mode", () => {
    expect(parseConfig({ ...access, LLM_PROVIDER: "stub" }).ok).toBe(false);
    expect(parseConfig({ ...access, LLM_PROVIDER: "adversarial-stub" }).ok).toBe(false);
    expect(parseConfig(access).ok).toBe(true);
  });

  it("requires an https team domain and an audience in access mode, and ignores AS_OF_OVERRIDE", () => {
    expect(parseConfig({ ...access, ACCESS_TEAM_DOMAIN: "http://team.test" }).ok).toBe(false);
    expect(parseConfig({ ...access, ACCESS_AUD: "" }).ok).toBe(false);
    const r = parseConfig(access);
    expect(r.ok && r.config.asOfOverride).toBe(null);
  });

  it("requires the AI binding and a gateway id for workers-ai, and POLICY_SEARCH for ai-search", () => {
    const wai = { ...access, LLM_PROVIDER: "workers-ai", WORKERS_AI_MODEL: "@cf/m", AI_GATEWAY_ID: "g" };
    expect(parseConfig(wai).ok).toBe(false);
    expect(parseConfig({ ...wai, AI: {} }).ok).toBe(true);
    expect(parseConfig({ ...wai, AI: {}, AI_GATEWAY_ID: "" }).ok).toBe(false);
    expect(parseConfig({ ...access, RETRIEVER: "ai-search" }).ok).toBe(false);
    expect(parseConfig({ ...access, RETRIEVER: "ai-search", POLICY_SEARCH: {} }).ok).toBe(true);
  });

  it("requires CHAT_RATE_LIMITS with at least one per-user rule", () => {
    const r = parseConfig(dev);
    expect(r.ok && r.config.chatRateLimits).toEqual([
      { scope: "user", max: 1000, windowSeconds: 60 },
      { scope: "all", max: 1_000_000, windowSeconds: 86_400 },
    ]);
    expect(parseConfig({ ...dev, CHAT_RATE_LIMITS: "" }).ok).toBe(false);
    expect(parseConfig({ ...access, CHAT_RATE_LIMITS: "all:100/86400" }).ok).toBe(false);
    const { CHAT_RATE_LIMITS: _limits, ...missing } = dev;
    expect(parseConfig(missing).ok).toBe(false);
  });

  it("requires the D1, R2 and Durable Object bindings", () => {
    const { DB: _db, ...noDb } = dev;
    expect(parseConfig(noDb).ok).toBe(false);
  });
});

describe("parseRateLimits", () => {
  it("parses the production rules", () => {
    expect(parseRateLimits("user:6/60, user:60/86400,all:120/86400")).toEqual({
      ok: true,
      rules: [
        { scope: "user", max: 6, windowSeconds: 60 },
        { scope: "user", max: 60, windowSeconds: 86_400 },
        { scope: "all", max: 120, windowSeconds: 86_400 },
      ],
    });
  });

  it("rejects malformed, zero, oversized, repeated and too many rules", () => {
    for (const bad of [
      "user:6",
      "user:6/60s",
      "team:6/60",
      "user:0/60",
      "user:6/0",
      "user:6/604801",
      "user:6/60,user:7/60",
      "user:1/1,user:1/2,user:1/3,user:1/4,user:1/5,user:1/6,user:1/7",
    ]) {
      expect(parseRateLimits(bad).ok, bad).toBe(false);
    }
  });

  it("words the wait for the 429 message", () => {
    expect(humanWait(30)).toBe("30 seconds");
    expect(humanWait(600)).toBe("about 10 minutes");
    expect(humanWait(43_170)).toBe("about 12 hours");
  });
});

describe("module-scope caches (CPU budget, SPEC sections 5 and 10)", () => {
  it("getConfig parses once per distinct config, and only CONFIG_KEYS and binding presence count", () => {
    const first = getConfig(dev);
    expect(getConfig({ ...dev })).toBe(first);
    // A key outside CONFIG_KEYS, or a different binding object, does not change the config.
    expect(getConfig({ ...dev, SOMETHING_ELSE: "x", DB: { other: true } })).toBe(first);
    // A changed config var or a newly present binding is parsed afresh, never served stale.
    const ttl = getConfig({ ...dev, ACTION_TTL_SECONDS: "60" });
    expect(ttl).not.toBe(first);
    expect(ttl.ok && ttl.config.actionTtlSeconds).toBe(60);
    const wai = { ...access, LLM_PROVIDER: "workers-ai", WORKERS_AI_MODEL: "@cf/m", AI_GATEWAY_ID: "g" };
    expect(getConfig(wai).ok).toBe(false);
    expect(getConfig({ ...wai, AI: {} }).ok).toBe(true);
  });

  it("verifierFor returns one verifier per auth config", () => {
    const d = getConfig(dev);
    const a = getConfig(access);
    if (!d.ok || !a.ok) throw new Error("test configs must parse");
    expect(verifierFor(d.config.auth)).toBe(verifierFor({ ...d.config.auth }));
    expect(verifierFor(a.config.auth)).toBe(verifierFor({ ...a.config.auth }));
    expect(verifierFor(a.config.auth)).not.toBe(verifierFor(d.config.auth));
    const otherAud = getConfig({ ...access, ACCESS_AUD: "other-aud" });
    if (!otherAud.ok) throw new Error("test config must parse");
    expect(verifierFor(otherAud.config.auth)).not.toBe(verifierFor(a.config.auth));
  });
});
