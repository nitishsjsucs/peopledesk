import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { DevTokenSchema, MeSchema, PersonasSchema } from "../../src/shared/api-types.ts";
import { PERSONA_KEYS } from "../../src/shared/domain.ts";
import { org, persona } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";

describe("dev login routes", () => {
  it("lists the six personas from the seeded org", async () => {
    const body = await expectJson(await SELF.fetch("http://localhost/dev/personas"), PersonasSchema);
    expect(body.personas.map((p) => p.key)).toEqual([...PERSONA_KEYS]);
    expect(body.personas.map((p) => p.employeeId)).toEqual(org.personas.map((p) => p.employeeId));
  });

  it("serves the persona picker", async () => {
    const res = await SELF.fetch("http://localhost/dev/login");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("PeopleDesk local login");
  });

  it("issues an Access-shaped token and an HttpOnly SameSite=Strict cookie", async () => {
    const p = persona("hr_admin");
    const res = await api("/dev/token", { body: { email: p.email } });
    const cookie = res.headers.get("set-cookie") ?? "";
    const body = await expectJson(res, DevTokenSchema);
    expect(cookie).toMatch(/^CF_Authorization=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
    const [, payload] = body.token.split(".");
    const claims = JSON.parse(atob((payload ?? "").replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    expect(claims).toMatchObject({ email: p.email, type: "app", iss: "https://dev-access.peopledesk.test", aud: ["peopledesk-local"] });
    expect(typeof claims["identity_nonce"]).toBe("string");
    const me = await expectJson(await api("/api/me", { token: body.token }), MeSchema);
    expect(me.employeeId).toBe(p.employeeId);
  });

  it("refuses unknown emails and cross-origin token requests", async () => {
    await expectError(await api("/dev/token", { body: { email: "nobody@peopledesk.test" } }), 404, "not_found");
    await expectError(await api("/dev/token", { body: { email: persona("hr_admin").email }, origin: "https://evil.example" }), 403, "forbidden");
  });
});
