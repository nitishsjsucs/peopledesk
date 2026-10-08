import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  type: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("toolchain pins", () => {
  it("is an ES module package (vitest-plugin is ESM only)", () => {
    expect(pkg.type).toBe("module");
  });

  it("pins every dependency to an exact version", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, range] of Object.entries(all)) {
      expect(range, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("keeps the MCP and test-pool pins the spec requires", () => {
    expect(pkg.dependencies["agents"]).toBe("0.27.0");
    expect(pkg.dependencies["@modelcontextprotocol/server"]).toBe("2.0.0");
    expect(pkg.dependencies["@modelcontextprotocol/client"]).toBe("2.0.0");
    expect(pkg.devDependencies["@cloudflare/vitest-plugin"]).toBe("1.3.7");
    expect(pkg.devDependencies["@cloudflare/vitest-pool-workers"]).toBeUndefined();
  });

  it("pins the Node version in .nvmrc", () => {
    expect(readFileSync(new URL("../../.nvmrc", import.meta.url), "utf8").trim()).toBe("25.9.0");
  });
});
