import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { mcpClient } from "../helpers/mcp.ts";

const READ_TOOLS = ["get_onboarding_progress", "list_my_tickets", "list_orientation_sessions", "search_policies"];
const ALL_TOOLS = [...READ_TOOLS, "create_support_ticket", "schedule_orientation_session"].sort();

describe("MCP tools/list over /mcp", () => {
  it("lists exactly the six tools with strict input schemas, output schemas and annotations", async () => {
    const client = await mcpClient("tenured_employee");
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
      expect(t.outputSchema, t.name).toBeDefined();
      expect(t.annotations?.readOnlyHint, t.name).toBeTypeOf("boolean");
      expect(t.description?.length, t.name).toBeGreaterThan(20);
    }
    const search = tools.find((t) => t.name === "search_policies");
    expect(search?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(search?.inputSchema.required).toEqual(["query"]);
    for (const name of ["create_support_ticket", "schedule_orientation_session"]) {
      expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
    }
    // There is deliberately no approve tool.
    expect(tools.some((t) => /approve/i.test(t.name))).toBe(false);
  });

  it("returns 401 without a JWT", async () => {
    const res = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(401);
  });
});

describe("in-process MCP client", () => {
  it("reaches the same server, validation and authorization as /mcp", async () => {
    const { connectInProcess } = await import("../../src/worker/mcp/in-process-client.ts");
    const { principalFor, testServices } = await import("../helpers/services.ts");
    const client = await connectInProcess({
      principal: await principalFor("new_hire_unbooked"),
      services: testServices(),
      approvalOrigin: "http://localhost:5173",
      source: "chat",
    });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    const bad = await client.callTool({ name: "list_my_tickets", arguments: { requesterId: "E0001" } });
    expect(bad.isError).toBe(true);
    const ok = await client.callTool({ name: "get_onboarding_progress", arguments: {} });
    expect((ok.structuredContent as { employeeId: string }).employeeId).toMatch(/^E\d{4}$/);
  });
});
