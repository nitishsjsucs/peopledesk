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

  // agents 0.28.1 peers on these exact MCP versions; 1.32.1 and 2.3.1 carry the fix for
  // GHSA-6qxp-vccf-f47h (PROGRESS.md, deviation 52).
  it("keeps the MCP and test-pool pins together", () => {
    expect(pkg.dependencies["agents"]).toBe("0.28.1");
    expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toBe("1.32.1");
    expect(pkg.dependencies["@modelcontextprotocol/server"]).toBe("2.3.1");
    expect(pkg.dependencies["@modelcontextprotocol/client"]).toBe("2.3.1");
    expect(pkg.devDependencies["@cloudflare/vitest-plugin"]).toBe("1.4.3");
    expect(pkg.devDependencies["@cloudflare/vitest-pool-workers"]).toBeUndefined();
  });

  it("pins the Node version in .nvmrc", () => {
    expect(readFileSync(new URL("../../.nvmrc", import.meta.url), "utf8").trim()).toBe("25.9.0");
  });
});
