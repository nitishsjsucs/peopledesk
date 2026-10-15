import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_JSON_SCHEMA_TARGET } from "../../src/worker/mcp/tool-defs.ts";

const repo = resolve(import.meta.dirname, "../..");

describe("tool schemas converted at module evaluation (CPU budget)", () => {
  it("warms the JSON Schema draft the MCP SDK asks for, so the first request finds it memoized", () => {
    for (const pkg of ["server", "client"]) {
      const dir = join(repo, "node_modules/@modelcontextprotocol", pkg, "dist");
      const targets = new Set<string>();
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
        for (const m of readFileSync(join(dir, f), "utf8").matchAll(/JSON_SCHEMA_CONVERSION_TARGET = "([^"]+)"/g)) targets.add(m[1] as string);
      }
      expect([...targets]).toEqual([MCP_JSON_SCHEMA_TARGET]);
    }
  });
});
