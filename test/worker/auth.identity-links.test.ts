import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MeSchema } from "../../src/shared/api-types.ts";
import { persona } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";
import { mintServiceToken, mintToken } from "../helpers/tokens.ts";

describe("identity links", () => {
  it("resolves a linked real email to the linked employee", async () => {
    const target = persona("manager_with_new_hires");
    await env.DB.prepare("INSERT INTO identity_links (identity, kind, employee_id, created_at) VALUES (?1, 'email', ?2, ?3)")
      .bind("real.person@example.com", target.employeeId, new Date().toISOString())
      .run();
    const body = await expectJson(await api("/api/me", { token: await mintToken({ email: "Real.Person@example.com" }) }), MeSchema);
    expect(body.employeeId).toBe(target.employeeId);
    expect(body.role).toBe("manager");
  });

  it("rejects service-token JWTs while ALLOW_SERVICE_TOKENS=false, even when linked", async () => {
    await env.DB.prepare(
      "INSERT INTO identity_links (identity, kind, employee_id, created_at) VALUES (?1, 'service_token', ?2, ?3)",
    )
      .bind("eval-bot.peopledesk", persona("tenured_employee").employeeId, new Date().toISOString())
      .run();
    await expectError(await api("/api/me", { token: await mintServiceToken("eval-bot.peopledesk") }), 403, "forbidden");
  });
});
