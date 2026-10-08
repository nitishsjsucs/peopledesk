// Bad patterns, out-of-range numbers, overlong strings and unknown keys are rejected by the tools'
// strict zod input schemas with isError and a validation message, and cause no side effects.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, mcpClient } from "../helpers/mcp.ts";
import type { ToolResult } from "../helpers/mcp.ts";

const CASES: Array<[string, Record<string, unknown>]> = [
  ["search_policies", { query: "hi" }],
  ["search_policies", { query: "x".repeat(501) }],
  ["search_policies", { query: "leave policy", topK: 9 }],
  ["search_policies", { query: "leave policy", topK: 0 }],
  ["search_policies", { query: "leave policy", category: "snacks" }],
  ["search_policies", { query: "leave policy", sneaky: true }],
  ["list_my_tickets", { limit: 51 }],
  ["list_my_tickets", { status: "lost" }],
  ["list_my_tickets", { requesterId: "E0001" }],
  ["get_onboarding_progress", { employeeId: "0042" }],
  ["get_onboarding_progress", { employeeId: "E00421" }],
  ["get_onboarding_progress", { employeeId: "E0042", extra: 1 }],
  ["list_orientation_sessions", { fromDate: "next week" }],
  ["list_orientation_sessions", { format: "hybrid" }],
  ["list_orientation_sessions", { region: "FR" }],
];

function isValidationFailure(r: ToolResult): boolean {
  const text = (r.content ?? []).map((c) => c.text ?? "").join(" ");
  return r.isError === true && /validation/i.test(text);
}

describe("MCP input validation", () => {
  it.each(CASES)("%s rejects %j", async (tool, args) => {
    const client = await mcpClient("tenured_employee");
    const before = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'tool_call' AND outcome = 'ok'").first<{ n: number }>();
    const r = await call(client, tool, args);
    expect(isValidationFailure(r), JSON.stringify(r)).toBe(true);
    const after = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE event = 'tool_call' AND outcome = 'ok'").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  it("accepts valid arguments and applies defaults", async () => {
    const client = await mcpClient("tenured_employee");
    const r = await call(client, "list_my_tickets", {});
    expect(r.isError).toBeFalsy();
    expect(Array.isArray(r.structuredContent?.["tickets"])).toBe(true);
  });
});
