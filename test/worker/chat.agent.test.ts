// Stub provider end to end through HTTP, the Worker, the ConversationAgent (RPC), the in-process MCP
// client and back.
import { describe, expect, it } from "vitest";
import { ConversationListSchema, ConversationSchema } from "../../src/shared/api-types.ts";
import { ask, newConversation, recordLlmMetadata, send } from "../helpers/chat.ts";
import { manifest, persona } from "../helpers/fixtures.ts";
import { api, expectError, expectJson } from "../helpers/http.ts";

describe("chat turns (stub provider)", () => {
  it("answers a policy question with citations that carry effective dates and a source line", async () => {
    const r = await ask("tenured_employee", "How fast does paid time off accrue?");
    expect(r.kind).toBe("answer");
    expect(r.citations.length).toBeGreaterThan(0);
    const c = r.citations[0]!;
    const doc = manifest.documents.find((d) => d.docId === c.docId)!;
    const version = doc.versions.find((v) => v.version === c.version)!;
    expect(version.status).toBe("current");
    expect(c).toMatchObject({ effectiveFrom: version.effectiveFrom, effectiveTo: version.effectiveTo, sourceKey: version.r2Key });
    expect(c.quote.length).toBeLessThanOrEqual(300);
    expect(r.text).toContain(`Source: ${doc.title} (${doc.docId} v${version.version}, effective ${version.effectiveFrom}).`);
    expect(r.trace).toMatchObject({ llmProvider: "stub", asOf: "2026-10-01", router: { intent: "policy_question" } });
    expect(r.trace.retrieval).toMatchObject({ retriever: "d1-fts", droppedNotEffective: 0 });
    // How many restricted passages matched is never sent to the caller (it would reveal that
    // restricted documents on the topic exist); the gate logs it server-side instead.
    expect(r.trace.retrieval).not.toHaveProperty("droppedForClearance");
    expect(r.trace.composer?.invalidCitationsDropped).toBe(0);
  });

  it("returns approval_required for an action request, without writing", async () => {
    const r = await ask("tenured_employee", "Please open an IT ticket, my laptop will not boot after the update");
    expect(r.kind).toBe("approval_required");
    expect(r.pendingAction).toMatchObject({ tool: "create_support_ticket", status: "awaiting_approval", source: "chat" });
    expect(r.toolCall).toMatchObject({ tool: "create_support_ticket", status: "ok" });
    expect(r.text).toMatch(/Nothing has been submitted yet/);
  });

  it("returns tool results with deterministic text", async () => {
    const r = await ask("new_hire_unbooked", "How is my onboarding progress?");
    expect(r.kind).toBe("tool_result");
    expect(r.text).toMatch(/onboarding is \d+% complete/);
    expect((r.toolResult as { employeeId: string }).employeeId).toBe(persona("new_hire_unbooked").employeeId);
  });

  it("refuses out-of-scope requests", async () => {
    const r = await ask("tenured_employee", "Tell me a joke about the weather");
    expect(r).toMatchObject({ kind: "refuse", text: "I can help with company policies, support tickets, onboarding and orientation sessions." });
  });

  it("asks for clarification when a ticket has no described problem", async () => {
    const r = await ask("tenured_employee", "I need to open a ticket.");
    expect(r.kind).toBe("clarify");
    expect(r.pendingAction).toBeUndefined();
    expect(r.text).toMatch(/description/);
  });

  it("persists the transcript in the Agent and lists the conversation", async () => {
    const who = "manager_no_new_hires";
    const id = await newConversation(who);
    await send(who, id, "How fast does paid time off accrue?");
    await send(who, id, "Show my tickets");
    const conv = await expectJson(await api(`/api/conversations/${id}`, { as: who }), ConversationSchema);
    expect(conv.messages.map((m) => [m.role, m.kind])).toEqual([
      ["user", "user"],
      ["assistant", "answer"],
      ["user", "user"],
      ["assistant", "tool_result"],
    ]);
    expect(conv.title).toBe("How fast does paid time off accrue?");
    const list = await expectJson(await api("/api/conversations", { as: who }), ConversationListSchema);
    expect(list.conversations.some((c) => c.id === id)).toBe(true);
  });

  it("answers 404 for another user's conversation", async () => {
    const id = await newConversation("hr_admin");
    await expectError(await api(`/api/conversations/${id}`, { as: "tenured_employee" }), 404, "not_found");
    await expectError(
      await api(`/api/conversations/${id}/messages`, { as: "tenured_employee", body: { text: "hello there" } }),
      404,
      "not_found",
    );
    const list = await expectJson(await api("/api/conversations", { as: "tenured_employee" }), ConversationListSchema);
    expect(list.conversations.some((c) => c.id === id)).toBe(false);
  });

  it("validates the message length", async () => {
    const id = await newConversation("tenured_employee");
    await expectError(await api(`/api/conversations/${id}/messages`, { as: "tenured_employee", body: { text: "" } }), 400, "validation_error");
    await expectError(
      await api(`/api/conversations/${id}/messages`, { as: "tenured_employee", body: { text: "x".repeat(2001) } }),
      400,
      "validation_error",
    );
  });

  it("does not offer gateway logs outside Workers AI", async () => {
    const id = await newConversation("tenured_employee");
    const r = await send("tenured_employee", id, "How fast does paid time off accrue?");
    await expectError(await api(`/api/conversations/${id}/turns/${r.turnId}/gateway-logs`, { as: "tenured_employee" }), 404, "not_found");
  });
});

describe("approval outcomes in the transcript", () => {
  it("records an approved chat proposal as a system message in its conversation", async () => {
    const { planned, spareEmployees } = await import("../helpers/fixtures.ts");
    const who = spareEmployees(1, (e) => !planned.has(e.id))[0]!.email;
    const id = await newConversation(who);
    const r = await send(who, id, "Please open an IT ticket, my laptop will not boot after the update");
    expect(r.kind).toBe("approval_required");
    const approve = await api(`/api/actions/${r.pendingAction!.actionId}/approve`, { as: who, body: {} });
    expect(approve.status).toBe(200);
    const conv = await expectJson(await api(`/api/conversations/${id}`, { as: who }), ConversationSchema);
    const note = conv.messages.find((m) => m.role === "system");
    expect(note?.kind).toBe("action_outcome");
    expect(note?.text).toMatch(/Approved and done: TKT-\d{6}/);
  });
});

describe("eval header", () => {
  it("labels every LLM call with the run and case ids only when X-PeopleDesk-Eval is sent (dev mode)", async () => {
    const p = persona("tenured_employee");
    const id = await newConversation(p.key);
    const { seen, restore } = await recordLlmMetadata(p.employeeId, id);
    try {
      await send(p.key, id, "How fast does paid time off accrue?", { "X-PeopleDesk-Eval": "run-1:ans-001" });
      expect(seen.map((m) => m.purpose)).toEqual(["router", "composer"]);
      for (const m of seen) expect(m).toMatchObject({ evalRunId: "run-1", caseId: "ans-001", conversationId: id });

      seen.length = 0;
      await send(p.key, id, "How fast does paid time off accrue?");
      expect(seen.length).toBeGreaterThan(0);
      for (const m of seen) {
        expect(m.evalRunId).toBeUndefined();
        expect(m.caseId).toBeUndefined();
      }

      seen.length = 0;
      await send(p.key, id, "How fast does paid time off accrue?", { "X-PeopleDesk-Eval": "not a tag" });
      expect(seen.length).toBeGreaterThan(0);
      for (const m of seen) expect(m.evalRunId).toBeUndefined();
    } finally {
      await restore();
    }
  });
});
