// ALLOW_SERVICE_TOKENS=true in this project. A linked Access service token (empty sub, common_name) can
// read, propose and reject, but never approve: approval needs a verified Access *user* identity.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ActionListSchema } from "../../src/shared/api-types.ts";
import { persona } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";
import { call, mcpClient } from "../helpers/mcp.ts";
import { mintServiceToken } from "../helpers/tokens.ts";

const COMMON_NAME = "eval-tenured.peopledesk.access";

async function link(): Promise<void> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO identity_links (identity, kind, employee_id, created_at) VALUES (?1, 'service_token', ?2, ?3)",
  )
    .bind(COMMON_NAME, persona("tenured_employee").employeeId, new Date().toISOString())
    .run();
}

describe("Access service tokens", () => {
  it("can list tools, propose over /mcp, list its actions and reject, but approval is 403 human_approval_required", async () => {
    await link();
    const token = await mintServiceToken(COMMON_NAME);
    const client = await mcpClient("service", { token });
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    const proposed = await call(client, "create_support_ticket", {
      category: "it",
      subject: "Eval ticket",
      description: "Created by the eval service token.",
    });
    const actionId = String(proposed.structuredContent?.["actionId"]);
    expect(proposed.structuredContent?.["approvalUrl"]).toBe(`https://peopledesk.test/actions?focus=${actionId}`);

    const list = await expectJson(await api("/api/actions", { token }), ActionListSchema);
    expect(list.actions.map((a) => a.actionId)).toContain(actionId);

    await expectError(await api(`/api/actions/${actionId}/approve`, { token, body: {} }), 403, "human_approval_required");
    const denied = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'authz_denied' AND target = ?1")
      .bind(actionId)
      .first<{ n: number }>();
    expect(denied?.n).toBe(1);
    const tickets = await env.DB.prepare("SELECT COUNT(*) AS n FROM tickets WHERE action_id = ?1").bind(actionId).first<{ n: number }>();
    expect(tickets?.n).toBe(0);

    expect(await (await api(`/api/actions/${actionId}/reject`, { token, body: {} })).json()).toEqual({ status: "rejected" });
  });

  it("lets the linked person approve as a user, which the service token never can", async () => {
    await link();
    const token = await mintServiceToken(COMMON_NAME);
    const proposed = await call(await mcpClient("service", { token }), "create_support_ticket", {
      category: "it",
      subject: "Second eval ticket",
      description: "Created by the eval service token.",
    });
    const actionId = String(proposed.structuredContent?.["actionId"]);
    await expectError(await api(`/api/actions/${actionId}/approve`, { token, body: {} }), 403, "human_approval_required");
    const asUser = await api(`/api/actions/${actionId}/approve`, { as: "tenured_employee", body: {} });
    expect(asUser.status).toBe(200);
  });

  it("refuses an unlinked service token with 403", async () => {
    await expectError(await api("/api/me", { token: await mintServiceToken("unlinked.peopledesk.access") }), 403, "forbidden");
  });
});
