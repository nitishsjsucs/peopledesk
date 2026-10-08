import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HealthSchema } from "../../src/shared/api-types.ts";

describe("adversarial model project", () => {
  it("runs with the adversarial stub provider", async () => {
    const res = await SELF.fetch("http://localhost/api/health");
    expect(res.status).toBe(200);
    expect(HealthSchema.parse(await res.json()).llmProvider).toBe("adversarial-stub");
  });
});
