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
    const html = await res.text();
    expect(html).toContain("PeopleDesk local login");
    expect(html).toContain('const NEXT = "/";');
    // A failed or empty persona list says what to run; a failed sign-in shows inline, never alert().
    expect(html).toContain("No personas found. Run npm run seed:local, then reload this page.");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("alert(");
  });

  it("returns to a same-origin path after sign-in, and to / for anything else", async () => {
    const nextOf = async (next: string) => {
      const html = await (await SELF.fetch(`http://localhost/dev/login?next=${encodeURIComponent(next)}`)).text();
      return /const NEXT = (".*?");/.exec(html)?.[1];
    };
    expect(await nextOf("/policies/POL-001")).toBe('"/policies/POL-001"');
    expect(await nextOf("/requests/ticket?review=6f1c2b8e-3d1a-4c9b-9e1f-2a3b4c5d6e7f")).toBe(
      '"/requests/ticket?review=6f1c2b8e-3d1a-4c9b-9e1f-2a3b4c5d6e7f"',
    );
    for (const bad of [
      "//evil.example",
      "https://evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/dev/token",
      "/dev",
      "/DEV/login",
      "/%2Fdev/login",
      "/%64ev/login",
      "/a<script>",
      "/a\"b",
      "",
    ]) {
      expect(await nextOf(bad), bad).toBe('"/"');
    }
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
