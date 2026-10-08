import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HealthSchema } from "../../src/shared/api-types.ts";

describe("worker-access project config", () => {
  it("runs in access mode with the OpenAI-compatible provider (stubs are rejected in access mode)", async () => {
    const res = await SELF.fetch("https://peopledesk.test/api/health");
    expect(res.status).toBe(200);
    const body = HealthSchema.parse(await res.json());
    expect(body.authMode).toBe("access");
    expect(body.llmProvider).toBe("openai-compatible");
  });
});
