// A selected filter must stay visible in forced colors (Windows high contrast), where the browser
// replaces background and border colors with system colors and drops box-shadow. So the selected
// state of a stat tile has to be carried by something forced colors keep: the border's width and the
// label's weight, read here from src/web/styles.css.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/web/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

type Decls = Record<string, string>;

function parse(body: string): Decls {
  const out: Decls = {};
  for (const decl of body.split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

const escape = (selector: string) => selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/** Top-level rules (outside any @media block) whose selector list is exactly `selector`. */
function topLevel(selector: string): Decls[] {
  const out: Decls[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === "{") {
      if (depth === 0) {
        const head = css.slice(start, i).trim();
        const end = css.indexOf("}", i);
        if (new RegExp(`^${escape(selector)}$`).test(head)) out.push(parse(css.slice(i + 1, end)));
      }
      depth++;
    } else if (css[i] === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  return out;
}

/** The rules for `selector` inside every `@media (forced-colors: active)` block. */
function forcedColors(selector: string): Decls[] {
  const out: Decls[] = [];
  for (const m of css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)) {
    for (const r of (m[1] ?? "").matchAll(new RegExp(`(?:^|\\})\\s*${escape(selector)}\\s*\\{([^}]*)\\}`, "gm"))) out.push(parse(r[1] ?? ""));
  }
  return out;
}

/** The width in px of a `border` shorthand such as "1px solid var(--border-strong)". */
const borderWidth = (decls: Decls): number => {
  const m = /(\d+(?:\.\d+)?)px/.exec(decls["border"] ?? decls["border-width"] ?? "");
  return m ? Number(m[1]) : 0;
};

const padding = (decls: Decls): number[] => (decls["padding"] ?? "").split(/\s+/).map((v) => Number.parseFloat(v));

describe("a pressed stat tile in styles.css", () => {
  const base = topLevel(".stat-tile");
  const pressed = topLevel('.stat-tile[aria-pressed="true"]');

  it("has one base rule and one pressed rule", () => {
    expect(base).toHaveLength(1);
    expect(pressed).toHaveLength(1);
  });

  it("draws the selection with a wider border, not a box-shadow that forced colors remove", () => {
    expect(borderWidth(pressed[0] ?? {})).toBeGreaterThan(borderWidth(base[0] ?? {}));
    expect(pressed[0]?.["box-shadow"]).toBeUndefined();
  });

  it("keeps the tile's outer size: every extra pixel of border comes out of the padding", () => {
    const extra = borderWidth(pressed[0] ?? {}) - borderWidth(base[0] ?? {});
    expect(padding(pressed[0] ?? {})).toEqual(padding(base[0] ?? {}).map((p) => p - extra));
  });

  it("makes the label bolder, which forced colors keep", () => {
    const label = topLevel('.stat-tile[aria-pressed="true"] .stat-label');
    expect(label).toHaveLength(1);
    expect(Number(label[0]?.["font-weight"])).toBeGreaterThanOrEqual(600);
  });

  it("in forced colors, has a still wider border in the Highlight system color, again out of the padding", () => {
    const fc = forcedColors('.stat-tile[aria-pressed="true"]');
    expect(fc).toHaveLength(1);
    expect(fc[0]?.["border"]).toMatch(/\bHighlight\b/);
    const extra = borderWidth(fc[0] ?? {}) - borderWidth(base[0] ?? {});
    expect(extra).toBeGreaterThanOrEqual(2);
    expect(padding(fc[0] ?? {})).toEqual(padding(base[0] ?? {}).map((p) => p - extra));
  });
});
