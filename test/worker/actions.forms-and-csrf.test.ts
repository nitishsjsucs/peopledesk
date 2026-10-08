import { describe, expect, it } from "vitest";
import { ActionListSchema, PendingActionViewSchema } from "../../src/shared/api-types.ts";
import { proposeTicket, ticketArgs } from "../helpers/actions.ts";
import { planned, spareEmployees } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";
import { newConversation } from "../helpers/chat.ts";
import { call, mcpClient } from "../helpers/mcp.ts";

const spares = spareEmployees(6, (e) => !planned.has(e.id)).map((e) => e.email);

describe("forms path", () => {
  it("uses the same validation as the MCP tool", async () => {
    await expectError(
      await api("/api/actions", { as: spares[0], body: { tool: "create_support_ticket", arguments: { ...ticketArgs(), subject: "x" } } }),
      400,
      "validation_error",
    );
    await expectError(
      await api("/api/actions", { as: spares[0], body: { tool: "create_support_ticket", arguments: { ...ticketArgs(), requesterId: "E0001" } } }),
      400,
      "validation_error",
    );
    await expectError(await api("/api/actions", { as: spares[0], body: { tool: "approve_everything", arguments: {} } }), 400, "validation_error");
    const view = await proposeTicket(spares[0]!);
    expect(view).toMatchObject({ tool: "create_support_ticket", status: "awaiting_approval", source: "form" });
    expect(view.preview.fields.find((f) => f.label === "Subject")?.value).toBe(ticketArgs().subject);
  });

  it("maps business-rule failures to 409 with a reason", async () => {
    const res = await api("/api/actions", {
      as: "tenured_employee",
      body: { tool: "schedule_orientation_session", arguments: { sessionId: "ORI-005" } },
    });
    const body = (await res.clone().json()) as { error: { details?: { reason?: string } } };
    await expectError(res, 409, "conflict");
    expect(body.error.details?.reason).toBe("not_in_onboarding");
  });

  it("marks the superseded action when a proposal is edited", async () => {
    const old = await proposeTicket(spares[1]!);
    const replacement = await expectJson(
      await api("/api/actions", {
        as: spares[1],
        body: { tool: "create_support_ticket", arguments: { ...ticketArgs(), priority: "high" }, supersedes: old.actionId },
      }),
      PendingActionViewSchema,
      201,
    );
    const list = await expectJson(await api("/api/actions", { as: spares[1] }), ActionListSchema);
    const oldNow = list.actions.find((a) => a.actionId === old.actionId);
    expect(oldNow).toMatchObject({ status: "rejected", supersededBy: replacement.actionId });
    expect(list.actions.find((a) => a.actionId === replacement.actionId)?.status).toBe("awaiting_approval");
  });

  it("refuses to supersede someone else's action", async () => {
    const theirs = await proposeTicket(spares[2]!);
    await expectError(
      await api("/api/actions", { as: spares[3], body: { tool: "create_support_ticket", arguments: ticketArgs(), supersedes: theirs.actionId } }),
      404,
      "not_found",
    );
  });
});

describe("CSRF protection on state-changing routes", () => {
  it("rejects a cross-origin Origin and missing Origin on POST routes", async () => {
    const view = await proposeTicket(spares[4]!);
    for (const path of ["/api/actions", `/api/actions/${view.actionId}/approve`, `/api/actions/${view.actionId}/reject`]) {
      await expectError(await api(path, { as: spares[4], body: {}, origin: "https://evil.example" }), 403, "forbidden");
      await expectError(await api(path, { as: spares[4], body: {}, origin: null }), 403, "forbidden");
    }
  });

  it("rejects cross-origin and non-JSON requests on the conversation routes", async () => {
    await expectError(await api("/api/conversations", { as: spares[4], body: {}, origin: "https://evil.example" }), 403, "forbidden");
    await expectError(await api("/api/conversations", { as: spares[4], body: {}, contentType: "text/plain" }), 400, "validation_error");
    const id = await newConversation(spares[4]!);
    const path = `/api/conversations/${id}/messages`;
    await expectError(await api(path, { as: spares[4], body: { text: "hello there" }, origin: "https://evil.example" }), 403, "forbidden");
    await expectError(await api(path, { as: spares[4], body: { text: "hello there" }, origin: null }), 403, "forbidden");
    await expectError(await api(path, { as: spares[4], body: { text: "hello there" }, contentType: "text/plain" }), 400, "validation_error");
  });

  it("accepts Sec-Fetch-Site: same-origin when Origin is absent", async () => {
    const view = await proposeTicket(spares[5]!);
    const res = await api(`/api/actions/${view.actionId}/reject`, {
      as: spares[5],
      body: {},
      origin: null,
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects non-JSON content types", async () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      await expectError(
        await api("/api/actions", { as: spares[4], body: { tool: "create_support_ticket", arguments: ticketArgs() }, contentType }),
        400,
        "validation_error",
      );
    }
  });
});

describe("approvalUrl", () => {
  it("uses the request origin in dev mode", async () => {
    const r = await call(await mcpClient("tenured_employee"), "create_support_ticket", ticketArgs());
    const url = String(r.structuredContent?.["approvalUrl"]);
    expect(url).toMatch(/^http:\/\/localhost\/actions\?focus=[0-9a-f-]{36}$/);
    expect(url.endsWith(String(r.structuredContent?.["actionId"]))).toBe(true);
  });
});
