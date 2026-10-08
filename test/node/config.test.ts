import { describe, expect, it } from "vitest";
import { CONFIG_KEYS } from "../../src/worker/config-keys.ts";
import { parseConfig, readConfigVars } from "../../src/worker/env.ts";
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

  it("requires the D1, R2 and Durable Object bindings", () => {
    const { DB: _db, ...noDb } = dev;
    expect(parseConfig(noDb).ok).toBe(false);
  });
});
