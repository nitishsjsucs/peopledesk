// The SPA (including /actions, the only page with an Approve button) is served by Workers static
// assets, not the Worker, so the Worker's header middleware never runs for it. public/_headers, copied
// into the assets directory by the build, gives every static response the same anti-framing headers.
// (Checked by hand against `vite preview` on 2026-10-08: /, /actions?focus=... and SPA fallbacks.)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = readFileSync(resolve(import.meta.dirname, "../../public/_headers"), "utf8");

function rules(text: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      out.set(line.trim(), current);
      continue;
    }
    const i = line.indexOf(":");
    current?.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  return out;
}

describe("public/_headers", () => {
  it("forbids framing and MIME sniffing for every static path", () => {
    const all = rules(file).get("/*");
    expect(all?.get("x-frame-options")).toBe("DENY");
    expect(all?.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(all?.get("x-content-type-options")).toBe("nosniff");
  });
});
