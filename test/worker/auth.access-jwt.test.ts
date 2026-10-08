// Dev mode, local JWKS: the same jose verification path as production, with the test key.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MeSchema } from "../../src/shared/api-types.ts";
import { persona, spareEmployees } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";
import { foreignPrivateJwk, mintHs256, mintToken, tamperEmail, unsignedToken } from "../helpers/tokens.ts";

const me = persona("tenured_employee");
const now = () => Math.floor(Date.now() / 1000);

describe("Access-shaped JWT verification (local JWKS)", () => {
  it("accepts a valid RS256 token from the Cf-Access-Jwt-Assertion header", async () => {
    const body = await expectJson(await api("/api/me", { token: await mintToken({ email: me.email }) }), MeSchema);
    expect(body.employeeId).toBe(me.employeeId);
    expect(body.identityKind).toBe("user");
  });

  it("matches the email case-insensitively", async () => {
    const body = await expectJson(await api("/api/me", { token: await mintToken({ email: me.email.toUpperCase() }) }), MeSchema);
    expect(body.employeeId).toBe(me.employeeId);
  });

  it("rejects a missing token with 401", async () => {
    await expectError(await api("/api/me"), 401, "unauthenticated");
  });

  it.each([
    ["wrong iss", () => mintToken({ email: me.email, iss: "https://evil.example" })],
    ["wrong aud", () => mintToken({ email: me.email, aud: ["someone-else"] })],
    ["HS256", () => mintHs256(me.email)],
    ["alg none", async () => unsignedToken(me.email)],
    ["expired", () => mintToken({ email: me.email, iat: now() - 7200, exp: now() - 3600 })],
    ["nbf in the future", () => mintToken({ email: me.email, nbf: now() + 3600 })],
    ["unknown kid", () => mintToken({ email: me.email, kid: "not-a-known-kid" })],
    ["signed by an untrusted key", async () => mintToken({ email: me.email, privateJwk: await foreignPrivateJwk() })],
    ["tampered payload", async () => tamperEmail(await mintToken({ email: me.email }), persona("hr_admin").email)],
    ["garbage", async () => "not.a.jwt"],
  ])("rejects %s with 401", async (_label, make) => {
    await expectError(await api("/api/me", { token: await make() }), 401, "unauthenticated");
  });

  it("returns 403 for a verified email with no employee record", async () => {
    await expectError(await api("/api/me", { token: await mintToken({ email: "nobody@peopledesk.test" }) }), 403, "forbidden");
  });

  it("returns 403 for an inactive employee", async () => {
    const [spare] = spareEmployees(1);
    await env.DB.prepare("UPDATE employees SET status = 'inactive' WHERE id = ?1").bind(spare?.id).run();
    await expectError(await api("/api/me", { token: await mintToken({ email: spare?.email }) }), 403, "forbidden");
  });

  it("accepts the CF_Authorization cookie in dev mode", async () => {
    const token = await mintToken({ email: me.email });
    const body = await expectJson(await api("/api/me", { headers: { Cookie: `CF_Authorization=${token}` } }), MeSchema);
    expect(body.employeeId).toBe(me.employeeId);
  });

  it("never reads identity from the request body or query", async () => {
    const res = await api(`/api/me?email=${encodeURIComponent(persona("hr_admin").email)}`, { as: "tenured_employee" });
    expect((await expectJson(res, MeSchema)).employeeId).toBe(me.employeeId);
  });
});
