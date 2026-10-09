// Internal failure details stay server-side: a turn's error.message is always the fixed text for its
// code, and an unexpected exception inside a tool reaches MCP callers as a generic `internal` error,
// never as the exception's own message.
import { describe, expect, it, vi } from "vitest";
import { runTurn } from "../../src/worker/chat/orchestrator.ts";
import { ERROR_TEXT } from "../../src/worker/chat/render.ts";
import type { LlmProvider, LlmRequest, LlmResult } from "../../src/worker/llm/provider.ts";
import { LlmUnavailableError } from "../../src/worker/llm/provider.ts";
import { StubProvider } from "../../src/worker/llm/stub.ts";
import { connectInProcess } from "../../src/worker/mcp/in-process-client.ts";
import type { PolicyRetriever } from "../../src/worker/policies/retriever.ts";
import type { Services } from "../../src/worker/container.ts";
import { principalFor, testServices } from "../helpers/services.ts";

const SECRET = "D1_ERROR: no such table: payroll_internal_7f3a";

const brokenRetriever: PolicyRetriever = {
  kind: "d1-fts",
  search: () => Promise.reject(new Error(SECRET)),
};

async function turn(provider: LlmProvider, services: Services = testServices()) {
  return runTurn(
    {
      provider,
      services,
      principal: await principalFor("tenured_employee"),
      conversationId: crypto.randomUUID(),
      turnId: crypto.randomUUID(),
      asOf: "2026-10-01",
      approvalOrigin: "http://localhost",
      history: { userMessages: [], assistantTurns: [] },
    },
    "How fast does paid time off accrue?",
  );
}

/** Silences and captures console output for one block. */
async function quietly<T>(fn: () => Promise<T>): Promise<{ value: T; logged: string }> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  const err = vi.spyOn(console, "error").mockImplementation(capture);
  const warn = vi.spyOn(console, "warn").mockImplementation(capture);
  try {
    return { value: await fn(), logged: lines.join("\n") };
  } finally {
    err.mockRestore();
    warn.mockRestore();
  }
}

describe("error text", () => {
  it("gives a provider failure the fixed message, and logs the detail", async () => {
    const failing: LlmProvider = {
      id: "workers-ai",
      model: "m",
      completeJson: <T>(_req: LlmRequest<T>): Promise<LlmResult<T>> =>
        Promise.reject(new LlmUnavailableError("provider_unavailable", `Workers AI call failed: ${SECRET}`)),
    };
    const { value: r, logged } = await quietly(() => turn(failing));
    expect(r).toMatchObject({ kind: "error", error: { code: "provider_unavailable", message: ERROR_TEXT.provider_unavailable } });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged).toContain(SECRET);
  });

  it("turns an unexpected exception inside search_policies into a generic internal error turn", async () => {
    const services = testServices();
    services.retriever = brokenRetriever;
    const { value: r, logged } = await quietly(() => turn(new StubProvider(), services));
    expect(r).toMatchObject({ kind: "error", error: { code: "internal", message: ERROR_TEXT.internal } });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged).toContain(SECRET);
  });

  it("answers an MCP caller with code internal and no exception text", async () => {
    const services = testServices();
    services.retriever = brokenRetriever;
    const client = await connectInProcess({
      principal: await principalFor("tenured_employee"),
      services,
      approvalOrigin: "http://localhost",
      source: "mcp",
    });
    const { value: result, logged } = await quietly(
      async () => (await client.callTool({ name: "search_policies", arguments: { query: "paid time off" } })) as Record<string, unknown>,
    );
    expect(result["isError"]).toBe(true);
    expect(result["structuredContent"]).toEqual({ error: { code: "internal", message: "Internal error." } });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(logged).toContain(SECRET);
  });
});
