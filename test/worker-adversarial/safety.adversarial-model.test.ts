import { describe, expect, it } from "vitest";
import { HealthSchema } from "../../src/shared/api-types.ts";
import { api } from "../helpers/http.ts";

describe("adversarial model project", () => {
  it("runs with the adversarial stub provider", async () => {
    const res = await api("/api/health", { as: "tenured_employee" });
    expect(res.status).toBe(200);
    expect(HealthSchema.parse(await res.json()).llmProvider).toBe("adversarial-stub");
  });
});
