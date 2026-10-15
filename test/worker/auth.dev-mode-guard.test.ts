import { createExecutionContext, env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../../src/worker/index.ts";
import { ApiErrorSchema } from "../../src/shared/api-types.ts";
import { tokenFor } from "../helpers/http.ts";

async function errorCode(res: Response): Promise<[number, string]> {
  return [res.status, ApiErrorSchema.parse(await res.json()).error.code];
}


const AUD = "4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2";
describe("fail-closed configuration", () => {
  it("rejects dev mode on a non-local hostname with misconfigured_auth_mode", async () => {
    const res = await SELF.fetch("https://evil.example/api/health", {
      headers: { "Cf-Access-Jwt-Assertion": await tokenFor("tenured_employee") },
    });
    expect(await errorCode(res)).toEqual([500, "misconfigured_auth_mode"]);
    expect(await errorCode(await SELF.fetch("https://evil.example/dev/login"))).toEqual([500, "misconfigured_auth_mode"]);
  });

  it.each([
    ["an unknown AUTH_MODE", { AUTH_MODE: "bogus" }],
    [
      "access mode with the stub provider",
      { AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "https://team.test", ACCESS_AUD: AUD, LLM_PROVIDER: "stub" },
    ],
    [
      "access mode with the adversarial stub",
      { AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "https://team.test", ACCESS_AUD: AUD, LLM_PROVIDER: "adversarial-stub" },
    ],
    ["an empty DEV_ACCESS_JWKS", { DEV_ACCESS_JWKS: "" }],
    // Production ships with ACCESS_AUD empty until npm run setup:production writes the AUD tag.
    ["access mode before the AUD tag is set", { AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "https://team.test", ACCESS_AUD: "", LLM_PROVIDER: "openai-compatible" }],
    [
      "access mode with a placeholder AUD",
      { AUTH_MODE: "access", ACCESS_TEAM_DOMAIN: "https://team.test", ACCESS_AUD: "<Access application AUD tag>", LLM_PROVIDER: "openai-compatible" },
    ],
  ])("returns 500 misconfigured on every route for %s", async (_label, overrides) => {
    const token = await tokenFor("tenured_employee");
    for (const [method, path] of [
      ["GET", "/api/health"],
      ["GET", "/api/me"],
      ["POST", "/api/conversations"],
      ["POST", "/mcp"],
      ["GET", "/dev/login"],
      ["GET", "/api/does-not-exist"],
    ] as const) {
      const res = await worker.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: { "Cf-Access-Jwt-Assertion": token, Origin: "http://localhost", "Content-Type": "application/json" },
          ...(method === "POST" ? { body: "{}" } : {}),
        }),
        { ...env, ...overrides } as Env,
        createExecutionContext(),
      );
      expect(await errorCode(res), `${method} ${path}`).toEqual([500, "misconfigured"]);
    }
  });
});
