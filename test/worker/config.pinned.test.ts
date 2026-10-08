// A developer's .dev.vars reaches the test pool, so every CONFIG_KEYS var is pinned through
// miniflare.bindings. This proves the pinned values are what the Worker actually sees.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { HealthSchema } from "../../src/shared/api-types.ts";

describe("pinned test config", () => {
  it("reports dev auth, the stub provider, the D1 FTS retriever and the fixed business date", async () => {
    const res = await SELF.fetch("http://localhost/api/health");
    expect(res.status).toBe(200);
    const body = HealthSchema.parse(await res.json());
    expect(body).toMatchObject({
      ok: true,
      authMode: "dev",
      llmProvider: "stub",
      model: "stub-rules-v1",
      retriever: "d1-fts",
      asOf: "2026-10-01",
    });
  });
});
