// LLM_PROVIDER=openai-compatible pointed at https://llm.test/v1, which the outboundService answers
// with 599: every model call fails.
import { describe, expect, it } from "vitest";
import { newConversation, send } from "../helpers/chat.ts";

describe("provider failure", () => {
  it("returns kind error with provider_unavailable and releases the turn lock", async () => {
    const id = await newConversation("tenured_employee");
    const first = await send("tenured_employee", id, "How fast does paid time off accrue?");
    expect(first.kind).toBe("error");
    expect(first.error?.code).toBe("provider_unavailable");
    // An immediate second turn is another error, not 409 turn_in_progress.
    const second = await send("tenured_employee", id, "How fast does paid time off accrue?");
    expect(second.kind).toBe("error");
    expect(second.error?.code).toBe("provider_unavailable");
  });
});
