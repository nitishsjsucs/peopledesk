// The production key path, offline: createRemoteJWKSet on https://team.test/cdn-cgi/access/certs,
// served by the project's outboundService.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MeSchema } from "../../src/shared/api-types.ts";
import { persona } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";
import { foreignPrivateJwk, mintToken } from "../helpers/tokens.ts";

const me = persona("manager_no_new_hires");
const now = () => Math.floor(Date.now() / 1000);

describe("remote JWKS (AUTH_MODE=access)", () => {
  it("accepts a valid token from the Cf-Access-Jwt-Assertion header", async () => {
    const body = await expectJson(await api("/api/me", { token: await mintToken({ email: me.email }) }), MeSchema);
    expect(body.employeeId).toBe(me.employeeId);
  });

  it.each([
    ["wrong aud", () => mintToken({ email: me.email, aud: ["peopledesk-local"] })],
    ["wrong iss", () => mintToken({ email: me.email, iss: "https://other-team.cloudflareaccess.com" })],
    ["unknown kid", () => mintToken({ email: me.email, kid: "rotated-away" })],
    ["expired", () => mintToken({ email: me.email, iat: now() - 7200, exp: now() - 3600 })],
    [
      "a different key with the dev issuer",
      async () =>
        mintToken({ email: me.email, iss: "https://dev-access.peopledesk.test", aud: ["peopledesk-local"], privateJwk: await foreignPrivateJwk() }),
    ],
  ])("rejects %s with 401", async (_label, make) => {
    await expectError(await api("/api/me", { token: await make() }), 401, "unauthenticated");
  });

  it("ignores the CF_Authorization cookie in access mode", async () => {
    const token = await mintToken({ email: me.email });
    await expectError(await api("/api/me", { headers: { Cookie: `CF_Authorization=${token}` } }), 401, "unauthenticated");
  });

  it("answers 404 on any hostname other than APP_HOSTNAME, even with a valid token", async () => {
    const token = await mintToken({ email: me.email });
    expect((await api("/api/me", { token })).status).toBe(200);
    for (const baseUrl of [
      "https://peopledesk.example.workers.dev",
      "https://0123abcd-peopledesk.example.workers.dev",
      "https://peopledesk.test.example.com",
    ]) {
      await expectError(await api("/api/me", { token, baseUrl }), 404, "not_found");
      await expectError(await api("/api/conversations", { token, baseUrl, body: {} }), 404, "not_found");
      await expectError(
        await api("/mcp", {
          token,
          baseUrl,
          headers: { Accept: "application/json, text/event-stream" },
          body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        }),
        404,
        "not_found",
      );
    }
  });

  it("does not register /dev/* routes", async () => {
    for (const path of ["/dev/login", "/dev/personas"]) {
      expect((await SELF.fetch(`https://peopledesk.test${path}`)).status).toBe(404);
    }
    await expectError(await api("/dev/token", { body: { email: me.email } }), 404, "not_found");
  });
});
